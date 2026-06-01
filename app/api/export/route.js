import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

// ── Fallback quando a IA não fornece MAT/MO separados ────────────────────────
const PCT_MAT_FB = 0.65;
const PCT_MO_FB  = 0.35;

// Encargos Sociais SINAPI BA Não Desonerado (dez/2024)
const ENCARGOS = 68.04;

// Taxas horárias SINAPI BA — usadas quando mo_itens não traz preco
const LABOR_RATES = {
  "pedreiro":    14.83, "oficial":      14.83, "armador":      14.83,
  "carpinteiro": 14.83, "eletricista":  15.50, "encanador":    15.50,
  "encarregado": 18.50, "servente":      9.12, "montagem":      4.00,
};
function laborRate(tipo = "") {
  const k = Object.keys(LABOR_RATES).find(r => tipo.toLowerCase().includes(r));
  return k ? LABOR_RATES[k] : 14.83;
}

// ── Funções auxiliares ─────────────────────────────────────────────────────────
function num(v) { return typeof v === "number" ? v : parseFloat(v) || 0; }

// Calcula custo MAT por unidade de composição
function calcMAT(item) {
  if (item.mat_preco != null) {
    const ind = num(item.mat_ind) || 1.0;
    return item.mat_preco * ind;                // R$/un MAT real
  }
  return num(item.preco_sinapi) * PCT_MAT_FB;  // fallback estimado
}

// Calcula custo MO por unidade de composição + retorna array de sub-itens
function calcMO(item) {
  if (item.mo_itens && item.mo_itens.length > 0) {
    const subItens = item.mo_itens.map(mi => ({
      tipo:  mi.tipo  || "Mão de obra",
      un:    mi.un    || "h",
      ind:   num(mi.ind),
      preco: num(mi.preco) || laborRate(mi.tipo),
    }));
    const moPreco = subItens.reduce((s, mi) => s + mi.ind * mi.preco, 0);
    return { moPreco, subItens };
  }
  // fallback: 60% pedreiro + 40% servente
  const moPreco = num(item.preco_sinapi) * PCT_MO_FB;
  const subItens = [
    { tipo: "Oficial / Pedreiro", un: "h", ind: +(moPreco * 0.6 / 14.83).toFixed(4), preco: 14.83 },
    { tipo: "Servente",           un: "h", ind: +(moPreco * 0.4 /  9.12).toFixed(4), preco:  9.12 },
  ];
  return { moPreco, subItens };
}

// ── Paleta de cores ────────────────────────────────────────────────────────────
const C = {
  cabecalho: "FF1B2A3B",
  colHeader: "FF0E7490",
  capitulo:  "FF155E75",
  matSecBg:  "FFBBDEFB", matSecTxt: "FF0D47A1",
  matLocBg:  "FFE3F2FD",
  compBg:    "FFFFFFFF", compParBg: "FFF8FAFC",
  matBg:     "FFFEF9F0", matParBg:  "FFFDF4E1",
  moSecBg:   "FFC8E6C9", moSecTxt:  "FF1B5E20",
  moLocBg:   "FFE8F5E9",
  moCompBg:  "FFFFFFFF", moCompPar: "FFF0FDF4",
  moBg:      "FFE8F5E9", moParBg:   "FFD1FAE5",
  encargBg:  "FFFFF9C3",
  totalFundo:"FFD1FAE5", totalBdi:  "FF059669",
  cinza:     "FF6B7280", texto:     "FF111827",
};

// ── Colunas A–P (espelho F18) ──────────────────────────────────────────────────
const COLS = [
  { key:"cod",    width:22 }, // A
  { key:"tipo",   width:13 }, // B
  { key:"c",      width:12 }, // C ┐
  { key:"d",      width:10 }, // D │
  { key:"e",      width:10 }, // E │ C-I mescladas → descrição
  { key:"f",      width:10 }, // F │
  { key:"g",      width:10 }, // G │
  { key:"h",      width:10 }, // H │
  { key:"i",      width: 5 }, // I ┘
  { key:"ud",     width: 8 }, // J
  { key:"qte",    width:12 }, // K
  { key:"ind",    width: 8 }, // L
  { key:"compAx", width:14 }, // M Comp.Ax.
  { key:"comp",   width:14 }, // N Comp.(R$)
  { key:"preco",  width:14 }, // O Preço(R$)
  { key:"valor",  width:16 }, // P Valor(R$)
];

