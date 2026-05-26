import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

// ── Cores do template Sepeng ─────────────────────────────────────────────────
const COR = {
  titulo:      { argb: "FF1B2A3B" }, // azul-escuro header
  colHeader:   { argb: "FF0E7490" }, // teal colunas
  capitulo:    { argb: "FF155E75" }, // teal escuro capítulo
  subCap:      { argb: "FFE0F2FE" }, // azul-claro subcapítulo
  itemPar:     { argb: "FFFFFFFF" }, // branco item par
  itemImpar:   { argb: "FFF8FAFC" }, // cinza-muito-claro item ímpar
  totalFundo:  { argb: "FFD1FAE5" }, // verde-claro total
  borda:       { argb: "FFD1D5DB" }, // cinza borda
};

function bordas(ws, row, cols = "ABCDEFGHIJ") {
  for (const col of cols) {
    const cell = row.getCell(col);
    cell.border = {
      top:    { style: "thin", color: COR.borda },
      bottom: { style: "thin", color: COR.borda },
      left:   { style: "thin", color: COR.borda },
      right:  { style: "thin", color: COR.borda },
    };
  }
}

function moeda(n) {
  return typeof n === "number" ? n : parseFloat(n) || 0;
}

export async function POST(request) {
  const { obra, bdi = 25 } = await request.json();
  if (!obra) return Response.json({ error: "Obra não informada" }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  wb.creator  = "Quantitativos IA – Sepeng Engenharia";
  wb.created  = new Date();

  const ws = wb.addWorksheet("Orçamento", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  // ── Colunas ────────────────────────────────────────────────────────────────
  ws.columns = [
    { key: "cod",    width: 14  }, // A
    { key: "tipo",   width: 14  }, // B
    { key: "resumo", width: 52  }, // C – descrição (larga)
    { key: "sinapi", width: 12  }, // D – cód. SINAPI
    { key: "fonte",  width: 14  }, // E – fonte medição
    { key: "ud",     width: 8   }, // F
    { key: "qte",    width: 11  }, // G
    { key: "preco",  width: 17  }, // H – Preço unit.
    { key: "valor",  width: 17  }, // I – Valor s/BDI
    { key: "comBdi", width: 17  }, // J – Valor c/BDI
  ];

  // ── Logo ───────────────────────────────────────────────────────────────────
  const logoPath = path.join(process.cwd(), "public", "logo_sepeng.png");
  if (fs.existsSync(logoPath)) {
    const logoId = wb.addImage({ filename: logoPath, extension: "png" });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 3 } });
  }

  // ── Linha 1: título ────────────────────────────────────────────────────────
  ws.mergeCells("C1:J1");
  const r1 = ws.getRow(1); r1.height = 28;
  const c1 = r1.getCell("C");
  c1.value = "ORÇAMENTO EXECUTIVO";
  c1.font  = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  c1.fill  = { type: "pattern", pattern: "solid", fgColor: COR.titulo };
  c1.alignment = { vertical: "middle", horizontal: "center" };

  // ── Linha 2: nome da empresa ───────────────────────────────────────────────
  ws.mergeCells("C2:J2");
  const r2 = ws.getRow(2); r2.height = 20;
  const c2 = r2.getCell("C");
  c2.value = "SEPENG ENGENHARIA";
  c2.font  = { bold: true, size: 11, color: { argb: "FF0E7490" } };
  c2.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  c2.alignment = { vertical: "middle", horizontal: "center" };

  // ── Linha 3: dados da obra ─────────────────────────────────────────────────
  ws.mergeCells("C3:G3");
  ws.mergeCells("H3:J3");
  const r3 = ws.getRow(3); r3.height = 18;
  r3.getCell("C").value = `Obra: ${obra.nome || "—"}`;
  r3.getCell("C").font  = { bold: true, size: 11 };
  r3.getCell("C").fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  r3.getCell("H").value = `Data: ${new Date().toLocaleDateString("pt-BR")} · BDI: ${bdi}%`;
  r3.getCell("H").font  = { size: 10, italic: true };
  r3.getCell("H").fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
  r3.getCell("H").alignment = { horizontal: "right" };

  // ── Linha 4: cabeçalho das colunas ────────────────────────────────────────
  const rH = ws.addRow(["Cód.", "Tipo", "Resumo / Descrição", "SINAPI", "Fonte", "Ud", "Qtd.", "Preço Unit. (R$)", "Valor s/BDI (R$)", `Valor c/BDI ${bdi}% (R$)`]);
  rH.height = 22;
  rH.eachCell(cell => {
    cell.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: COR.colHeader };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border    = { bottom: { style: "medium", color: COR.borda } };
  });

  // ── Dados por disciplina ───────────────────────────────────────────────────
  const plantas = obra.plantas || [];

  // Agrupa por disciplina
  const grupos = {};
  for (const p of plantas) {
    const d = p.disciplina || "Sem disciplina";
    if (!grupos[d]) grupos[d] = [];
    grupos[d].push(p);
  }

  let totalObra = 0;
  let chapNum   = 1;
  let itemGlobal = 0;

  for (const [disc, grupoplantas] of Object.entries(grupos)) {
    const discTotal = grupoplantas.reduce(
      (s, p) => s + (p.itens || []).reduce((ss, i) => ss + moeda(i.preco_sinapi) * moeda(i.qtd), 0), 0
    );
    totalObra += discTotal;

    // ── Capítulo (disciplina) ────────────────────────────────────────────────
    ws.mergeCells(`C${ws.rowCount + 1}:E${ws.rowCount + 1}`);
    const rCap = ws.addRow({
      cod:    `${chapNum}`,
      tipo:   "Capítulo",
      resumo: disc.toUpperCase(),
      preco:  "",
      valor:  discTotal,
      comBdi: discTotal * (1 + bdi / 100),
    });
    rCap.height = 18;
    rCap.eachCell({ includeEmpty: true }, cell => {
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: COR.capitulo };
      cell.font      = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle" };
    });
    rCap.getCell("I").numFmt = '#,##0.00';
    rCap.getCell("J").numFmt = '#,##0.00';

    let plantaNum = 1;

    for (const planta of grupoplantas) {
      const plantaTotal = (planta.itens || []).reduce(
        (s, i) => s + moeda(i.preco_sinapi) * moeda(i.qtd), 0
      );

      // ── Sub-capítulo (planta) ─────────────────────────────────────────────
      ws.mergeCells(`C${ws.rowCount + 1}:E${ws.rowCount + 1}`);
      const rSub = ws.addRow({
        cod:    `${chapNum}.${plantaNum}`,
        tipo:   "",
        resumo: planta.fileName || "Planta",
        valor:  plantaTotal,
        comBdi: plantaTotal * (1 + bdi / 100),
      });
      rSub.height = 16;
      rSub.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: COR.subCap };
        cell.font = { bold: true, size: 9.5 };
      });
      rSub.getCell("I").numFmt = '#,##0.00';
      rSub.getCell("J").numFmt = '#,##0.00';

      // Escala / resumo da planta como sub-linha
      if (planta.resumo || planta.escala) {
        ws.mergeCells(`C${ws.rowCount + 1}:J${ws.rowCount + 1}`);
        const rResumo = ws.addRow({ resumo: `  ${planta.escala ? `Escala ${planta.escala} — ` : ""}${(planta.resumo || "").slice(0, 200)}` });
        rResumo.height = 14;
        rResumo.getCell("C").font = { size: 8.5, italic: true, color: { argb: "FF6B7280" } };
        rResumo.getCell("C").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }

      let itemNum = 1;

      for (const item of planta.itens || []) {
        itemGlobal++;
        const valorItem = moeda(item.preco_sinapi) * moeda(item.qtd);
        const bg = itemNum % 2 === 0 ? COR.itemImpar : COR.itemPar;

        ws.mergeCells(`C${ws.rowCount + 1}:E${ws.rowCount + 1}`);
        const rItem = ws.addRow({
          cod:    `${chapNum}.${plantaNum}.${itemNum}`,
          tipo:   "Composição",
          resumo: item.descricao || "",
          sinapi: item.sinapi_sugerido || "",
          fonte:  item.fonte || "",
          ud:     item.un || "",
          qte:    moeda(item.qtd),
          preco:  moeda(item.preco_sinapi) || "",
          valor:  valorItem || "",
          comBdi: valorItem ? valorItem * (1 + bdi / 100) : "",
        });
        rItem.height = 15;
        rItem.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: bg };
          cell.font = { size: 9 };
        });
        rItem.getCell("G").numFmt = '#,##0.00';
        rItem.getCell("H").numFmt = '#,##0.00';
        rItem.getCell("I").numFmt = '#,##0.00';
        rItem.getCell("J").numFmt = '#,##0.00';
        rItem.getCell("G").alignment = { horizontal: "right" };
        rItem.getCell("H").alignment = { horizontal: "right" };
        rItem.getCell("I").alignment = { horizontal: "right" };
        rItem.getCell("J").alignment = { horizontal: "right" };

        // Alertas do item como sub-linha se existir obs relevante
        if (item.obs && item.obs.length > 5) {
          ws.mergeCells(`C${ws.rowCount + 1}:J${ws.rowCount + 1}`);
          const rObs = ws.addRow({ resumo: `    ↳ ${item.obs.slice(0, 200)}` });
          rObs.height = 12;
          rObs.getCell("C").font = { size: 8, italic: true, color: { argb: "FF9CA3AF" } };
          rObs.getCell("C").fill = { type: "pattern", pattern: "solid", fgColor: bg };
        }

        itemNum++;
      }

      // Alertas da planta
      if ((planta.alertas || []).length > 0) {
        ws.mergeCells(`C${ws.rowCount + 1}:J${ws.rowCount + 1}`);
        const rAlert = ws.addRow({ resumo: `⚠ ${planta.alertas.join(" · ").slice(0, 250)}` });
        rAlert.height = 13;
        rAlert.getCell("C").font = { size: 8.5, italic: true, color: { argb: "FFD97706" } };
        rAlert.getCell("C").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } };
      }

      plantaNum++;
    }
    chapNum++;
  }

  // ── Totais ─────────────────────────────────────────────────────────────────
  ws.addRow({}); // espaço
  ws.mergeCells(`A${ws.rowCount + 1}:H${ws.rowCount + 1}`);
  const rTot1 = ws.addRow({ resumo: "TOTAL SEM BDI", valor: totalObra });
  rTot1.height = 20;
  rTot1.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: COR.totalFundo };
    cell.font = { bold: true, size: 11 };
  });
  rTot1.getCell("I").numFmt  = '#,##0.00';
  rTot1.getCell("I").alignment = { horizontal: "right" };
  rTot1.getCell("C").alignment = { horizontal: "right" };

  ws.mergeCells(`A${ws.rowCount + 1}:H${ws.rowCount + 1}`);
  const rTot2 = ws.addRow({ resumo: `TOTAL COM BDI ${bdi}%`, comBdi: totalObra * (1 + bdi / 100) });
  rTot2.height = 22;
  rTot2.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };
    cell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  });
  rTot2.getCell("J").numFmt  = '#,##0.00';
  rTot2.getCell("J").alignment = { horizontal: "right" };
  rTot2.getCell("C").alignment = { horizontal: "right" };

  // ── Rodapé ─────────────────────────────────────────────────────────────────
  ws.addRow({});
  const rRodape = ws.addRow({ cod: `Gerado por Quantitativos IA · Sepeng Engenharia · ${new Date().toLocaleDateString("pt-BR")} · ${itemGlobal} itens extraídos de ${plantas.length} plantas` });
  rRodape.getCell("A").font  = { size: 8, italic: true, color: { argb: "FF9CA3AF" } };
  ws.mergeCells(`A${ws.rowCount}:J${ws.rowCount}`);

  // ── Gera buffer ────────────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const nomeArq = `ORC_${(obra.nome||"Obra").replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}_BDI${bdi}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArq}"`,
    },
  });
}
