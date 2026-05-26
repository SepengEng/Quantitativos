import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

// ── Paleta Sepeng ─────────────────────────────────────────────────────────────
const C = {
  cabecalho:  "FF1B2A3B", // azul-escuro
  colHeader:  "FF0E7490", // teal
  capitulo:   "FF155E75", // teal escuro
  subCap:     "FFD0F0F8", // azul-claro subcapítulo
  composicao: "FFFFFFFF", // branco
  composicaoPar: "FFF8FAFC",
  material:   "FFFEF9F0", // creme material
  materialPar:"FFFDF4E1",
  moObra:     "FFF0FDF4", // verde-claro MO
  moObraPar:  "FFE8FCF0",
  totalFundo: "FFD1FAE5",
  totalBdi:   "FF059669",
  alerta:     "FFFEF9C3",
  borda:      "FFD1D5DB",
  texto:      "FF111827",
  cinza:      "FF6B7280",
};

function borda(cell, estilo = "thin") {
  const b = { style: estilo, color: { argb: C.borda } };
  cell.border = { top: b, bottom: b, left: b, right: b };
}

function preencher(cell, argb) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function num(v) { return typeof v === "number" ? v : parseFloat(v) || 0; }

// Colunas espelhando o F18:
// A: Cód. | B: Tipo | C-I: Resumo (mesclado) | J: Ud | K: Qte | L: Índ. |
// M: Comp.Ax.(R$) | N: Comp.(R$) | O: Preço(R$) | P: Valor(R$)
const COLS = [
  { key:"cod",   width:14 }, // A
  { key:"tipo",  width:14 }, // B
  { key:"c",     width:10 }, // C ┐
  { key:"d",     width:10 }, // D │
  { key:"e",     width:10 }, // E │ mescladas → descrição larga
  { key:"f",     width:10 }, // F │
  { key:"g",     width:10 }, // G │
  { key:"h",     width:10 }, // H │
  { key:"i",     width: 6 }, // I ┘
  { key:"ud",    width: 8 }, // J
  { key:"qte",   width:12 }, // K
  { key:"ind",   width: 8 }, // L índice/coef.
  { key:"compAx",width:16 }, // M Comp.Ax.
  { key:"comp",  width:16 }, // N Comp.(R$)
  { key:"preco", width:16 }, // O Preço(R$)
  { key:"valor", width:16 }, // P Valor(R$)
];

// Mescla as colunas C-I de uma linha para a descrição larga
function mesclarDesc(ws, rowNum) {
  ws.mergeCells(rowNum, 3, rowNum, 9); // C até I
}

// Aplica formatação de moeda nas colunas numéricas
const FMT_NUM = '#,##0.00';
function formatarNumeros(row) {
  ["K","L","M","N","O","P"].forEach(col => {
    row.getCell(col).numFmt = FMT_NUM;
    row.getCell(col).alignment = { horizontal: "right", vertical: "middle" };
  });
}

