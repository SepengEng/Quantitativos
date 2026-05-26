import { readFileSync } from "fs";
import { join } from "path";
import { SINAPI_BA } from "../../../lib/sinapi";

let cache = null;

function normCod(c) {
  return String(c || "").replace(/\/\d+$/, "").trim();
}

function getItens() {
  if (!cache) {
    try {
      const raw = readFileSync(join(process.cwd(), "lib/sinapi-data.json"), "utf-8");
      cache = JSON.parse(raw);
    } catch {
      cache = {
        referencia: "base embutida",
        totalItens: SINAPI_BA.length,
        itens: SINAPI_BA.map(i => ({ codigo: normCod(i.codigo), descricao: i.descricao, un: i.un, preco: i.preco })),
      };
    }
  }
  return {
    meta: { referencia: cache.referencia, atualizadoEm: cache.atualizadoEm, totalItens: cache.totalItens },
    itens: (cache.itens || []).map(i => ({ ...i, codigo: normCod(i.codigo) })),
  };
}

// Remove acentos e normaliza para comparação
function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Termos técnicos com peso dobrado
const TERMOS_TECNICOS = new Set([
  "concreto","aco","armacao","alvenaria","reboco","drywall","impermeabilizacao",
  "eletroduto","cabo","tubo","sprinkler","split","detector","porcelanato","ceramica",
  "pintura","formas","fundacao","viga","pilar","laje","tijolo","bloco","argamassa",
  "revestimento","esquadria","cobertura","telha","calha","dreno","esgoto","hidraulico",
  "eletrico","luminaria","tomada","disjuntor","quadro","bandeja","mangueira","hidrante",
  "extintor","alarme","camera","rack","fibra","fck","ca50","ca60","aco inox",
]);

const STOPWORDS = new Set(["de","da","do","em","no","na","com","para","por","e","ou","a","o","um","uma","as","os","ao","dos","das","nos","nas"]);

// Pontua semânticamente um item SINAPI contra os termos de busca
function pontuar(item, termos, fraseOriginal) {
  const desc = norm(item.descricao);
  let score = 0;

  // Boost máximo: frase completa encontrada na descrição
  if (fraseOriginal && desc.includes(fraseOriginal)) score += fraseOriginal.length * 4;

  for (const t of termos) {
    if (!desc.includes(t)) continue;
    // Peso base pelo comprimento do termo (termos longos = mais específicos)
    let peso = t.length > 6 ? 4 : t.length > 3 ? 2 : 1;
    // Dobra o peso para termos técnicos conhecidos
    if (TERMOS_TECNICOS.has(t)) peso *= 2;
    // Boost extra se o termo aparece no início da descrição
    if (desc.startsWith(t) || desc.includes(`, ${t}`) || desc.includes(`- ${t}`)) peso += 2;
    score += peso;
  }

  // Penaliza itens com unidade visivelmente incompatível (heurística simples)
  return score;
}

// Checa compatibilidade de unidade entre o item e o SINAPI
function unCompativel(unItem, unSinapi) {
  if (!unItem || !unSinapi) return null;
  const norm1 = unItem.toLowerCase().replace(/[²³]/g, n => n === "²" ? "2" : "3").replace(/\s/g,"");
  const norm2 = unSinapi.toLowerCase().replace(/[²³]/g, n => n === "²" ? "2" : "3").replace(/\s/g,"");
  if (norm1 === norm2) return true;
  // Aliases aceitos
  const GRUPOS = [["m2","m²","m2"],["m3","m³","m3"],["kg","kgf"],["un","unid","und","cj","pç","peca"],["h","hr","hora"],["l","litro","lt"],["m","ml","metro","m1"]];
  for (const g of GRUPOS) { if (g.includes(norm1) && g.includes(norm2)) return true; }
  return false;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q      = (searchParams.get("q") || "").toLowerCase().trim();
  const codigo = normCod(searchParams.get("codigo") || "");
  const match  = (searchParams.get("match") || "").trim();
  const top    = Math.min(parseInt(searchParams.get("top") || "1", 10), 5);
  const unItem = (searchParams.get("un") || "").trim();

  const { meta, itens } = getItens();

  // Batch por múltiplos códigos
  const codigos = (searchParams.get("codigos") || "").split(",").map(normCod).filter(Boolean);
  if (codigos.length > 0) {
    const set = new Set(codigos);
    const mapa = {};
    itens.forEach(i => { if (set.has(i.codigo)) mapa[i.codigo] = i; });
    return Response.json({ ...meta, mapa });
  }

  // Busca semântica por descrição livre (?match=texto livre)
  if (match) {
    const matchNorm = norm(match);
    const termos = matchNorm.split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
    if (!termos.length) return Response.json({ ...meta, item: null, top3: [] });

    const scored = itens
      .map(i => {
        let s = pontuar(i, termos, matchNorm);
        // Bônus de compatibilidade de unidade (quando fornecida)
        if (unItem && unCompativel(unItem, i.un) === true) s += 5;
        return { ...i, _score: s };
      })
      .filter(i => i._score > 0)
      .sort((a, b) => b._score - a._score);

    const mapItem = i => ({ codigo: i.codigo, descricao: i.descricao, un: i.un, preco: i.preco, _score: i._score });
    const item = scored[0] || null;
    const top3 = scored.slice(0, top).map(mapItem);
    return Response.json({ ...meta, item: item ? mapItem(item) : null, top3 });
  }

  // Busca exata por código
  if (codigo) {
    const found = itens.filter(i => i.codigo === codigo);
    return Response.json({ ...meta, itens: found });
  }

  // Busca por texto
  if (q) {
    const found = itens.filter(i =>
      i.descricao?.toLowerCase().includes(q) || i.codigo.includes(q)
    ).slice(0, 30);
    return Response.json({ ...meta, itens: found });
  }

  return Response.json({ ...meta, itens: itens.slice(0, 5) });
}

export async function POST(request) {
  // Valida unidade: recebe { un_item, un_sinapi } e retorna { compativel: bool|null }
  const body = await request.json().catch(() => ({}));
  const compat = unCompativel(body.un_item, body.un_sinapi);
  return Response.json({ compativel: compat });
}
