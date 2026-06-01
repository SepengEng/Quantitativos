/**
 * /api/banco-precos
 *
 * POST  — recebe upload de arquivo Arqmedes/CYPE (CSV, TXT, BC3) e armazena em memória de processo
 *          Body: FormData  campo "file" = arquivo
 *          Retorna: { ok, totalItens, preview: [{codigo,descricao,un,preco}] }
 *
 * GET   — busca semântica no banco carregado
 *          ?match=texto livre  — busca semântica (igual ao /api/sinapi?match=)
 *          ?codigo=XXXXX       — busca exata por código
 *          ?codigos=A,B,C      — batch por múltiplos códigos
 *          ?q=texto            — busca simples por texto
 *          &top=3              — quantos resultados retornar (padrão 1, máx 5)
 *          &un=m2              — filtra/rankeia por unidade compatível
 *          Retorna: { totalItens, fonte: "arqmedes", item, top3, mapa (modo batch) }
 *
 * DELETE — limpa o banco carregado em memória
 */

import { parseArqmedes, normalizarBanco } from "../../../lib/parse-arqmedes";

// ─── Armazenamento em memória de processo ─────────────────────────────────────
// Em produção (Vercel edge/serverless) cada instância tem sua própria memória.
// O frontend deve re-enviar o arquivo se a instância reiniciar.
// Para persistência real, usar KV/Postgres — por ora, memória é suficiente para demo.
let bancoArqmedes = null; // null = não carregado

function getBanco() { return bancoArqmedes; }
function setBanco(itens) { bancoArqmedes = itens; }
function limparBanco() { bancoArqmedes = null; }

// ─── Normalização de strings ───────────────────────────────────────────────────
function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function normCod(c) {
  return String(c || "").replace(/\/\d+$/, "").trim();
}

const STOPWORDS = new Set(["de","da","do","em","no","na","com","para","por","e","ou","a","o","um","uma","as","os","ao","dos","das","nos","nas"]);
const TERMOS_TECNICOS = new Set([
  "concreto","aco","armacao","alvenaria","reboco","drywall","impermeabilizacao",
  "eletroduto","cabo","tubo","sprinkler","split","detector","porcelanato","ceramica",
  "pintura","formas","fundacao","viga","pilar","laje","tijolo","bloco","argamassa",
  "revestimento","esquadria","cobertura","telha","calha","dreno","esgoto","hidraulico",
  "eletrico","luminaria","tomada","disjuntor","quadro","bandeja","mangueira","hidrante",
  "extintor","alarme","camera","rack","fibra","fck","ca50","ca60","aco inox",
]);

// ─── Compatibilidade de unidade ────────────────────────────────────────────────
function unCompativel(u1, u2) {
  if (!u1 || !u2) return null;
  const n1 = u1.toLowerCase().replace(/[²³]/g, n => n === "²" ? "2" : "3").replace(/\s/g,"");
  const n2 = u2.toLowerCase().replace(/[²³]/g, n => n === "²" ? "2" : "3").replace(/\s/g,"");
  if (n1 === n2) return true;
  const GRUPOS = [
    ["m2","m²","m2"],["m3","m³","m3"],["kg","kgf"],
    ["un","unid","und","cj","pç","peca"],["h","hr","hora"],
    ["l","litro","lt"],["m","ml","metro","m1"],
  ];
  for (const g of GRUPOS) { if (g.includes(n1) && g.includes(n2)) return true; }
  return false;
}

// ─── Score semântico ───────────────────────────────────────────────────────────
function pontuar(item, termos, fraseOriginal) {
  const desc = norm(item.descricao);
  let score = 0;
  if (fraseOriginal && desc.includes(fraseOriginal)) score += fraseOriginal.length * 4;
  for (const t of termos) {
    if (!desc.includes(t)) continue;
    let peso = t.length > 6 ? 4 : t.length > 3 ? 2 : 1;
    if (TERMOS_TECNICOS.has(t)) peso *= 2;
    if (desc.startsWith(t) || desc.includes(`, ${t}`) || desc.includes(`- ${t}`)) peso += 2;
    score += peso;
  }
  return score;
}

