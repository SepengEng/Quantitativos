import { Helper } from "dxf";

// ── Utilidades geométricas ────────────────────────────────────────────────────

function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function polylineLength(vertices) {
  if (!vertices || vertices.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < vertices.length; i++) {
    len += dist(vertices[i - 1], vertices[i]);
  }
  return len;
}

// Shoelace formula — returns area in drawing units²
function polylineArea(vertices) {
  if (!vertices || vertices.length < 3) return 0;
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

function lineLength(e) {
  if (!e.start || !e.end) return 0;
  return dist(e.start, e.end);
}

// dxf library exposes header as camelCase (insUnits, not $INSUNITS)
// 0=unitless, 1=inches, 2=feet, 4=mm, 5=cm, 6=m
function detectarFatorUnidade(parsed) {
  const insUnits = parsed?.header?.insUnits ?? 4;
  switch (insUnits) {
    case 1: return 25.4;
    case 2: return 304.8;
    case 4: return 1;
    case 5: return 10;
    case 6: return 1000;
    default: return 1;
  }
}

// ── Normalização de blocos BIM (Revit/ArchiCAD) ───────────────────────────────

// Strips Revit element ID and view suffix from block name:
//   "Guarda-corpo - Guarda-corpo-1594491-Nível 1 - Layout" → "Guarda-corpo - Guarda-corpo"
//   "_ARQPWR_JANELA J21-1591519-BB_" → "_ARQPWR_JANELA J21"
//   "Tipo de Corrimão-V36-Nível 1 - Layout" → "Tipo de Corrimão"
function normalizarNomeBloco(nome) {
  return nome
    .replace(/-(AA|BB)_$/i, "")
    .replace(/-N.{1,3}vel\s+\d+\s*-\s*Layout$/i, "")  // "Nível N - Layout" (inc. mojibake)
    .replace(/-\d{5,}$/, "")
    .replace(/-V\d+$/, "")
    .trim();
}

// Extracts the element ID used to deduplicate across views
function extrairIdElemento(nome) {
  const m = nome.match(/-(\d{5,}|V\d+)(?:-(AA|BB)_|-N.+)?$/i);
  return m ? m[1] : nome;
}

// ── Filtros de layer ──────────────────────────────────────────────────────────

const LAYER_IGNORE_PATTERNS = [
  // Portuguese names
  /defpoints/i, /eixo/i, /refer/i, /auxiliar/i, /cota/i, /hachur/i,
  /borda/i, /moldura/i, /leader/i, /norte/i, /seta/i, /legenda/i,
  // AIA naming conventions (annotation, pattern, grid, title block)
  /-anno/i,       // A-ANNO-*, G-ANNO-* (all annotation layers)
  /-patt$/i,      // *-PATT (hatch/fill patterns)
  /-iden$/i,      // *-IDEN (identifier labels)
  /-levl$/i,      // *-LEVL (level markers)
  /-ttlb/i,       // *-TTLB (title block)
  /-schd$/i,      // *-SCHD (schedule tables)
  /-nplt$/i,      // *-NPLT (non-plottable notes)
  /-symb$/i,      // *-SYMB (symbols)
  /^g-/i,         // G-* layers (general/title annotation)
  /^s-grid/i,     // S-GRID* (structural grid axes)
  /viewport/i, /^vport/i,
  /^0$/,          // default unnamed layer
  /^hold$/i,
];

function deveIgnorarLayer(nome) {
  return LAYER_IGNORE_PATTERNS.some(p => p.test(nome || ""));
}

// Blocos de anotação (não representam elementos físicos quantificáveis)
const BLOCO_ANNOTATION_PATTERNS = [
  /^eixo\s*-/i, /swk-id/i, /swk-simb/i, /swk-/i,
  /cota de n/i, /cota de nivel/i,
  /filled arrow/i, /inclina/i,
  /^norte/i, /^folha\s+-\s+a\d/i,
  /^corte\s*-\s*swk/i,
  /^eleva.{1,6}o\s*-\s*filled/i,
];

function eAnnotationBloco(nome) {
  return BLOCO_ANNOTATION_PATTERNS.some(p => p.test(nome || ""));
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) return Response.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

  let dxfText;
  try {
    dxfText = await file.text();
  } catch {
    return Response.json({ error: "Erro ao ler arquivo" }, { status: 400 });
  }

  let parsed;
  try {
    const helper = new Helper(dxfText);
    parsed = helper.parsed;
  } catch (e) {
    return Response.json({ error: "DXF inválido: " + e.message }, { status: 400 });
  }

  const fatorUnidade = detectarFatorUnidade(parsed);
  const toM  = (u) => (u * fatorUnidade) / 1000;
  const toM2 = (u) => (u * fatorUnidade ** 2) / 1e6;

  // layer_name → { comprimento, area, contagem, tipos, blocoIds, textos }
  const layers = {};
  // normalized_block_name → { elementIds: Set, layers: {} }
  const blocos = {};
  const textos = [];
  const dimensions = [];

  function getLayer(nome) {
    const n = nome || "0";
    if (!layers[n]) {
      layers[n] = { comprimento: 0, area: 0, contagem: 0, tipos: new Set(), blocos: {}, textos: [] };
    }
    return layers[n];
  }

  const entities = parsed?.entities ?? [];
  for (const e of entities) {
    const layerName = e.layer || "0";
    if (deveIgnorarLayer(layerName)) continue;

    // Skip hatch fills — they don't represent measurable elements
    if (e.type === "HATCH") continue;

    const L = getLayer(layerName);
    L.contagem++;
    L.tipos.add(e.type);

    switch (e.type) {
      case "LINE": {
        const len = toM(lineLength(e));
        if (len > 0 && len < 2000) L.comprimento += len;
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const verts = e.vertices ?? e.points ?? [];
        const len = toM(polylineLength(verts));
        if (len > 0 && len < 20000) L.comprimento += len;
        if (e.closed) {
          const area = toM2(polylineArea(verts));
          if (area > 0 && area < 1e6) L.area += area;
        }
        break;
      }
      case "ARC":
      case "CIRCLE": {
        const r = toM(e.radius ?? 0);
        if (r > 0) {
          const frac = e.type === "ARC"
            ? Math.abs((e.endAngle ?? 360) - (e.startAngle ?? 0)) / 360
            : 1;
          L.comprimento += 2 * Math.PI * r * frac;
          if (e.type === "CIRCLE") L.area += Math.PI * r * r;
        }
        break;
      }
      case "INSERT": {
        const rawName = e.name || e.block || "?";
        if (eAnnotationBloco(rawName)) { L.contagem--; break; }

        const nomeNorm = normalizarNomeBloco(rawName);
        const elemId   = extrairIdElemento(rawName);

        // Undoes the generic contagem++ above (INSERT counted separately)
        L.contagem--;

        if (!L.blocos[nomeNorm]) L.blocos[nomeNorm] = new Set();
        L.blocos[nomeNorm].add(elemId);

        if (!blocos[nomeNorm]) blocos[nomeNorm] = { elementIds: new Set(), layers: {} };
        blocos[nomeNorm].elementIds.add(elemId);
        blocos[nomeNorm].layers[layerName] = (blocos[nomeNorm].layers[layerName] || 0) + 1;
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const txt = (e.text || e.string || "").trim();
        if (txt.length >= 2 && txt.length <= 200) {
          L.textos.push(txt);
          textos.push({ texto: txt, layer: layerName });
        }
        break;
      }
      case "DIMENSION": {
        const val = e.actualMeasurement ?? e.measurement;
        if (val && val > 0) {
          dimensions.push({
            valor_m:  toM(val),
            layer:    layerName,
            texto:    e.text || "",
          });
        }
        break;
      }
    }
  }

  // ── Serializa layers ──────────────────────────────────────────────────────────
  const layersJson = {};
  for (const [nome, L] of Object.entries(layers)) {
    // Serialize blocos: Set of element IDs → count of unique physical elements
    const blocosSerial = {};
    for (const [bn, ids] of Object.entries(L.blocos)) {
      blocosSerial[bn] = ids.size;
    }
    const totalBlocos = Object.values(blocosSerial).reduce((s, v) => s + v, 0);
    if (L.contagem <= 0 && L.comprimento < 0.01 && L.area < 0.01 && totalBlocos === 0) continue;
    layersJson[nome] = {
      contagem:    Math.round(L.contagem),
      comprimento: Math.round(L.comprimento * 100) / 100,
      area:        Math.round(L.area * 100) / 100,
      tipos:       [...L.tipos],
      blocos:      blocosSerial,
      textos:      L.textos.slice(0, 20),
    };
  }

  // ── Blocos globais (elementos físicos únicos) ─────────────────────────────────
  const blocosRelevantes = Object.entries(blocos)
    .map(([nome, v]) => [nome, { contagem: v.elementIds.size, layers: v.layers }])
    .filter(([, v]) => v.contagem > 0)
    .sort(([, a], [, b]) => b.contagem - a.contagem)
    .slice(0, 80)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  // ── Resumo ────────────────────────────────────────────────────────────────────
  const nLayers = Object.keys(layersJson).length;
  const totalComprimento = Object.values(layersJson).reduce((s, l) => s + l.comprimento, 0);
  const totalArea        = Object.values(layersJson).reduce((s, l) => s + l.area, 0);
  const totalBlocos      = Object.values(blocosRelevantes).reduce((s, b) => s + b.contagem, 0);
  const escalaMatch      = textos.find(t => /escala\s*[1:]/i.test(t.texto) || /^1:\d+$/.test(t.texto.trim()));

  const unidadeNome =
    fatorUnidade === 1 ? "mm" : fatorUnidade === 10 ? "cm" : fatorUnidade === 1000 ? "m" : "outro";

  return Response.json({
    layers:    layersJson,
    blocos:    blocosRelevantes,
    textos:    textos.slice(0, 80),
    dimensoes: dimensions.slice(0, 100),
    resumo: {
      total_layers:        nLayers,
      total_comprimento_m: Math.round(totalComprimento * 10) / 10,
      total_area_m2:       Math.round(totalArea * 10) / 10,
      total_blocos:        totalBlocos,
      escala:              escalaMatch?.texto || null,
      unidade_detectada:   unidadeNome,
    },
  });
}
