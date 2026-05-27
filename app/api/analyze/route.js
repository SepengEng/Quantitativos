// Modelos Gemini em ordem de qualidade — cada um tem quota separada de 20 RPM
const MODELOS = [
  "gemini-2.5-flash",           // Best vision + reasoning for technical drawings
  "gemini-2.5-flash-lite",      // Fallback: faster/cheaper 2.5 variant
  "gemini-2.0-flash",           // Stable fallback
  "gemini-1.5-pro",             // Legacy Pro: excellent vision
  "gemini-1.5-flash",           // Legacy Flash: fast
  "gemini-2.0-flash-lite",      // Last resort
];

async function chamarGemini(geminiBody, apiKey) {
  let lastError = null;
  let anyRateLimit = false;

  for (const modelo of MODELOS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      }
    );
    const data = await response.json();

    if (data.error) {
      lastError = data.error;
      const isRL = data.error.code === 429 || data.error.status === "RESOURCE_EXHAUSTED";
      if (isRL) anyRateLimit = true;
      console.log(`[Gemini] ${modelo} erro ${data.error.code || data.error.status || "?"} — próximo modelo`);
      continue;
    }

    console.log(`[Gemini] modelo: ${modelo} | finish: ${data.candidates?.[0]?.finishReason}`);
    return data;
  }

  // Todos os modelos falharam
  const msg = lastError?.message || "Todos os modelos Gemini falharam";
  if (anyRateLimit) {
    const retryMatch = msg.match(/retry.*?(\d+(?:\.\d+)?)s/i);
    const retryAfter = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 2 : 30;
    return { error: { code: 429, type: "rate_limit", message: msg, retryAfter } };
  }
  return { error: { code: lastError?.code || 500, type: "gemini_error", message: msg } };
}

export async function POST(request) {
  const body = await request.json();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { type: "error", error: { type: "config_error", message: "GEMINI_API_KEY não configurada no servidor" } },
      { status: 500 }
    );
  }

  const parts = [];
  for (const msg of body.messages || []) {
    const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
    for (const block of content) {
      if (block.type === "image") {
        if (block.source.fileUri) {
          // Arquivo grande carregado via Gemini File API
          parts.push({ file_data: { mime_type: block.source.media_type, file_uri: block.source.fileUri } });
        } else {
          parts.push({ inline_data: { mime_type: block.source.media_type, data: block.source.data } });
        }
      } else if (block.type === "text") {
        parts.push({ text: block.text });
      }
    }
  }

  const geminiBody = {
    systemInstruction: body.system ? { parts: [{ text: body.system }] } : undefined,
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: body.max_tokens || 32768 },
  };

  const data = await chamarGemini(geminiBody, apiKey);

  if (data.error) {
    const isRateLimit = data.error.code === 429 || data.error.type === "rate_limit";
    return Response.json({
      type: "error",
      error: {
        type: isRateLimit ? "rate_limit" : "gemini_error",
        message: data.error.message,
        retryAfter: data.error.retryAfter || 30,
      }
    });
  }

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason || "UNKNOWN";
  const respParts = candidate?.content?.parts || [];
  const textPart = respParts.find(p => p.text && !p.thought) || respParts.find(p => p.text);
  const text = textPart?.text || "{}";

  console.log(`[Gemini] finishReason=${finishReason} textLen=${text.length}`);

  return Response.json({ content: [{ type: "text", text }], finishReason });
}
