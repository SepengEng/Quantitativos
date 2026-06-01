import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Fallback: lê .env.local diretamente (necessário quando Claude Code zera a env var no bash)
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const m = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m?.[1]) return m[1].trim();
  } catch {}
  return null;
}

function convertBlock(block) {
  if (block.type !== "image") return block;
  const src = block.source || {};

  // Anthropic Files API (file_id)
  if (src.file_id) {
    return { type: "document", source: { type: "file", file_id: src.file_id } };
  }

  // Gemini fileUri — não suportado mais
  if (src.fileUri) {
    throw new Error("Arquivo carregado via Gemini não suportado. Recarregue o PDF.");
  }

  // PDF como documento, imagens como imagem
  if (src.media_type === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: src.data } };
  }

  return block;
}

export async function POST(request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json(
      { type: "error", error: { type: "config_error", message: "ANTHROPIC_API_KEY não configurada" } },
      { status: 500 }
    );
  }

  const body = await request.json();

  try {
    const client = new Anthropic({ apiKey });
    const messages = (body.messages || []).map(msg => ({
      role: msg.role,
      content: (Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }])
        .map(convertBlock),
    }));

    const response = await client.messages.create({
      model: body.model || "claude-sonnet-4-6",
      max_tokens: body.max_tokens || 32768,
      system: body.system,
      messages,
    });

    const text = response.content?.find(b => b.type === "text")?.text || "{}";
    console.log(`[Claude] model=${response.model} stop=${response.stop_reason} len=${text.length}`);

    return Response.json({
      content: [{ type: "text", text }],
      finishReason: response.stop_reason,
    });
  } catch (err) {
    console.error("[Claude] error:", err.status, err.message);

    if (err.status === 429 || err.status === 529) {
      return Response.json({
        type: "error",
        error: { type: "rate_limit", message: err.message, retryAfter: 20 },
      });
    }

    return Response.json({
      type: "error",
      error: { type: "claude_error", message: err.message || String(err) },
    });
  }
}
