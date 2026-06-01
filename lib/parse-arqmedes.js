/**
 * Parser para exportações do Arquimedes (CYPE)
 *
 * Formatos suportados:
 * 1. CSV / Excel via Mostrar > Lista de Composições > Preços Unitários
 *    Colunas: Código | Descrição | Un. | Preço Unitário  (variações de cabeçalho)
 *
 * 2. FIEBDC-3 (.bc3) — padrão universal de intercâmbio de bancos de preços
 *    Linha tipo: ~D | código | un | nível | preço | ... | descrição
 *
 * Retorna array de: { codigo, descricao, un, preco, fonte }
 */

// Normaliza coluna de unidade (aceita variações de acento, maiúscula, etc.)
function normUn(v) {
  return String(v || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Tenta parse de número float no formato BR (vírgula = decimal) ou EN (ponto = decimal)
function parsePreco(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/\s/g, "");
  // Formato BR: 1.234,56 ou 1234,56
  const br = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(br);
  if (!isNaN(n) && n >= 0) return n;
  return null;
}

// ─── CSV / TEXTO DELIMITADO ────────────────────────────────────────────────────
function detectarDelimitador(linhas) {
  const amostra = linhas.slice(0, 5).join("\n");
  const scores = { ";": 0, ",": 0, "\t": 0, "|": 0 };
  for (const sep of Object.keys(scores)) scores[sep] = (amostra.match(new RegExp(`\\${sep}`, "g")) || []).length;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function splitLinha(linha, sep) {
  if (sep === ",") {
    // Suporta campos entre aspas com vírgula interna
    const result = [];
    let cur = "", inQ = false;
    for (const c of linha) {
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { result.push(cur); cur = ""; }
      else cur += c;
    }
    result.push(cur);
    return result.map(s => s.trim());
  }
  return linha.split(sep).map(s => s.trim().replace(/^"|"$/g, ""));
}

// Mapeamento de nomes de coluna para campo canônico
const COL_MAPS = {
  codigo: ["código","codigo","cod","id","referencia","ref","item","code"],
  descricao: ["descrição","descricao","description","nome","name","serviço","servico","composição","composicao","título","titulo"],
  un: ["un","unid","unidade","un.","unit","und"],
  preco: ["preço","preco","preço unitário","preco unitario","custo","valor","price","total","vr unitário","vr.unit","custo unitario","custo unitário"],
};

function detectarColunas(cabecalho, sep) {
  const cols = splitLinha(cabecalho, sep).map(c =>
    c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()
  );
  const mapa = {};
  for (const [campo, aliases] of Object.entries(COL_MAPS)) {
    for (let i = 0; i < cols.length; i++) {
      if (aliases.some(a => cols[i].includes(a) || a.includes(cols[i]))) {
        if (!(campo in mapa)) mapa[campo] = i;
        break;
      }
    }
  }
  return { mapa, total: cols.length };
}

function parseCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) return [];

  const sep = detectarDelimitador(linhas);
  const { mapa, total } = detectarColunas(linhas[0], sep);

  // Fallback heurístico se colunas não detectadas
  // Tenta detectar pela quantidade de colunas (formato fixo Arqmedes typical: 4-5 cols)
  const temCols = Object.keys(mapa).length >= 2;
  if (!temCols) {
    // Tenta formato posicional: assume 4 colunas (cod, desc, un, preco)
    if (total >= 4) {
      mapa.codigo = 0; mapa.descricao = 1; mapa.un = 2; mapa.preco = 3;
    } else {
      return [];
    }
  }

  const itens = [];
  for (let i = 1; i < linhas.length; i++) {
    const partes = splitLinha(linhas[i], sep);
    if (partes.length < 2) continue;

    const codigo   = mapa.codigo    !== undefined ? partes[mapa.codigo]?.trim()   : null;
    const descricao = mapa.descricao !== undefined ? partes[mapa.descricao]?.trim() : null;
    const un       = mapa.un        !== undefined ? normUn(partes[mapa.un])        : "";
    const preco    = mapa.preco     !== undefined ? parsePreco(partes[mapa.preco]) : null;

    if (!descricao || descricao.length < 2) continue;
    if (preco === null || preco <= 0) continue;

    itens.push({
      codigo: codigo || `ARQ-${i}`,
      descricao,
      un,
      preco,
      fonte: "arqmedes",
    });
  }
  return itens;
}

