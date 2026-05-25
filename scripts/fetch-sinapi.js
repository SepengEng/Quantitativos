/**
 * fetch-sinapi.js
 * Baixa a tabela SINAPI Bahia da Caixa Econômica Federal
 * e converte em JSON para uso no sistema.
 * Roda automaticamente via GitHub Action todo dia 20 do mês.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// Tenta carregar módulos instalados pelo action
const modulePath = process.env.NODE_PATH || "./node_modules";
let XLSX, AdmZip;
try {
  XLSX = require(path.join(modulePath, "xlsx"));
  AdmZip = require(path.join(modulePath, "adm-zip"));
} catch {
  XLSX = require("xlsx");
  AdmZip = require("adm-zip");
}

const OUTPUT = path.join(__dirname, "../lib/sinapi-data.json");

// Meses para tentar (atual e anterior como fallback)
function getMeses() {
  const agora = new Date();
  const meses = [];
  for (let i = 0; i <= 2; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    meses.push({ mm, yyyy, label: `${mm}/${yyyy}` });
  }
  return meses;
}

// Padrões de URL da Caixa para SINAPI Bahia
function getURLs(mm, yyyy) {
  return [
    `https://www.caixa.gov.br/Downloads/sinapi-custo-ref-composicoes-sintetico-ba/SINAPI_ref_insu_comp_BA_${mm}${yyyy}_NaoDesonerado.zip`,
    `https://www.caixa.gov.br/Downloads/sinapi-custo-ref-insumos-sintetico-ba/SINAPI_ref_insu_BA_${mm}${yyyy}_NaoDesonerado.zip`,
    // Padrão alternativo (nome sem "insu")
    `https://www.caixa.gov.br/Downloads/sinapi-custo-ref-composicoes-sintetico-ba/SINAPI_ref_comp_BA_${mm}${yyyy}_NaoDesonerado.zip`,
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function downloadFile(url, tentativa = 1) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: 90000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "*/*",
      },
    };
    const chunks = [];
    const req = https.get(url, opts, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadFile(res.headers.location, tentativa).then(resolve).catch(reject);
      }
      if (res.statusCode === 429) {
        req.destroy();
        return reject(new Error("HTTP 429"));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const itens = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // Procurar linhas com código SINAPI (5-6 dígitos) e preço
    for (const row of rows) {
      const cols = row.map((c) => String(c).trim());
      // Código SINAPI: coluna com 5-6 dígitos numéricos
      const codigoIdx = cols.findIndex((c) => /^\d{5,6}$/.test(c));
      if (codigoIdx === -1) continue;

      const codigo = cols[codigoIdx];
      const descricao = cols[codigoIdx + 1] || "";
      const un = cols[codigoIdx + 2] || "";
      // Preço: primeiro número decimal após unidade
      let preco = 0;
      for (let j = codigoIdx + 3; j < Math.min(codigoIdx + 8, cols.length); j++) {
        const v = parseFloat(cols[j].replace(",", ".").replace(/[^\d.]/g, ""));
        if (!isNaN(v) && v > 0) { preco = v; break; }
      }

      if (!descricao || preco === 0) continue;

      itens.push({
        codigo,
        descricao: descricao.substring(0, 200).toUpperCase(),
        un: un.substring(0, 10),
        preco: Math.round(preco * 100) / 100,
      });
    }
  }

  // Deduplicar por código
  const map = new Map();
  for (const item of itens) {
    if (!map.has(item.codigo)) map.set(item.codigo, item);
  }
  return [...map.values()].sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

async function main() {
  const meses = getMeses();
  let itens = [];
  let mesRef = "";

  for (const { mm, yyyy, label } of meses) {
    for (const url of getURLs(mm, yyyy)) {
      try {
        console.log(`Tentando: ${url}`);
        const zipBuffer = await downloadFile(url);
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries().filter((e) => e.name.endsWith(".xlsx") || e.name.endsWith(".xls"));

        if (entries.length === 0) continue;

        for (const entry of entries) {
          const buf = entry.getData();
          const parsed = parseExcel(buf);
          if (parsed.length > 100) {
            itens = [...itens, ...parsed];
            console.log(`✅ ${entry.name}: ${parsed.length} itens`);
          }
        }

        if (itens.length > 100) { mesRef = label; break; }
      } catch (e) {
        console.log(`❌ ${e.message}`);
        // Delay entre tentativas para evitar rate limit
        await sleep(3000);
      }
    }
    if (itens.length > 100) break;
  }

  if (itens.length === 0) {
    console.log("⚠️  Não foi possível baixar da Caixa. Mantendo dados existentes.");
    process.exit(0);
  }

  // Deduplicar final
  const map = new Map();
  for (const i of itens) map.set(i.codigo, i);
  const final = [...map.values()];

  const output = {
    referencia: mesRef,
    atualizadoEm: new Date().toISOString(),
    uf: "BA",
    modalidade: "Não Desonerado",
    totalItens: final.length,
    itens: final,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`\n✅ SINAPI BA ${mesRef}: ${final.length} itens salvos em lib/sinapi-data.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
