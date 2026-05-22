import { readFileSync } from "fs";
import { join } from "path";

let cache = null;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").toLowerCase();
  const codigo = searchParams.get("codigo") || "";

  try {
    if (!cache) {
      const raw = readFileSync(join(process.cwd(), "lib/sinapi-data.json"), "utf-8");
      cache = JSON.parse(raw);
    }

    let itens = cache.itens || [];

    if (codigo) {
      itens = itens.filter(i => i.codigo === codigo);
    } else if (q) {
      itens = itens.filter(i =>
        i.descricao.toLowerCase().includes(q) || i.codigo.includes(q)
      ).slice(0, 30);
    } else {
      itens = itens.slice(0, 50);
    }

    return Response.json({
      referencia: cache.referencia,
      atualizadoEm: cache.atualizadoEm,
      totalItens: cache.totalItens,
      itens,
    });
  } catch {
    return Response.json({ error: "SINAPI não disponível", itens: [] }, { status: 500 });
  }
}
