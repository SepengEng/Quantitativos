// Modelos em ordem de qualidade — cada um tem quota separada de 20 RPM
const MODELOS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
];

async function chamarGemini(geminiBody, apiKey) {
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

    if (data.error?.code === 429) {
      // Rate limit neste modelo — tenta o próximo
      console.log(`[Gemini] ${modelo} rate limited, tentando próximo...`);
      continue;
    }

    console.log(`[Gemini] modelo usado: ${modelo}, finishReason: ${data.candidates?.[0]?.finishReason}`);
    return data;
  }

  // Todos os modelos esgotados — retorna rate_limit para o cliente esperar e retentar
  const msg = data?.error?.message || "Todos os modelos Gemini atingiram o rate limit";
  const retryMatch = (msg || "").match(/retry.*?(\d+(?:\.\d+)?)s/i);
  const retryAfter = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 2 : 20;
  return { error: { code: 429, type: "rate_limit", message: msg, retryAfter } };
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

  // Converte formato Anthropic → Gemini
  const parts = [];
  for (const msg of body.messages || []) {
    const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
    for (const block of content) {
      if (block.type === "image") {
        parts.push({ inline_data: { mime_type: block.source.media_type, data: block.source.data } });
      } else if (block.type === "text") {
        parts.push({ text: block.text });
      }
    }
  }

  const geminiBody = {
    systemInstruction: body.system ? { parts: [{ text: body.system }] } : undefined,
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: body.max_tokens || 8192,
      thinkingConfig: { thinkingBudget: 2048 },
    },
  };

  const data = await chamarGemini(geminiBody, apiKey);

  if (data.error) {
    const isRateLimit = data.error.code === 429 || data.error.type === "rate_limit";
    return Response.json({
      type: "error",
      error: {
        type: isRateLimit ? "rate_limit" : "gemini_error",
        message: data.error.message,
        retryAfter: data.error.retryAfter || null,
      }
    });
  }

  // Gemini 2.5 tem "thinking parts" — pega só o texto real
  const respParts = data.candidates?.[0]?.content?.parts || [];
  const textPart = respParts.find(p => p.text && !p.thought) || respParts.find(p => p.text);
  const text = textPart?.text || "{}";

  return Response.json({ content: [{ type: "text", text }] });
}
