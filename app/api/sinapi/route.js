import { readFileSync } from "fs";
import { join } from "path";
import { SINAPI_BA } from "../../../lib/sinapi";

let cache = null;

// Normaliza código: remove /001 ou similar para comparação
function normCod(c) {
  return String(c || "").replace(/\/\d+$/, "").trim();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q      = (searchParams.get("q") || "").toLowerCase().trim();
  const codigo = normCod(searchParams.get("codigo") || "");

  let itens = [];
  let meta  = { referencia: "base embutida", totalItens: SINAPI_BA.length };

  try {
    if (!cache) {
      const raw = readFileSync(join(process.cwd(), "lib/sinapi-data.json"), "utf-8");
      cache = JSON.parse(raw);
    }
    itens = (cache.itens || []).map(i => ({ ...i, codigo: normCod(i.codigo) }));
    meta  = { referencia: cache.referencia, atualizadoEm: cache.atualizadoEm, totalItens: cache.totalItens };
  } catch {
    // Fallback para base embutida
    itens = SINAPI_BA.map(i => ({ codigo: normCod(i.codigo), descricao: i.descricao, un: i.un, preco: i.preco }));
  }

  if (codigo) {
    // Busca exata por código (normalizado)
    itens = itens.filter(i => normCod(i.codigo) === codigo);
  } else if (q) {
    itens = itens.filter(i =>
      i.descricao?.toLowerCase().includes(q) || normCod(i.codigo).includes(q)
    ).slice(0, 30);
  } else {
    itens = itens.slice(0, 5);
  }

  return Response.json({ ...meta, itens });
}