// ─── EXCEL (xlsx via ArrayBuffer) ─────────────────────────────────────────────
// Lida com o formato que vem do ExcelJS / xlsx no lado servidor.
// No cliente (browser) recebemos um ArrayBuffer que deve ter sido lido via FileReader.
// Esta função recebe o texto já extraído por uma das fontes acima.
// Para Excel, recomendamos converter para CSV antes de chamar.

// ─── FIEBDC-3 (.bc3) ──────────────────────────────────────────────────────────
/**
 * Formato FIEBDC-3:
 * Cada linha começa com um código de tipo: ~V, ~K, ~C, ~D, ~M, ~U, ~G, ~E, ~P, ~Q, ~J, ~O
 *
 * Tipo ~C (composição / capítulo):
 *   ~C|código|descrição|
 *
 * Tipo ~D (insumo / recurso direto):
 *   ~D|código|unidade|tipo|preço_brt|preço_aux|porcentagem_mão_obra|descrição|
 *   tipos: 0=Mão de Obra, 1=Maquinaria, 2=Material, 3=Resíduo, ...
 *
 * Só nos interessam os registros ~D (insumos com preço) e ~C (composições com preço)
 */
function parseFiebdc(texto) {
  const linhas = texto.split(/\r?\n/);
  const itens = [];
  const descMap = {}; // código → descrição (de registros ~C sem preço)

  for (const linha of linhas) {
    if (!linha.startsWith("~")) continue;
    const tipo = linha.slice(0, 2);
    const partes = linha.slice(3).split("|"); // remove "~X|"

    if (tipo === "~C") {
      // ~C|código|unidade|desc|...|preço|
      const cod   = partes[0]?.trim();
      const desc  = partes[2]?.trim() || partes[3]?.trim();
      const unRaw = partes[1]?.trim();
      // Preço pode estar em partes[4] ou adiante — tenta encontrar
      let preco = null;
      for (let k = 3; k < partes.length; k++) {
        const p = parsePreco(partes[k]);
        if (p !== null && p > 0) { preco = p; break; }
      }
      if (cod) descMap[cod] = { cod, desc, un: normUn(unRaw), preco };
      if (cod && desc && preco && preco > 0) {
        itens.push({ codigo: cod, descricao: desc, un: normUn(unRaw), preco, fonte: "arqmedes" });
      }
    }

    if (tipo === "~D") {
      // ~D|código|unidade|tipo|preço_bruto|...?|descrição
      const cod    = partes[0]?.trim();
      const unRaw  = partes[1]?.trim();
      // Ignora tipo 3 (resíduo)
      // Preço bruto está na posição 4 (índice 4 da array partes após o ~D|)
      const preco  = parsePreco(partes[3]);
      // Descrição está geralmente na última posição não-vazia
      let desc = "";
      for (let k = partes.length - 1; k >= 4; k--) {
        if (partes[k]?.trim()) { desc = partes[k].trim(); break; }
      }
      if (!desc && descMap[cod]) desc = descMap[cod].desc;
      if (cod && desc && preco && preco > 0) {
        itens.push({ codigo: cod, descricao: desc, un: normUn(unRaw), preco, fonte: "arqmedes" });
      }
    }
  }
  return itens;
}

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

/**
 * parseArqmedes(texto, extensao) → Array<{codigo, descricao, un, preco, fonte}>
 *
 * @param {string} texto  — conteúdo do arquivo como string
 * @param {string} ext    — extensão original do arquivo (.csv, .txt, .bc3, .xlsx)
 */
export function parseArqmedes(texto, ext = ".csv") {
  const e = ext.toLowerCase().replace(/^\./, "");

  if (e === "bc3") return parseFiebdc(texto);
  // CSV, TXT, XLSX exportado como CSV
  return parseCsv(texto);
}

/**
 * Normaliza e deduplica itens parsed — remove entradas sem código ou sem preço.
 * Se o mesmo código aparecer mais de uma vez, mantém o com maior preço (mais completo).
 */
export function normalizarBanco(itens) {
  const mapa = new Map();
  for (const item of itens) {
    const cod = String(item.codigo || "").trim();
    if (!cod || !item.preco) continue;
    const prev = mapa.get(cod);
    if (!prev || item.preco > prev.preco) {
      mapa.set(cod, { ...item, codigo: cod });
    }
  }
  return [...mapa.values()];
}
