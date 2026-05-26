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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    }
  );

  const data = await response.json();

  if (data.error) {
    return Response.json({ type: "error", error: { type: "gemini_error", message: data.error.message } });
  }

  // Gemini 2.5 Flash tem "thinking parts" — pega só o texto real (sem thought:true)
  const respParts = data.candidates?.[0]?.content?.parts || [];
  const textPart = respParts.find(p => p.text && !p.thought) || respParts.find(p => p.text);
  const text = textPart?.text || "{}";

  const finish = data.candidates?.[0]?.finishReason;
  console.log("[Gemini] finishReason:", finish);
  console.log("[Gemini] resposta completa:\n", text.slice(0, 2000));

  return Response.json({ content: [{ type: "text", text }] });
}
