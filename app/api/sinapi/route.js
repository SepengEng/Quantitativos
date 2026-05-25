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

// Pontua um item SINAPI pela proximidade com a descrição buscada
function pontuar(item, palavras) {
  const desc = item.descricao.toLowerCase();
  let score = 0;
  for (const p of palavras) {
    if (desc.includes(p)) score += p.length > 4 ? 2 : 1;
  }
  return score;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q      = (searchParams.get("q") || "").toLowerCase().trim();
  const codigo = normCod(searchParams.get("codigo") || "");
  const match  = (searchParams.get("match") || "").toLowerCase().trim();

  const { meta, itens } = getItens();

  // Batch por múltiplos códigos
  const codigos = (searchParams.get("codigos") || "").split(",").map(normCod).filter(Boolean);
  if (codigos.length > 0) {
    const set = new Set(codigos);
    const mapa = {};
    itens.forEach(i => { if (set.has(i.codigo)) mapa[i.codigo] = i; });
    return Response.json({ ...meta, mapa });
  }

  // Busca por melhor correspondência de descrição (?match=texto livre)
  if (match) {
    const palavras = match.split(/\s+/).filter(p => p.length > 2);
    if (!palavras.length) return Response.json({ ...meta, item: null });
    const scored = itens
      .map(i => ({ ...i, _score: pontuar(i, palavras) }))
      .filter(i => i._score > 0)
      .sort((a, b) => b._score - a._score);
    const item = scored[0] || null;
    return Response.json({ ...meta, item: item ? { codigo: item.codigo, descricao: item.descricao, un: item.un, preco: item.preco } : null });
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
