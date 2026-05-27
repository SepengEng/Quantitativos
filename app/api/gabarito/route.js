import ExcelJS from "exceljs";

// Converte valor de célula para número
function toNum(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  return parseFloat(String(val).replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
}

// Detecta linha de cabeçalho heurística
function detectarHeader(row) {
  const vals = [];
  row.eachCell({ includeEmpty: false }, (cell) => vals.push(String(cell.value || "").toLowerCase()));
  const txt = vals.join(" ");
  return (txt.includes("descri") || txt.includes("servi") || txt.includes("item")) &&
         (txt.includes("qtd") || txt.includes("quant") || txt.includes("qtde") || txt.includes("un"));
}

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) return Response.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();

  try {
    await wb.xlsx.load(buffer);
  } catch {
    return Response.json({ error: "Arquivo Excel inválido ou corrompido" }, { status: 400 });
  }

  const resultado = {
    itens: [],
    total: 0,
    totalMat: 0,
    totalMO: 0,
    sheets: wb.worksheets.map((ws) => ws.name),
  };

  // Processa cada aba
  for (const ws of wb.worksheets) {
    let headerRow = null;
    const colMap = {}; // descricao, codigo, un, qtd, preco_unit, total
    let secaoAtual = "";

    ws.eachRow((row, rn) => {
      // Pula até encontrar cabeçalho
      if (!headerRow) {
        if (detectarHeader(row)) {
          headerRow = rn;
          row.eachCell({ includeEmpty: false }, (cell, col) => {
            const s = String(cell.value || "").toLowerCase().trim();
            if (!colMap.descricao && (s.includes("descri") || s.includes("servi") || s === "item")) colMap.descricao = col;
            if (!colMap.codigo && (s.includes("cód") || s.includes("cod") || s === "ref" || s === "id")) colMap.codigo = col;
            if (!colMap.un && (s === "un" || s === "un." || s === "unid" || s.startsWith("unidade"))) colMap.un = col;
            if (!colMap.qtd && (s === "qtd" || s === "qtde" || s === "qtd." || s.startsWith("quant"))) colMap.qtd = col;
            if (!colMap.preco_unit && (s.includes("unit") || s.includes("p.unit") || s === "preço" || s.includes("unit."))) colMap.preco_unit = col;
            if (!colMap.total && (s === "total" || s === "r$" || s === "valor" || s === "subtotal")) colMap.total = col;
          });
        }
        return;
      }

      // Detecta mudança de seção (MAT / MO)
      const rowTxt = [];
      row.eachCell({ includeEmpty: false }, (c) => rowTxt.push(String(c.value || "").toUpperCase()));
      const fullTxt = rowTxt.join(" ");
      if (fullTxt.match(/\b(MAT|MATERIAI[S]?|MATERIAL)\b/)) { secaoAtual = "MAT"; return; }
      if (fullTxt.match(/\b(M\.?O\.?|MÃO DE OBRA|MAO DE OBRA)\b/)) { secaoAtual = "MO"; return; }

      // Linha de dados — exige pelo menos descrição
      const descCell = colMap.descricao ? row.getCell(colMap.descricao) : null;
      const descricao = descCell ? String(descCell.value || "").trim() : "";
      if (!descricao || descricao.length < 3) return;

      // Ignora linhas de totais/cabeçalhos secundários
      const du = descricao.toUpperCase();
      if (du === "TOTAL" || du.startsWith("SUBTOTAL") || du.startsWith("TOTAL GERAL") ||
          du.startsWith("MAT") || du.startsWith("MÃO") || du.startsWith("MAO")) return;

      const qtd = colMap.qtd ? toNum(row.getCell(colMap.qtd).value) : 0;
      const total = colMap.total ? toNum(row.getCell(colMap.total).value) : 0;
      const precoUnitRaw = colMap.preco_unit ? toNum(row.getCell(colMap.preco_unit).value) : 0;

      if (qtd <= 0 && total <= 0) return;

      const preco_unit = precoUnitRaw > 0 ? precoUnitRaw : (qtd > 0 && total > 0 ? total / qtd : 0);
      const totalFinal = total > 0 ? total : qtd * preco_unit;

      const item = {
        codigo:     colMap.codigo ? String(row.getCell(colMap.codigo).value || "").trim() : "",
        descricao,
        un:         colMap.un ? String(row.getCell(colMap.un).value || "").trim() : "",
        qtd,
        preco_unit,
        total:      totalFinal,
        secao:      secaoAtual || "—",
        sheet:      ws.name,
      };

      resultado.itens.push(item);
      resultado.total += totalFinal;
      if (secaoAtual === "MAT") resultado.totalMat += totalFinal;
      else if (secaoAtual === "MO") resultado.totalMO += totalFinal;
    });
  }

  // Deduplica itens idênticos (mesma descrição + un + qtd) que podem surgir de abas duplicadas
  const seen = new Set();
  resultado.itens = resultado.itens.filter((it) => {
    const key = `${it.descricao.toLowerCase()}|${it.un}|${it.qtd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Response.json(resultado);
}