// ─── POST — upload do arquivo ──────────────────────────────────────────────────
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return Response.json({ ok: false, erro: "Nenhum arquivo enviado" }, { status: 400 });

    const ext  = file.name.split(".").pop() || "csv";
    const text = await file.text();

    if (!text.trim()) return Response.json({ ok: false, erro: "Arquivo vazio" }, { status: 400 });

    const raw    = parseArqmedes(text, `.${ext}`);
    const itens  = normalizarBanco(raw);

    if (itens.length === 0) {
      return Response.json({
        ok: false,
        erro: "Nenhum item reconhecido. Verifique se o arquivo está no formato correto (CSV com colunas Código, Descrição, Unidade, Preço).",
      }, { status: 422 });
    }

    setBanco(itens);

    return Response.json({
      ok: true,
      totalItens: itens.length,
      preview: itens.slice(0, 5).map(({ codigo, descricao, un, preco }) => ({ codigo, descricao, un, preco })),
    });
  } catch (err) {
    console.error("[banco-precos] POST erro:", err);
    return Response.json({ ok: false, erro: err.message }, { status: 500 });
  }
}

// ─── GET — busca ───────────────────────────────────────────────────────────────
export async function GET(request) {
  const banco = getBanco();

  // Retorna estado do banco mesmo sem itens
  if (!banco) {
    return Response.json({ carregado: false, totalItens: 0, item: null, top3: [], mapa: {} });
  }

  const { searchParams } = new URL(request.url);
  const match   = (searchParams.get("match") || "").trim();
  const codigo  = normCod(searchParams.get("codigo") || "");
  const codigos = (searchParams.get("codigos") || "").split(",").map(normCod).filter(Boolean);
  const q       = (searchParams.get("q") || "").toLowerCase().trim();
  const top     = Math.min(parseInt(searchParams.get("top") || "1", 10), 5);
  const unItem  = (searchParams.get("un") || "").trim();

  const meta = { carregado: true, totalItens: banco.length, fonte: "arqmedes" };

  // Batch por múltiplos códigos
  if (codigos.length > 0) {
    const set  = new Set(codigos);
    const mapa = {};
    banco.forEach(i => { if (set.has(normCod(i.codigo))) mapa[normCod(i.codigo)] = i; });
    return Response.json({ ...meta, mapa });
  }

  // Busca semântica por descrição livre
  if (match) {
    const matchNorm = norm(match);
    const termos = matchNorm.split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
    if (!termos.length) return Response.json({ ...meta, item: null, top3: [] });

    const scored = banco
      .map(i => {
        let s = pontuar(i, termos, matchNorm);
        if (unItem && unCompativel(unItem, i.un) === true) s += 5;
        return { ...i, _score: s };
      })
      .filter(i => i._score > 0)
      .sort((a, b) => b._score - a._score);

    const mapItem = i => ({
      codigo: normCod(i.codigo),
      descricao: i.descricao,
      un: i.un,
      preco: i.preco,
      fonte: i.fonte || "arqmedes",
      _score: i._score,
    });
    return Response.json({
      ...meta,
      item: scored[0] ? mapItem(scored[0]) : null,
      top3: scored.slice(0, top).map(mapItem),
    });
  }

  // Busca exata por código
  if (codigo) {
    const found = banco.filter(i => normCod(i.codigo) === codigo);
    return Response.json({ ...meta, itens: found });
  }

  // Busca por texto livre
  if (q) {
    const found = banco
      .filter(i => norm(i.descricao).includes(norm(q)) || normCod(i.codigo).includes(q))
      .slice(0, 30);
    return Response.json({ ...meta, itens: found });
  }

  // Sem parâmetros → retorna amostra + status
  return Response.json({ ...meta, itens: banco.slice(0, 10) });
}

// ─── DELETE — limpa banco ──────────────────────────────────────────────────────
export async function DELETE() {
  limparBanco();
  return Response.json({ ok: true, mensagem: "Banco de preços removido da memória" });
}
