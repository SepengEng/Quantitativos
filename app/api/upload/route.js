import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

export const maxDuration = 60;

function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const m = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m?.[1]) return m[1].trim();
  } catch {}
  return null;
}

export async function POST(request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return Response.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const fileObj = new File([buffer], file.name, { type: file.type });

    const uploaded = await client.beta.files.upload({ file: fileObj });
    return Response.json({ file_id: uploaded.id, name: uploaded.filename });
  } catch (err) {
    console.error("[Upload] error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
