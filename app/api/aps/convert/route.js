// APS — etapa 2: finaliza upload, converte DWG → DXF, devolve texto DXF
// Roda em até 60s (Vercel Pro / hobby com maxDuration)

export const maxDuration = 60;

const APS_BASE = "https://developer.api.autodesk.com";

async function getToken() {
  const res = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.APS_CLIENT_ID,
      client_secret: process.env.APS_CLIENT_SECRET,
      grant_type:    "client_credentials",
      scope:         "data:write data:read bucket:create bucket:read",
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error("APS auth falhou: " + JSON.stringify(d));
  return d.access_token;
}

function toSafeBase64(str) {
  return Buffer.from(str).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function POST(request) {
  const { bucketKey, objectKey, uploadKey } = await request.json();
  if (!bucketKey || !objectKey || !uploadKey) {
    return Response.json({ error: "bucketKey, objectKey e uploadKey obrigatórios" }, { status: 400 });
  }

  const token = await getToken();

  // 1. Finaliza o upload S3 → cria o objeto no OSS
  const finalRes = await fetch(
    `${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uploadKey }),
    }
  );
  if (!finalRes.ok) {
    const err = await finalRes.text();
    throw new Error(`Finalizar upload falhou ${finalRes.status}: ${err}`);
  }
  const finalData = await finalRes.json();
  const objectId = finalData.objectId; // urn:adsk.objects:os.object:bucket/key

  // 2. URN base64 para o Model Derivative
  const urn = toSafeBase64(objectId);

  // 3. Submete job de conversão DWG → DXF
  const jobRes = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-ads-force": "true",
    },
    body: JSON.stringify({
      input:  { urn },
      output: { formats: [{ type: "dxf" }] },
    }),
  });
  if (!jobRes.ok) {
    const err = await jobRes.text();
    throw new Error(`Submeter job falhou ${jobRes.status}: ${err}`);
  }

  // 4. Polling até concluir (máx 55s para caber no timeout)
  const deadline = Date.now() + 55_000;
  let manifest;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const mRes = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    manifest = await mRes.json();

    if (manifest.status === "success") break;
    if (manifest.status === "failed") {
      throw new Error("Conversão APS falhou: " + (manifest.progress || JSON.stringify(manifest)));
    }
    // status "inprogress" | "pending" — continua polling
  }

  if (manifest?.status !== "success") {
    throw new Error("Timeout: conversão demorou mais de 55s. Tente novamente.");
  }

  // 5. Localiza o arquivo DXF no manifesto
  let dxfUrn = null;
  for (const deriv of manifest.derivatives || []) {
    for (const child of deriv.children || []) {
      if (child.urn?.toLowerCase().endsWith(".dxf") || child.role === "graphics") {
        dxfUrn = child.urn;
        break;
      }
      // Pode estar em sub-children
      for (const sub of child.children || []) {
        if (sub.urn?.toLowerCase().endsWith(".dxf")) { dxfUrn = sub.urn; break; }
      }
      if (dxfUrn) break;
    }
    if (dxfUrn) break;
  }

  if (!dxfUrn) {
    // Debug: retorna o manifesto para diagnóstico
    return Response.json({ error: "Arquivo DXF não encontrado no manifesto", manifest }, { status: 500 });
  }

  // 6. Baixa o DXF (URL encode necessário para URNs com /)
  const dxfRes = await fetch(
    `${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest/${encodeURIComponent(dxfUrn)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!dxfRes.ok) {
    throw new Error(`Download DXF falhou ${dxfRes.status}`);
  }
  const dxfBuffer = await dxfRes.arrayBuffer();

  // 7. Cleanup assíncrono (não bloqueia a resposta)
  fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${objectKey}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});

  // 8. Devolve o texto DXF — APS converte para UTF-8
  const dxfText = new TextDecoder("utf-8").decode(dxfBuffer);

  return new Response(dxfText, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
