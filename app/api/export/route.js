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

async function gerarQuantitativo(obra, incluirPreco) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quantitativos IA — Sepeng Engenharia";
  wb.created = new Date();

  const plantas = obra.plantas || [];
  const grupos  = {};
  for (const p of plantas) {
    const d = normDisc(p.disciplina);
    if (!grupos[d]) grupos[d] = [];
    grupos[d].push(p);
  }

  // ── Paleta de confiança
  const C_CONF = {
    alta:  { bg: "FFD1FAE5", txt: "FF065F46", badge: "✅ Alta" },
    media: { bg: "FFFEF3C7", txt: "FF92400E", badge: "⚠️ Média" },
    baixa: { bg: "FFFEE2E2", txt: "FF991B1B", badge: "❌ Baixa" },
  };
  const confColor = (c) => C_CONF[c?.toLowerCase()] || C_CONF.media;

  // ── Aba "Resumo"
  const wsRes = wb.addWorksheet("Resumo");
  wsRes.columns = [
    { width: 5  },
    { width: 22 }, // Disciplina
    { width: 10 }, // Qtd itens
    { width: 10 }, // Alta
    { width: 10 }, // Média
    { width: 10 }, // Baixa
    { width: 16 }, // Valor total (opcional)
  ];

  // Cabeçalho Resumo
  const rr1 = wsRes.addRow([]);
  wsRes.mergeCells(`A1:G1`);
  wsRes.getRow(1).height = 36;
  Object.assign(wsRes.getCell("A1"), {
    value: `LEVANTAMENTO DE QUANTITATIVOS — ${(obra.nome||"").toUpperCase()}`,
    font: { bold: true, size: 15, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A3B" } },
    alignment: { vertical: "middle", horizontal: "center" },
  });

  const rr2 = wsRes.addRow([]);
  wsRes.mergeCells(`A2:G2`);
  wsRes.getRow(2).height = 18;
  wsRes.getCell("A2").value = `Data: ${new Date().toLocaleDateString("pt-BR")}  ·  ${plantas.length} planta(s) analisada(s)${incluirPreco ? "  ·  Preços referência: SINAPI BA / Arqmedes" : ""}`;
  wsRes.getCell("A2").font  = { italic: true, size: 10, color: { argb: "FF6B7280" } };
  wsRes.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };

  const rr3 = wsRes.addRow(["#", "Disciplina", "Itens", "Alta", "Média", "Baixa", ...(incluirPreco?["Valor Total"]:[] )]);
  wsRes.getRow(3).height = 20;
  wsRes.getRow(3).eachCell(c => {
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E7490" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });

  let discN = 1;
  let grandTotal = 0;
  for (const [disc, gplantas] of Object.entries(grupos)) {
    const allItens = gplantas.flatMap(p => p.itens || []);
    const alta  = allItens.filter(i => i.confianca === "alta").length;
    const media = allItens.filter(i => i.confianca === "media").length;
    const baixa = allItens.filter(i => !i.confianca || i.confianca === "baixa").length;
    const total = incluirPreco ? allItens.reduce((s,i) => s + num(i.preco_sinapi)*num(i.qtd), 0) : null;
    if (incluirPreco) grandTotal += total;
    const rowData = [discN, disc, allItens.length, alta, media, baixa, ...(incluirPreco?[total]:[])];
    const rDisc = wsRes.addRow(rowData);
    rDisc.height = 17;
    rDisc.eachCell(c => c.font = { size: 10 });
    if (incluirPreco && total != null) { rDisc.getCell(7).numFmt = "#,##0.00"; rDisc.getCell(7).alignment = { horizontal: "right" }; }
    [4,5,6].forEach((col, ci) => {
      const vals = [alta, media, baixa];
      if (vals[ci] > 0) {
        const clr = [C_CONF.alta, C_CONF.media, C_CONF.baixa][ci];
        rDisc.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: clr.bg.replace("FF","FF") } };
        rDisc.getCell(col).font = { size: 10, color: { argb: clr.txt } };
      }
    });
    discN++;
  }

  if (incluirPreco && grandTotal > 0) {
    wsRes.addRow([]);
    const rGT = wsRes.addRow(["", "TOTAL GERAL", "", "", "", "", grandTotal]);
    rGT.height = 22;
    rGT.eachCell(c => {
      c.font = { bold: true, size: 12 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    });
    rGT.getCell(7).numFmt = "#,##0.00";
    rGT.getCell(7).alignment = { horizontal: "right" };
    wsRes.mergeCells(rGT.number, 1, rGT.number, 6);
  }

  // ── Uma aba por disciplina
  for (const [disc, gplantas] of Object.entries(grupos)) {
    const sheetName = disc.replace(/[\/\\?\*\[\]:]/g, "_").slice(0, 31);
    const ws = wb.addWorksheet(sheetName);

    const baseCols = [
      { width: 5  }, // #
      { width: 30 }, // Localização
      { width: 50 }, // Descrição
      { width: 8  }, // UN
      { width: 12 }, // Qtd
      { width: 11 }, // Confiança
      { width: 36 }, // Obs
    ];
    if (incluirPreco) baseCols.push({ width: 14 }, { width: 16 });
    ws.columns = baseCols;

    // Cabeçalho da aba
    ws.addRow([]);
    ws.getRow(1).height = 32;
    ws.mergeCells(1, 1, 1, incluirPreco ? 9 : 7);
    Object.assign(ws.getCell("A1"), {
      value: `${disc.toUpperCase()} — ${obra.nome || ""}`,
      font:  { bold: true, size: 14, color: { argb: "FFFFFFFF" } },
      fill:  { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A3B" } },
      alignment: { vertical: "middle", horizontal: "left" },
    });
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left", indent: 1 };

    const headers = ["#", "Localização", "Descrição do Serviço", "UN", "Quantidade", "Confiança", "Observação", ...(incluirPreco ? ["Preço Unit.", "Total (R$)"] : [])];
    const rH = ws.addRow(headers);
    rH.height = 20;
    rH.eachCell(c => {
      c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E7490" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    ws.views = [{ state: "frozen", ySplit: 2 }];

    // Itens
    let n = 1;
    for (const planta of gplantas) {
      // Separador de arquivo
      const rFile = ws.addRow([`📄 ${planta.fileName || "Planta"}`, "", "", "", "", "", `${(planta.itens||[]).length} itens · ${planta.escala || ""}`, ...(incluirPreco?["",""]:[])]);
      ws.mergeCells(rFile.number, 2, rFile.number, incluirPreco ? 9 : 7);
      rFile.height = 16;
      rFile.eachCell(c => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        c.font = { bold: true, size: 9, color: { argb: "FF475569" } };
        c.alignment = { vertical: "middle" };
      });

      for (const item of planta.itens || []) {
        const conf    = (item.confianca || "media").toLowerCase();
        const cClr    = confColor(conf);
        const qtd     = num(item.qtd);
        const preco   = num(item.preco_sinapi);
        const total   = preco * qtd;
        const rowData = [
          n,
          item.localizacao || "",
          item.descricao   || "",
          item.un          || "",
          qtd              || "",
          cClr.badge,
          item.obs         || item.fonte || "",
          ...(incluirPreco ? [preco || "", total || ""] : []),
        ];
        const rItem = ws.addRow(rowData);
        rItem.height = 15;

        // Cor da linha baseada na confiança
        rItem.eachCell({ includeEmpty: true }, c => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cClr.bg } };
          c.font = { size: 9.5 };
          c.alignment = { vertical: "middle", wrapText: false };
        });
        rItem.getCell(1).font  = { size: 9,   color: { argb: "FF9CA3AF" } };
        rItem.getCell(3).font  = { size: 9.5, bold: false };
        rItem.getCell(5).font  = { size: 9.5, bold: true };
        rItem.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
        rItem.getCell(6).font  = { size: 9,   color: { argb: cClr.txt } };
        rItem.getCell(7).font  = { size: 8.5, italic: true, color: { argb: "FF6B7280" } };
        if (incluirPreco) {
          rItem.getCell(8).numFmt    = "#,##0.00";
          rItem.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
          rItem.getCell(9).numFmt    = "#,##0.00";
          rItem.getCell(9).alignment = { horizontal: "right", vertical: "middle" };
          rItem.getCell(9).font      = { size: 9.5, bold: true };
        }
        n++;
      }
    }

    // Totais da aba
    const todosItens = gplantas.flatMap(p => p.itens || []);
    ws.addRow([]);
    const totCols = incluirPreco
      ? ["", `${n-1} itens`, "", "", "", "", "", "", todosItens.reduce((s,i)=>s+num(i.preco_sinapi)*num(i.qtd),0)]
      : ["", `${n-1} itens`, "", "", "", "", ""];
    const rTot = ws.addRow(totCols);
    rTot.height = 18;
    rTot.eachCell(c => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      c.font = { bold: true, size: 10 };
      c.alignment = { vertical: "middle" };
    });
    if (incluirPreco) {
      rTot.getCell(9).numFmt    = "#,##0.00";
      rTot.getCell(9).alignment = { horizontal: "right", vertical: "middle" };
    }

    // Legenda de confiança
    ws.addRow([]);
    const rLeg = ws.addRow(["", "LEGENDA:", "✅ Alta = cota ou contagem direta", "⚠️ Média = calculado de cotas", "❌ Baixa = estimado/inferido — revisar", "", ""]);
    rLeg.height = 14;
    rLeg.eachCell(c => {
      c.font      = { size: 8, italic: true, color: { argb: "FF9CA3AF" } };
      c.alignment = { vertical: "middle" };
    });
  }

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
