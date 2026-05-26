async function chamarGemini(geminiBody, apiKey, tentativa = 0) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    }
  );

  const data = await response.json();

  // Rate limit (429) — espera o tempo sugerido e retenta até 3x
  if (data.error?.code === 429 && tentativa < 3) {
    const msg = data.error.message || "";
    const retryMatch = msg.match(/retry.*?(\d+(?:\.\d+)?)s/i);
    const espera = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 2 : 20;
    console.log(`[Gemini] rate limit — aguardando ${espera}s (tentativa ${tentativa + 1}/3)`);
    await new Promise(r => setTimeout(r, espera * 1000));
    return chamarGemini(geminiBody, apiKey, tentativa + 1);
  }

  return data;
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
    return Response.json({ type: "error", error: { type: "gemini_error", message: data.error.message } });
  }

  // Gemini 2.5 Flash tem "thinking parts" — pega só o texto real (sem thought:true)
  const respParts = data.candidates?.[0]?.content?.parts || [];
  const textPart = respParts.find(p => p.text && !p.thought) || respParts.find(p => p.text);
  const text = textPart?.text || "{}";

  console.log("[Gemini] finishReason:", data.candidates?.[0]?.finishReason);

  return Response.json({ content: [{ type: "text", text }] });
}
