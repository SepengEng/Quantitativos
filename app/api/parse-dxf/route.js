// DXF parser — extrai dados geométricos exatos do AutoCAD para o sistema de quantitativos
// Recebe o arquivo DXF como multipart/form-data, retorna JSON estruturado por layer

import { Helper } from "dxf";

// ── Utilidades geométricas ────────────────────────────────────────────────────

// Distância entre dois pontos 2D
function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Comprimento de uma LWPOLYLINE como soma de segmentos
function polylineLength(vertices) {
  if (!vertices || vertices.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < vertices.length; i++) {
    len += dist(vertices[i - 1], vertices[i]);
  }
  return len;
}

// Área de polígono fechado (fórmula de Gauss/Shoelace) em unidades²
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

// Comprimento de uma LINE
function lineLength(e) {
  if (!e.start || !e.end) return 0;
  return dist(e.start, e.end);
}

// Detecta unidade do arquivo DXF pelo header $INSUNITS
// 0=Sem unidade, 1=Polegadas, 2=Pés, 4=mm, 5=cm, 6=m
function detectarFatorUnidade(parsed) {
  const insUnits = parsed?.header?.$INSUNITS ?? 4; // default: mm
  switch (insUnits) {
    case 1: return 25.4;      // polegadas → mm
    case 2: return 304.8;     // pés → mm
    case 4: return 1;         // mm → mm (padrão Brasil)
    case 5: return 10;        // cm → mm
    case 6: return 1000;      // m → mm
    default: return 1;        // assume mm
  }
}

// Layers a ignorar — eixos, cotas, referências, hachuras, viewports
const LAYER_IGNORE_PATTERNS = [
  /defpoints/i, /eixo/i, /grid/i, /refer/i, /auxiliar/i,
  /^dim/i, /cota/i, /^hatch/i, /hachur/i, /0$/,
  /viewport/i, /^vport/i, /margin/i, /borda/i, /moldura/i,
  /^model/i, /leader/i, /^north/i, /norte/i, /seta/i,
  /^text_/i, /legenda/i, /^leg/i,
];
function deveIgnorarLayer(nome) {
  return LAYER_IGNORE_PATTERNS.some(p => p.test(nome || ""));
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

  // Unidade → converte tudo para metros ao final
  const fatorUnidade = detectarFatorUnidade(parsed);
  const toM  = (mm) => (mm * fatorUnidade) / 1000;   // → metros
  const toM2 = (mm2) => (mm2 * fatorUnidade ** 2) / 1e6; // → m²

  // ── Processa entidades ────────────────────────────────────────────────────────
  const layers = {};      // layer_name → { comprimento_m, area_m2, contagem, tipos, blocos, textos }
  const blocos = {};      // block_name → { contagem, layers }
  const textos = [];      // todos os textos/anotações relevantes
  const dimensions = [];  // dimensões extraídas de DIMENSION entities

  function getLayer(nome) {
    const n = nome || "0";
    if (!layers[n]) layers[n] = { comprimento: 0, area: 0, contagem: 0, tipos: new Set(), blocos: {}, textos: [] };
    return layers[n];
  }

  const entities = parsed?.entities ?? [];
  for (const e of entities) {
    const layerName = e.layer || "0";
    if (deveIgnorarLayer(layerName)) continue;

    const L = getLayer(layerName);
    L.contagem++;
    L.tipos.add(e.type);

    switch (e.type) {
      case "LINE": {
        const len = toM(lineLength(e));
        if (len > 0 && len < 1000) L.comprimento += len; // filtra linhas absurdas
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const verts = e.vertices ?? e.points ?? [];
        const len = toM(polylineLength(verts));
        if (len > 0 && len < 10000) L.comprimento += len;
        if (e.closed) {
          const area = toM2(polylineArea(verts));
          if (area > 0 && area < 1e6) L.area += area;
        }
        break;
      }
      case "CIRCLE":
      case "ARC": {
        const r = toM(e.radius ?? 0);
        if (r > 0) {
          L.comprimento += 2 * Math.PI * r * (e.type === "ARC" ? Math.abs((e.endAngle ?? 360) - (e.startAngle ?? 0)) / 360 : 1);
          if (e.type === "CIRCLE") L.area += Math.PI * r * r;
        }
        break;
      }
      case "INSERT": {
        const blockName = e.name || e.block || "?";
        L.contagem--; // já contado acima, não conta como genérico
        // Incrementa contagem de bloco por layer
        if (!L.blocos[blockName]) L.blocos[blockName] = 0;
        L.blocos[blockName]++;
        // Contagem global de blocos
        if (!blocos[blockName]) blocos[blockName] = { contagem: 0, layers: {} };
        blocos[blockName].contagem++;
        blocos[blockName].layers[layerName] = (blocos[blockName].layers[layerName] || 0) + 1;
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
            valor_mm: val * fatorUnidade,
            valor_m: toM(val),
            layer: layerName,
            texto: e.text || "",
          });
        }
        break;
      }
    }
  }

  // ── Serializa layers para JSON (Set não serializa direto) ─────────────────────
  const layersJson = {};
  for (const [nome, L] of Object.entries(layers)) {
    if (L.contagem <= 0 && L.comprimento < 0.01 && L.area < 0.01 && Object.keys(L.blocos).length === 0) continue;
    layersJson[nome] = {
      contagem:    Math.round(L.contagem),
      comprimento: Math.round(L.comprimento * 100) / 100,  // 2 casas decimais em m
      area:        Math.round(L.area * 100) / 100,          // 2 casas decimais em m²
      tipos:       [...L.tipos],
      blocos:      L.blocos,
      textos:      L.textos.slice(0, 20),                   // limita para não sobrecarregar
    };
  }

  // ── Blocos mais relevantes (mais de 1 ocorrência) ─────────────────────────────
  const blocosRelevantes = Object.entries(blocos)
    .filter(([, v]) => v.contagem > 0)
    .sort(([, a], [, b]) => b.contagem - a.contagem)
    .slice(0, 60)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  // ── Resumo geral ──────────────────────────────────────────────────────────────
  const nLayers = Object.keys(layersJson).length;
  const totalComprimento = Object.values(layersJson).reduce((s, l) => s + l.comprimento, 0);
  const totalArea        = Object.values(layersJson).reduce((s, l) => s + l.area, 0);
  const totalBlocos      = Object.values(blocosRelevantes).reduce((s, b) => s + b.contagem, 0);

  // Extrai possível escala do texto do arquivo
  const escalaMatch = textos.find(t => /escala\s*[1:]/i.test(t.texto) || /^1:\d+$/.test(t.texto.trim()));

  return Response.json({
    layers:    layersJson,
    blocos:    blocosRelevantes,
    textos:    textos.slice(0, 80),
    dimensoes: dimensions.slice(0, 100),
    resumo: {
      total_layers:       nLayers,
      total_comprimento_m: Math.round(totalComprimento * 10) / 10,
      total_area_m2:       Math.round(totalArea * 10) / 10,
      total_blocos:        totalBlocos,
      escala:              escalaMatch?.texto || null,
      unidade_detectada:   fatorUnidade === 1 ? "mm" : fatorUnidade === 10 ? "cm" : fatorUnidade === 1000 ? "m" : "outro",
    },
  });
}
