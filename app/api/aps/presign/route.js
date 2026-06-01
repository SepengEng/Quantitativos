// APS (Autodesk Platform Services) — etapa 1: URL assinada para upload direto
// O DWG é enviado pelo browser diretamente ao S3 da Autodesk (sem passar pelo Vercel)

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

async function ensureBucket(token, bucketKey) {
  const res = await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketKey, policyKey: "transient" }), // transient = auto-delete em 24h
  });
  if (!res.ok && res.status !== 409) { // 409 = bucket já existe
    const err = await res.text();
    throw new Error(`Bucket creation failed ${res.status}: ${err}`);
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get("fileName");
  if (!fileName) return Response.json({ error: "fileName obrigatório" }, { status: 400 });

  if (!process.env.APS_CLIENT_ID || !process.env.APS_CLIENT_SECRET) {
    return Response.json({ error: "APS_CLIENT_ID e APS_CLIENT_SECRET não configurados no servidor" }, { status: 500 });
  }

  try {
    const token = await getToken();
    // Bucket key: só minúsculas e dígitos, 3-128 chars
    const bucketKey = `sepeng${process.env.APS_CLIENT_ID.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 15)}dwg`;
    await ensureBucket(token, bucketKey);

    // Nome do objeto: timestamp + nome limpo
    const objectKey = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    // URL assinada para upload direto ao S3 da Autodesk (expira em 10min)
    const res = await fetch(
      `${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload?minutesExpiration=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`signeds3upload ${res.status}: ${err}`);
    }
    const data = await res.json();

    return Response.json({
      uploadUrl:  data.urls[0],   // URL S3 para PUT direto
      uploadKey:  data.uploadKey, // usado para finalizar
      bucketKey,
      objectKey,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
