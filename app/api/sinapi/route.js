import { readFileSync } from "fs";
import { join } from "path";
import { SINAPI_BA } from "../../../lib/sinapi";

let cache = null;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q      = (searchParams.get("q") || "").toLowerCase();
  const codigo = searchParams.get("codigo") || "";

  // Tentar carregar sinapi-data.json (atualizado pelo GitHub Action)
  // Se não existir, usa a base embutida
  let itens = [];
  let meta  = { referencia: "base embutida", totalItens: SINAPI_BA.length };

  try {
    if (!cache) {
      const raw = readFileSync(join(process.cwd(), "lib/sinapi-data.json"), "utf-8");
      cache = JSON.parse(raw);
    }
    itens = cache.itens || [];
    meta  = { referencia: cache.referencia, atualizadoEm: cache.atualizadoEm, totalItens: cache.totalItens };
  } catch {
    // Fallback para base embutida
    itens = SINAPI_BA.map(i => ({ codigo: i.codigo, descricao: i.descricao, un: i.un, preco: i.preco }));
  }

  if (codigo) {
    itens = itens.filter(i => i.codigo === codigo);
  } else if (q) {
    itens = itens.filter(i =>
      i.descricao?.toLowerCase().includes(q) || i.codigo?.includes(q)
    ).slice(0, 30);
  } else {
    itens = itens.slice(0, 5);
  }

  return Response.json({ ...meta, itens });
}
