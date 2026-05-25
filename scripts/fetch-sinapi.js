/**
 * fetch-sinapi.js
 * Baixa a tabela SINAPI Bahia do sinapi.app e gera lib/sinapi-data.json
 * Roda automaticamente via GitHub Action todo dia 20 do mês.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const OUTPUT = path.join(__dirname, "../lib/sinapi-data.json");
const URL = "https://sinapi.app/ufs/ba.json";

function getReferencia() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${mm}/${d.getFullYear()}`;
}

function download(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("Timeout")); });
  });
}

async function main() {
  console.log(`Baixando SINAPI BA de ${URL}...`);
  const buf = await download(URL);
  const raw = JSON.parse(buf.toString());

  const itens = raw
    .map(item => ({
      codigo: item.id.replace(/^0+/, "") || item.id,
      descricao: item.descricao,
      un: item.unidade,
      preco: parseFloat((item.precos?.naoDesonerado || "0").replace(/\./g, "").replace(",", ".")) || 0,
    }))
    .filter(i => i.codigo && i.descricao && i.preco > 0);

  const output = {
    referencia: getReferencia(),
    atualizadoEm: new Date().toISOString(),
    uf: "BA",
    modalidade: "Não Desonerado",
    fonte: "sinapi.app",
    totalItens: itens.length,
    itens,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`✅ SINAPI BA ${output.referencia}: ${itens.length} itens salvos em lib/sinapi-data.json`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