const FMT = "#,##0.00";
const FMT_PCT = '0.00"%"';

// CRÍTICO: addRow ANTES de mergeCells — evita linha em branco fantasma
function addRow(ws, data) {
  const row = ws.addRow(data);
  ws.mergeCells(row.number, 3, row.number, 9); // C–I
  return row;
}

function numFmt(row, cols) {
  for (const c of cols) {
    row.getCell(c).numFmt = FMT;
    row.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
  }
}

function style(row, { bg, bold = false, fs = 9.5, fc = C.texto, h = 16 } = {}) {
  row.height = h;
  row.eachCell({ includeEmpty: true }, cell => {
    if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.font      = { bold, size: fs, color: { argb: fc } };
    cell.alignment = { vertical: "middle" };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// MODO QUANTITATIVO — formato limpo sem MO, foco em precisão de levantamento
// ════════════════════════════════════════════════════════════════════════════════
// Normaliza nome de disciplina: garante capitalização consistente (Hidrossanitária ≠ hidrossanitária → mesma aba)
function normDisc(d) {
  if (!d) return "Sem disciplina";
  return d.charAt(0).toUpperCase() + d.slice(1);
}

// Gera Excel no formato Arquimedes (aba única, hierarquia Capítulo→Artigo)
async function gerarQuantitativo(obra, incluirPreco) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quantitativos IA — Sepeng Engenharia";
  wb.created = new Date();

  const ws = wb.addWorksheet("Folha 1");

  // Colunas: A=Código, B=Tipo, C=Ud, D-J=Resumo(mesclado), K=Qtd, L=Preço, M=Importância
  ws.columns = [
    { width: 8   }, // A Código
    { width: 7   }, // B Tipo
    { width: 4   }, // C Ud
    { width: 18  }, // D Resumo (parte 1)
    { width: 10  }, // E
    { width: 6   }, // F
    { width: 6   }, // G
    { width: 6   }, // H
    { width: 6   }, // I
    { width: 6   }, // J
    { width: 10  }, // K Quantidade
    { width: 13  }, // L Preço (R$)
    { width: 15  }, // M Importância (R$)
  ];

  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const font = (opts) => ({ name: "Arial", size: 9, ...opts });
  const aln  = (opts) => ({ vertical: "middle", ...opts });

  // Mescla colunas D-J numa linha
  const mergeD = (rn) => ws.mergeCells(rn, 4, rn, 10);

  // Aplica cor de fundo + negrito a toda a linha
  const colorRow = (r, bg, bold = false) => {
    r.eachCell({ includeEmpty: true }, c => {
      c.fill      = fill(bg);
      c.font      = font({ bold });
      c.alignment = aln();
    });
  };

  // ── Linha 1: Obra
  ws.mergeCells("B1:M1");
  const r1 = ws.getRow(1); r1.height = 18;
  r1.getCell(1).value = "Obra:";
  r1.getCell(2).value = obra.nome || "";
  colorRow(r1, "FFDFFFBF", true);

  // ── Linha 2: Orçamento + % C.I.
  ws.mergeCells("A2:C2");
  const r2 = ws.getRow(2); r2.height = 16;
  r2.getCell(1).value  = "Orçamento";
  r2.getCell(12).value = "% C.I.";
  r2.getCell(13).value = 0;
  colorRow(r2, "FFDFFFBF", true);

  // ── Linha 3: Cabeçalhos
  mergeD(3);
  const r3 = ws.getRow(3); r3.height = 18;
  ["Código","Tipo","Ud","Resumo",null,null,null,null,null,null,"Quantidade","Preço (R$)","Importância (R$)"].forEach((v,i)=>{
    if (v !== null) r3.getCell(i+1).value = v;
  });
  colorRow(r3, "FFDFFFBF", true);

  // ── Dados
  const plantas = obra.plantas || [];
  const grupos  = {};
  for (const p of plantas) {
    const d = normDisc(p.disciplina);
    if (!grupos[d]) grupos[d] = [];
    grupos[d].push(p);
  }

  // Linha 4: capítulo raiz (nome da obra)
  mergeD(4);
  const r4 = ws.getRow(4); r4.height = 18;
  r4.getCell(1).value = obra.nome || "OBRA";
  r4.getCell(2).value = "Capítulo";
  r4.getCell(12).value = 0;
  r4.getCell(13).value = 0;
  colorRow(r4, "FF269900", true);

  // Rastreia linhas dos subtotais de capítulo para fórmulas de soma
  const discSubtotalRows = [];
  let discN = 1;

  for (const [disc, gplantas] of Object.entries(grupos)) {
    // Capítulo nível 1 — disciplina
    const rDisc = ws.addRow([]); rDisc.height = 16;
    mergeD(rDisc.number);
    rDisc.getCell(1).value = String(discN);
    rDisc.getCell(2).value = "Capítulo";
    rDisc.getCell(4).value = disc;
    rDisc.getCell(12).value = 0;
    rDisc.getCell(13).value = 0;
    colorRow(rDisc, "FF3FB219", true);

    const plantaSubtotalRows = [];
    let plantaN = 1;

    for (const planta of gplantas) {
      const pCode = `${discN}.${plantaN}`;

      // Capítulo nível 2 — planta (arquivo)
      const rPlanta = ws.addRow([]); rPlanta.height = 16;
      mergeD(rPlanta.number);
      rPlanta.getCell(1).value = pCode;
      rPlanta.getCell(2).value = "Capítulo";
      rPlanta.getCell(4).value = planta.fileName || `Planta ${plantaN}`;
      rPlanta.getCell(12).value = 0;
      rPlanta.getCell(13).value = 0;
      colorRow(rPlanta, "FF58CB32", true);

      const itemMRows = [];
      let itemN = 1;

      for (const item of planta.itens || []) {
        const iCode = `${pCode}.${itemN}.`;
        const rItem = ws.addRow([]); rItem.height = 15;
        mergeD(rItem.number);

        rItem.getCell(1).value = iCode;
        rItem.getCell(2).value = "Artigo";
        rItem.getCell(3).value = item.un || "";
        rItem.getCell(4).value = item.descricao || "";
        rItem.getCell(11).value = num(item.qtd) || 0;

        const pr = num(item.preco_sinapi);
        const rn = rItem.number;
        // Fórmula preço (com ajuste % C.I. da célula M2)
        if (incluirPreco && pr > 0) {
          rItem.getCell(12).value = { formula: `ROUND(${pr.toFixed(4)}*(1+M2/100),2)` };
          rItem.getCell(12).numFmt = "#,##0.00";
          rItem.getCell(13).value = { formula: `ROUND(K${rn}*L${rn},2)` };
          rItem.getCell(13).numFmt = "#,##0.00";
        } else {
          rItem.getCell(12).value = pr;
          rItem.getCell(13).value = num(item.qtd) * pr;
          if (pr) { rItem.getCell(12).numFmt = "#,##0.00"; rItem.getCell(13).numFmt = "#,##0.00"; }
        }

        rItem.getCell(11).alignment = aln({ horizontal: "right" });
        rItem.getCell(12).alignment = aln({ horizontal: "right" });
        rItem.getCell(13).alignment = aln({ horizontal: "right" });
        rItem.eachCell({ includeEmpty: true }, c => { c.font = font({ bold: true }); c.alignment = { ...(c.alignment || {}), vertical: "middle" }; });

        itemMRows.push(`M${rn}`);
        itemN++;
      }

      // Subtotal planta
      const rSubP = ws.addRow([]); rSubP.height = 14;
      mergeD(rSubP.number);
      rSubP.getCell(4).value = pCode;
      if (itemMRows.length) {
        rSubP.getCell(12).value = { formula: `${itemMRows.map(m=>m.replace("M","L")).join("+")}` };
        rSubP.getCell(13).value = { formula: `ROUND(L${rSubP.number},2)` };
        rSubP.getCell(12).numFmt = "#,##0.00";
        rSubP.getCell(13).numFmt = "#,##0.00";
      }
      rSubP.getCell(12).alignment = aln({ horizontal: "right" });
      rSubP.getCell(13).alignment = aln({ horizontal: "right" });

      plantaSubtotalRows.push(`M${rSubP.number}`);
      plantaN++;
    }

    // Subtotal disciplina
    const rSubD = ws.addRow([]); rSubD.height = 14;
    mergeD(rSubD.number);
    rSubD.getCell(4).value = String(discN);
    if (plantaSubtotalRows.length) {
      rSubD.getCell(12).value = { formula: plantaSubtotalRows.map(m=>m.replace("M","L")).join("+") };
      rSubD.getCell(13).value = { formula: `ROUND(L${rSubD.number},2)` };
      rSubD.getCell(12).numFmt = "#,##0.00";
      rSubD.getCell(13).numFmt = "#,##0.00";
    }
    rSubD.getCell(12).alignment = aln({ horizontal: "right" });
    rSubD.getCell(13).alignment = aln({ horizontal: "right" });

    discSubtotalRows.push(`M${rSubD.number}`);
    discN++;
  }

  // Subtotal geral (linha raiz)
  const rTotal = ws.addRow([]); rTotal.height = 16;
  mergeD(rTotal.number);
  rTotal.getCell(4).value = obra.nome || "TOTAL";
  if (discSubtotalRows.length) {
    rTotal.getCell(12).value = { formula: discSubtotalRows.map(m=>m.replace("M","L")).join("+") };
    rTotal.getCell(13).value = { formula: `ROUND(L${rTotal.number},2)` };
    rTotal.getCell(12).numFmt = "#,##0.00";
    rTotal.getCell(13).numFmt = "#,##0.00";
  }
  rTotal.getCell(12).alignment = aln({ horizontal: "right" });
  rTotal.getCell(13).alignment = aln({ horizontal: "right" });
  rTotal.eachCell({ includeEmpty: true }, c => { c.font = font({ bold: true }); });

  const buf  = await wb.xlsx.writeBuffer();
  const nome = `QTD_${(obra.nome||"Obra").replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}_${new Date().toISOString().slice(0,10)}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
}

// ── Handler principal ──────────────────────────────────────────────────────────
export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Payload inválido" }, { status: 400 }); }

  const { obra, bdi = 25, modo = "quantitativo", incluirPreco = false } = body;
  if (!obra) return Response.json({ error: "Obra não informada" }, { status: 400 });

  try {
  // Modo quantitativo (padrão) — formato limpo sem MO
  if (modo === "quantitativo") return await gerarQuantitativo(obra, incluirPreco);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Quantitativos IA — Sepeng Engenharia";
  wb.created = new Date();

  const ws = wb.addWorksheet("Orçamento", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    views: [{ state: "frozen", ySplit: 3 }],
  });
  ws.columns = COLS;

  // ── Cabeçalho (linhas 1–3) ───────────────────────────────────────────────────
  const r1 = ws.addRow({});
  r1.height = 36;
  ws.mergeCells("A1:P1");
  Object.assign(r1.getCell("A"), {
    value: "ORÇAMENTO EXECUTIVO — SEPENG ENGENHARIA",
    font:  { bold: true, size: 16, color: { argb: "FFFFFFFF" } },
    fill:  { type: "pattern", pattern: "solid", fgColor: { argb: C.cabecalho } },
    alignment: { vertical: "middle", horizontal: "center" },
  });

  const r2 = ws.addRow({});
  r2.height = 18;
  ws.mergeCells("A2:J2"); ws.mergeCells("K2:P2");
  r2.getCell("A").value     = `Obra: ${obra.nome || "—"}`;
  r2.getCell("A").font      = { bold: true, size: 11 };
  r2.getCell("A").fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  r2.getCell("K").value     = `Data: ${new Date().toLocaleDateString("pt-BR")}   BDI: ${bdi}%`;
  r2.getCell("K").font      = { italic: true, size: 10 };
  r2.getCell("K").fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  r2.getCell("K").alignment = { horizontal: "right", vertical: "middle" };

  const rH = ws.addRow({});
  rH.height = 22;
  ws.mergeCells("C3:I3");
  for (const [col, label] of Object.entries({
    A:"Cód.", B:"Tipo", C:"Resumo / Descrição",
    J:"Ud", K:"Qtd", L:"Índ.", M:"Comp.Ax.(R$)", N:"Comp.(R$)", O:"Preço(R$)", P:"Valor(R$)",
  })) {
    const cell = rH.getCell(col);
    cell.value     = label;
    cell.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.colHeader } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }

  // Logo
  const logoPath = path.join(process.cwd(), "public", "logo_sepeng.png");
  if (fs.existsSync(logoPath)) {
    ws.addImage(wb.addImage({ filename: logoPath, extension: "png" }),
      { tl: { col: 0, row: 0 }, br: { col: 2, row: 3 } });
  }

  // ── Agrupa por disciplina ─────────────────────────────────────────────────────
  const plantas = obra.plantas || [];
  const grupos  = {};
  for (const p of plantas) {
    const d = normDisc(p.disciplina);
    if (!grupos[d]) grupos[d] = [];
    grupos[d].push(p);
  }
  const disciplinas = Object.entries(grupos);

  // Pré-calcula totais MAT e MO para o capítulo
  let totalMAT = 0, totalMO = 0;
  for (const [, gp] of disciplinas) {
    for (const p of gp) {
      for (const i of p.itens || []) {
        const qtd = num(i.qtd);
        totalMAT += calcMAT(i) * qtd;
        totalMO  += calcMO(i).moPreco * qtd;
      }
    }
  }
  const totalObra = totalMAT + totalMO;

  // ── 1 — CAPÍTULO ─────────────────────────────────────────────────────────────
  const rCap = addRow(ws, { cod: "1", tipo: "Capítulo", c: (obra.nome || "OBRA").toUpperCase(), valor: totalObra });
  style(rCap, { bg: C.capitulo, bold: true, fs: 11, fc: "FFFFFFFF", h: 22 });
  numFmt(rCap, ["P"]);

  let zebra = 0;

  // ════════════════════════════════════════════════════════════════════════════
  // BLOCO MAT  (1.1, 1.2, … — um por disciplina)
  // ════════════════════════════════════════════════════════════════════════════
  let matN = 1;

  for (const [disc, gplantas] of disciplinas) {
    const discMAT = gplantas.reduce(
      (s, p) => s + (p.itens || []).reduce((ss, i) => ss + calcMAT(i) * num(i.qtd), 0), 0
    );

    // 1.matN — MAT - [Disciplina]
    const rMatSec = addRow(ws, { cod: `1.${matN}`, c: `MAT - ${disc}`, valor: discMAT });
    style(rMatSec, { bg: C.matSecBg, bold: true, fs: 10, h: 19 });
    rMatSec.getCell("A").font = { bold: true, size: 10, color: { argb: C.matSecTxt } };
    rMatSec.getCell("C").font = { bold: true, size: 10, color: { argb: C.matSecTxt } };
    rMatSec.getCell("C").alignment = { vertical: "middle" };
    numFmt(rMatSec, ["P"]);

    let locN = 1;
    for (const planta of gplantas) {
      const plantaMAT = (planta.itens || []).reduce((s, i) => s + calcMAT(i) * num(i.qtd), 0);

      // 1.matN.locN — localização (usa item.localizacao se disponível, senão fileName)
      const locLabel = planta.fileName || "Planta";
      const rLoc = addRow(ws, { cod: `1.${matN}.${locN}`, c: locLabel, valor: plantaMAT });
      style(rLoc, { bg: C.matLocBg, bold: true, fs: 9.5, h: 17 });
      rLoc.getCell("C").alignment = { vertical: "middle" };
      numFmt(rLoc, ["P"]);

      // Agrupa itens por localizacao (campo novo da IA)
      const byLoc = {};
      for (const item of planta.itens || []) {
        const loc = item.localizacao || locLabel;
        if (!byLoc[loc]) byLoc[loc] = [];
        byLoc[loc].push(item);
      }

      // Se há múltiplas localizações dentro da planta, cria sub-grupos
      const locEntries = Object.entries(byLoc);
      const hasSubLoc  = locEntries.length > 1;

      let subLocN = 1;
      for (const [locName, itensPorLoc] of locEntries) {
        let compStart = 1;

        if (hasSubLoc) {
          // Sub-localização: 1.matN.locN.subLocN
          const subTotal = itensPorLoc.reduce((s, i) => s + calcMAT(i) * num(i.qtd), 0);
          const rSubLoc  = addRow(ws, { cod: `1.${matN}.${locN}.${subLocN}`, c: locName, valor: subTotal });
          style(rSubLoc, { bg: "FFE1F5FE", bold: false, fs: 9, h: 15 });
          rSubLoc.getCell("C").alignment = { vertical: "middle" };
          numFmt(rSubLoc, ["P"]);
        }

        for (const item of itensPorLoc) {
          zebra++;
          const par      = zebra % 2 === 0;
          const qtd      = num(item.qtd);
          const matPreco = calcMAT(item);
          const matValor = matPreco * qtd;
          const compCod  = hasSubLoc
            ? `1.${matN}.${locN}.${subLocN}.${compStart}`
            : `1.${matN}.${locN}.${compStart}`;

          // Composição
          const rComp = addRow(ws, {
            cod:   compCod,
            tipo:  "Composição",
            c:     item.mat_descricao || item.descricao || "",
            ud:    item.un || "",
            qte:   qtd || "",
            preco: matPreco || "",
            valor: matValor || "",
          });
          style(rComp, { bg: par ? C.compParBg : C.compBg, fs: 9.5, h: 16 });
          rComp.getCell("B").font      = { size: 9, italic: true, color: { argb: C.cinza } };
          rComp.getCell("C").alignment = { vertical: "middle", wrapText: false };
          numFmt(rComp, ["K", "O", "P"]);

          // Material sub-linha
          const matSinapi = item.mat_sinapi || item.sinapi_sugerido || "";
          const matDesc   = item.mat_descricao || item.descricao || "";
          const matLabel  = matSinapi ? `${matDesc}  [SINAPI ${matSinapi}]` : matDesc;
          const matInd    = num(item.mat_ind) || 1.00;
          const matPUnit  = item.mat_preco || matPreco; // preço do insumo

          const rMat = addRow(ws, {
            cod:   `${compCod}.1`,
            tipo:  "Material",
            c:     matLabel,
            ud:    item.un || "",
            qte:   qtd * matInd,
            ind:   matInd,
            comp:  matPUnit || "",
            preco: matPreco || "",
            valor: matValor || "",
          });
          style(rMat, { bg: par ? C.matParBg : C.matBg, fs: 9, h: 14 });
          rMat.getCell("B").font      = { size: 9, color: { argb: "FF0E7490" } };
          rMat.getCell("A").font      = { size: 8.5, color: { argb: C.cinza } };
          rMat.getCell("C").alignment = { vertical: "middle", wrapText: false };
          numFmt(rMat, ["K", "L", "N", "O", "P"]);

          compStart++;
        }
        subLocN++;
      }
      locN++;
    }
    matN++;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BLOCO M.O.  (1.matN — uma seção única)
  // ════════════════════════════════════════════════════════════════════════════
  const moSecN = matN;

  const rMoSec = addRow(ws, { cod: `1.${moSecN}`, c: `M.O. - ${obra.nome || "OBRA"}`, valor: totalMO });
  style(rMoSec, { bg: C.moSecBg, bold: true, fs: 10, h: 19 });
  rMoSec.getCell("A").font      = { bold: true, size: 10, color: { argb: C.moSecTxt } };
  rMoSec.getCell("C").font      = { bold: true, size: 10, color: { argb: C.moSecTxt } };
  rMoSec.getCell("C").alignment = { vertical: "middle" };
  numFmt(rMoSec, ["P"]);

  let moLocN = 1;
  for (const [disc, gplantas] of disciplinas) {
    for (const planta of gplantas) {
      const plantaMO = (planta.itens || []).reduce((s, i) => s + calcMO(i).moPreco * num(i.qtd), 0);

      // Localização MO
      const rMoLoc = addRow(ws, {
        cod:   `1.${moSecN}.${moLocN}`,
        c:     `${disc} — ${planta.fileName || "Planta"}`,
        valor: plantaMO,
      });
      style(rMoLoc, { bg: C.moLocBg, bold: true, fs: 9.5, h: 17 });
      rMoLoc.getCell("C").alignment = { vertical: "middle" };
      numFmt(rMoLoc, ["P"]);

      let compN = 1;
      for (const item of planta.itens || []) {
        // Itens sem MO (só fornecimento) → pula
        if (!item.mo_itens && !num(item.preco_sinapi)) { compN++; continue; }

        zebra++;
        const par          = zebra % 2 === 0;
        const qtd          = num(item.qtd);
        const { moPreco, subItens } = calcMO(item);
        const moValor      = moPreco * qtd;
        const moSinapi     = item.mo_sinapi || "";
        const moDesc       = item.mo_descricao
          ? `${item.mo_descricao}${moSinapi ? `  [SINAPI ${moSinapi}]` : ""}`
          : `Instalação/Execução: ${item.descricao || ""}`;

        // Composição MO
        const rMoComp = addRow(ws, {
          cod:   `1.${moSecN}.${moLocN}.${compN}`,
          tipo:  "Composição",
          c:     moDesc,
          ud:    item.un || "",
          qte:   qtd || "",
          preco: moPreco || "",
          valor: moValor || "",
        });
        style(rMoComp, { bg: par ? C.moCompPar : C.moCompBg, fs: 9, h: 15 });
        rMoComp.getCell("B").font      = { size: 9, italic: true, color: { argb: C.cinza } };
        rMoComp.getCell("C").alignment = { vertical: "middle", wrapText: false };
        numFmt(rMoComp, ["K", "O", "P"]);

        // Sub-linhas de Mão de obra
        let moSubN = 1;
        let laborTotal = 0;
        for (const mi of subItens) {
          const miValor = mi.ind * mi.preco * qtd;
          laborTotal   += miValor;

          const rMi = addRow(ws, {
            cod:   `1.${moSecN}.${moLocN}.${compN}.${moSubN}`,
            tipo:  "Mão de obra",
            c:     mi.tipo,
            ud:    mi.un,
            qte:   qtd * mi.ind,
            ind:   mi.ind,
            comp:  mi.preco,
            preco: mi.preco,
            valor: miValor,
          });
          style(rMi, { bg: par ? C.moParBg : C.moBg, fs: 8.5, h: 13 });
          rMi.getCell("B").font      = { size: 8.5, color: { argb: "FF059669" } };
          rMi.getCell("A").font      = { size: 8, color: { argb: C.cinza } };
          rMi.getCell("C").alignment = { vertical: "middle", wrapText: false };
          numFmt(rMi, ["K", "L", "N", "O", "P"]);
          moSubN++;
        }

        // Encargos Sociais
        const encargosValor = laborTotal * ENCARGOS / 100;
        const rEnc = addRow(ws, {
          cod:   `1.${moSecN}.${moLocN}.${compN}.${moSubN}`,
          tipo:  "",
          c:     "Encargos Sociais",
          ud:    "%",
          ind:   ENCARGOS,
          valor: encargosValor,
        });
        style(rEnc, { bg: C.encargBg, fs: 8, h: 12 });
        rEnc.getCell("A").font      = { size: 8, color: { argb: C.cinza } };
        rEnc.getCell("C").font      = { size: 8, italic: true, color: { argb: C.cinza } };
        rEnc.getCell("C").alignment = { vertical: "middle", wrapText: false };
        rEnc.getCell("L").numFmt    = FMT_PCT;
        rEnc.getCell("L").alignment = { horizontal: "right", vertical: "middle" };
        numFmt(rEnc, ["P"]);

        compN++;
      }
      moLocN++;
    }
  }

  // ── Totais ────────────────────────────────────────────────────────────────────
  ws.addRow({});

  const rT1 = ws.addRow({ cod: "TOTAL SEM BDI", valor: totalObra });
  ws.mergeCells(rT1.number, 1, rT1.number, 15);
  rT1.height = 22;
  rT1.eachCell({ includeEmpty: true }, c => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalFundo } };
    c.font = { bold: true, size: 12 };
  });
  rT1.getCell("A").alignment = { horizontal: "right", vertical: "middle" };
  numFmt(rT1, ["P"]);

  const rT2 = ws.addRow({ cod: `TOTAL COM BDI ${bdi}%`, valor: totalObra * (1 + bdi / 100) });
  ws.mergeCells(rT2.number, 1, rT2.number, 15);
  rT2.height = 26;
  rT2.eachCell({ includeEmpty: true }, c => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalBdi } };
    c.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  });
  rT2.getCell("A").alignment = { horizontal: "right", vertical: "middle" };
  numFmt(rT2, ["P"]);

  // Rodapé
  ws.addRow({});
  const rodTxt = `Gerado por Quantitativos IA · Sepeng Engenharia · ${new Date().toLocaleDateString("pt-BR")} · `
    + `${plantas.length} plantas · MAT e MO baseados em códigos SINAPI BA (Não Desonerado)`;
  const rRod = ws.addRow({ cod: rodTxt });
  ws.mergeCells(rRod.number, 1, rRod.number, 16);
  rRod.getCell("A").font      = { size: 8, italic: true, color: { argb: C.cinza } };
  rRod.getCell("A").alignment = { horizontal: "center" };

  // ── Buffer ────────────────────────────────────────────────────────────────────
  const buf  = await wb.xlsx.writeBuffer();
  const nome = `ORC_${(obra.nome || "Obra").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}_BDI${bdi}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
  } catch (err) {
    console.error("[export] erro:", err);
    return Response.json({ error: err.message || "Erro ao gerar Excel" }, { status: 500 });
  }
}