export async function POST(request) {
  const { obra, bdi = 25 } = await request.json();
  if (!obra) return Response.json({ error: "Obra não informada" }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Quantitativos IA — Sepeng Engenharia";
  wb.created = new Date();

  const ws = wb.addWorksheet("Orçamento", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    views: [{ state: "frozen", ySplit: 5 }], // congela cabeçalho
  });

  ws.columns = COLS;

  // ── Logo ──────────────────────────────────────────────────────────────────
  const logoPath = path.join(process.cwd(), "public", "logo_sepeng.png");
  if (fs.existsSync(logoPath)) {
    const logoId = wb.addImage({ filename: logoPath, extension: "png" });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 4 } });
  }

  // ── Linha 1 — Título ──────────────────────────────────────────────────────
  ws.mergeCells("C1:P1");
  const r1 = ws.getRow(1); r1.height = 32;
  const t1 = r1.getCell("C");
  t1.value = "ORÇAMENTO EXECUTIVO";
  t1.font  = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  t1.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: C.cabecalho } };
  t1.alignment = { vertical: "middle", horizontal: "center" };

  // ── Linha 2 — Empresa ────────────────────────────────────────────────────
  ws.mergeCells("C2:P2");
  const r2 = ws.getRow(2); r2.height = 20;
  const t2 = r2.getCell("C");
  t2.value = "SEPENG ENGENHARIA";
  t2.font  = { bold: true, size: 12, color: { argb: C.colHeader } };
  t2.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  t2.alignment = { vertical: "middle", horizontal: "center" };

  // ── Linha 3 — Obra e data ────────────────────────────────────────────────
  ws.mergeCells("C3:J3"); ws.mergeCells("K3:P3");
  const r3 = ws.getRow(3); r3.height = 18;
  r3.getCell("C").value = `Obra: ${obra.nome || "—"}`;
  r3.getCell("C").font  = { bold: true, size: 11 };
  r3.getCell("C").fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  r3.getCell("K").value = `Data: ${new Date().toLocaleDateString("pt-BR")}   BDI: ${bdi}%`;
  r3.getCell("K").font  = { italic: true, size: 10 };
  r3.getCell("K").fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  r3.getCell("K").alignment = { horizontal: "right" };

  // ── Linha 4 — cabeçalho das colunas (espelho F18) ────────────────────────
  ws.mergeCells("C4:I4");
  const rH = ws.getRow(4); rH.height = 24;
  const hCols = { A:"Cód.", B:"Tipo", C:"Resumo / Descrição", J:"Ud", K:"Qte",
                  L:"Índ.", M:"Comp. Ax. (R$)", N:"Comp. (R$)", O:"Preço (R$)", P:"Valor (R$)" };
  Object.entries(hCols).forEach(([col, label]) => {
    const cell = rH.getCell(col);
    cell.value     = label;
    cell.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.colHeader } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  // ── Dados ─────────────────────────────────────────────────────────────────
  const plantas = obra.plantas || [];

  // Agrupa por disciplina
  const grupos = {};
  for (const p of plantas) {
    const d = p.disciplina || "Sem disciplina";
    if (!grupos[d]) grupos[d] = [];
    grupos[d].push(p);
  }

  let totalObra  = 0;
  let chapNum    = 1;
  let iComposicao = 0; // controle zebra

  for (const [disc, grupoplantas] of Object.entries(grupos)) {
    const discTotal = grupoplantas.reduce(
      (s, p) => s + (p.itens || []).reduce((ss, i) => ss + num(i.preco_sinapi) * num(i.qtd), 0), 0
    );
    totalObra += discTotal;

    // ── CAPÍTULO (disciplina) ──────────────────────────────────────────────
    const rowCapN = ws.rowCount + 1;
    mesclarDesc(ws, rowCapN);
    const rCap = ws.addRow({
      cod:  `${chapNum}`,
      tipo: "Capítulo",
      c:    disc.toUpperCase(),
      valor: discTotal,
    });
    rCap.height = 20;
    rCap.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.capitulo } };
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle" };
    });
    rCap.getCell("P").numFmt = FMT_NUM;
    rCap.getCell("P").alignment = { horizontal: "right", vertical: "middle" };

    let plantaNum = 1;

    for (const planta of grupoplantas) {
      const plantaTotal = (planta.itens || []).reduce(
        (s, i) => s + num(i.preco_sinapi) * num(i.qtd), 0
      );

      // ── SUBCAPÍTULO (planta) ───────────────────────────────────────────
      const rowSubN = ws.rowCount + 1;
      mesclarDesc(ws, rowSubN);
      const rSub = ws.addRow({
        cod:  `${chapNum}.${plantaNum}`,
        tipo: "",
        c:    planta.fileName || "Planta",
        valor: plantaTotal,
      });
      rSub.height = 17;
      rSub.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subCap } };
        cell.font = { bold: true, size: 9.5, color: { argb: C.texto } };
        cell.alignment = { vertical: "middle" };
      });
      rSub.getCell("P").numFmt = FMT_NUM;
      rSub.getCell("P").alignment = { horizontal: "right", vertical: "middle" };

      // Linha de resumo da planta (escala + descrição IA)
      if (planta.escala || planta.resumo) {
        const rowRN = ws.rowCount + 1;
        ws.mergeCells(rowRN, 3, rowRN, 16); // C até P
        const rRes = ws.addRow({ c: `  ${planta.escala ? `Escala ${planta.escala} · ` : ""}${(planta.resumo||"").slice(0,220)}` });
        rRes.height = 13;
        rRes.getCell("C").font      = { size: 8, italic: true, color: { argb: C.cinza } };
        rRes.getCell("C").fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        rRes.getCell("C").alignment = { wrapText: false };
      }

      let itemNum = 1;

      for (const item of planta.itens || []) {
        iComposicao++;
        const isPar   = iComposicao % 2 === 0;
        const precoUnit = num(item.preco_sinapi);
        const qtd       = num(item.qtd);
        const valorItem = precoUnit * qtd;

        // ── COMPOSIÇÃO ────────────────────────────────────────────────────
        const rowCompN = ws.rowCount + 1;
        mesclarDesc(ws, rowCompN);
        const rComp = ws.addRow({
          cod:   `${chapNum}.${plantaNum}.${itemNum}`,
          tipo:  "Composição",
          c:     item.descricao || "",
          ud:    item.un || "",
          qte:   qtd || "",
          preco: precoUnit || "",
          valor: valorItem || "",
        });
        rComp.height = 16;
        const bgComp = isPar ? C.composicaoPar : C.composicao;
        rComp.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgComp } };
          cell.font = { size: 9.5, bold: false };
          cell.alignment = { vertical: "middle" };
        });
        rComp.getCell("B").font = { size: 9, italic: true, color: { argb: C.cinza } };
        rComp.getCell("K").numFmt = FMT_NUM;
        rComp.getCell("O").numFmt = FMT_NUM;
        rComp.getCell("P").numFmt = FMT_NUM;
        ["K","O","P"].forEach(c => rComp.getCell(c).alignment = { horizontal:"right", vertical:"middle" });

        // ── MATERIAL (sub-item — espelho do F18) ──────────────────────────
        // Usa o código + descrição SINAPI como material, índice padrão 1,00
        const sinapiDesc = item.sinapi_descricao || item.descricao || "";
        const sinapiCod  = item.sinapi_sugerido  || "";
        const indice     = 1.00;
        const precoMat   = precoUnit; // preço SINAPI = preço do material base

        const rowMatN = ws.rowCount + 1;
        mesclarDesc(ws, rowMatN);
        const bgMat = isPar ? C.materialPar : C.material;
        const rMat = ws.addRow({
          cod:    `${chapNum}.${plantaNum}.${itemNum}.1`,
          tipo:   "Material",
          c:      sinapiDesc + (sinapiCod ? `  [SINAPI ${sinapiCod}]` : ""),
          ud:     item.un || "",
          qte:    qtd * indice,
          ind:    indice,
          comp:   precoMat || "",
          preco:  precoMat || "",
          valor:  valorItem || "",
        });
        rMat.height = 14;
        rMat.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgMat } };
          cell.font = { size: 9, color: { argb: C.texto } };
          cell.alignment = { vertical: "middle" };
        });
        rMat.getCell("B").font  = { size: 9, color: { argb: "FF0E7490" } };
        rMat.getCell("A").font  = { size: 8.5, color: { argb: C.cinza } };
        formatarNumeros(rMat);

        // Fonte de medição como sub-linha de Mão de Obra (se tiver info)
        if (item.fonte && item.fonte !== "🔍 Inferência") {
          const rowMoN = ws.rowCount + 1;
          mesclarDesc(ws, rowMoN);
          const bgMo = isPar ? C.moObraPar : C.moObra;
          const rMo = ws.addRow({
            cod:  `${chapNum}.${plantaNum}.${itemNum}.2`,
            tipo: "Mão de obra",
            c:    `Medição: ${item.fonte}${item.obs ? " · " + item.obs.slice(0, 120) : ""}`,
            ud:   item.un || "",
            qte:  qtd,
          });
          rMo.height = 13;
          rMo.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgMo } };
            cell.font = { size: 8.5, italic: true, color: { argb: C.cinza } };
            cell.alignment = { vertical: "middle" };
          });
        }

        itemNum++;
      }

      // Alertas da planta
      if ((planta.alertas || []).length > 0) {
        const rowAlN = ws.rowCount + 1;
        ws.mergeCells(rowAlN, 3, rowAlN, 16);
        const rAl = ws.addRow({ c: `⚠  ${planta.alertas.join(" · ").slice(0, 280)}` });
        rAl.height = 13;
        rAl.getCell("C").font = { size: 8.5, italic: true, color: { argb: "FFB45309" } };
        rAl.getCell("C").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.alerta } };
      }

      plantaNum++;
    }
    chapNum++;
  }

  // ── Totais (espelho F18) ──────────────────────────────────────────────────
  ws.addRow({});

  ws.mergeCells(`A${ws.rowCount + 1}:O${ws.rowCount + 1}`);
  const rT1 = ws.addRow({ cod: "TOTAL SEM BDI", valor: totalObra });
  rT1.height = 22;
  rT1.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalFundo } };
    cell.font = { bold: true, size: 12 };
  });
  rT1.getCell("A").alignment = { horizontal: "right" };
  rT1.getCell("P").numFmt = FMT_NUM;
  rT1.getCell("P").alignment = { horizontal: "right" };

  ws.mergeCells(`A${ws.rowCount + 1}:O${ws.rowCount + 1}`);
  const rT2 = ws.addRow({ cod: `TOTAL COM BDI ${bdi}%`, valor: totalObra * (1 + bdi / 100) });
  rT2.height = 26;
  rT2.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.totalBdi } };
    cell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  });
  rT2.getCell("A").alignment = { horizontal: "right" };
  rT2.getCell("P").numFmt = FMT_NUM;
  rT2.getCell("P").alignment = { horizontal: "right" };

  // ── Rodapé ────────────────────────────────────────────────────────────────
  ws.addRow({});
  const rowRod = ws.rowCount + 1;
  ws.mergeCells(rowRod, 1, rowRod, 16);
  const rRod = ws.addRow({ cod: `Gerado por Quantitativos IA · Sepeng Engenharia · ${new Date().toLocaleDateString("pt-BR")} · ${plantas.length} plantas analisadas` });
  rRod.getCell("A").font      = { size: 8, italic: true, color: { argb: C.cinza } };
  rRod.getCell("A").alignment = { horizontal: "center" };

  // ── Buffer ────────────────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const nome = `ORC_${(obra.nome || "Obra").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}_BDI${bdi}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
}
