export async function POST(request) {
  const body = await request.json();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { type: "error", error: { type: "config_error", message: "OPENAI_API_KEY não configurada no servidor" } },
      { status: 500 }
    );
  }

  // Converte formato Anthropic → OpenAI
  const messages = [];

  if (body.system) {
    messages.push({ role: "system", content: body.system });
  }

  for (const msg of body.messages || []) {
    if (Array.isArray(msg.content)) {
      const content = msg.content.map(block => {
        if (block.type === "image") {
          return {
            type: "image_url",
            image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
          };
        }
        if (block.type === "text") {
          return { type: "text", text: block.text };
        }
        return block;
      });
      messages.push({ role: msg.role, content });
    } else {
      messages.push(msg);
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: body.max_tokens || 4096,
      messages,
    }),
  });

  const data = await response.json();

  if (data.error) {
    return Response.json({ type: "error", error: data.error });
  }

  // Converte resposta OpenAI → formato Anthropic (o componente espera esse formato)
  const text = data.choices?.[0]?.message?.content || "{}";
  return Response.json({
    content: [{ type: "text", text }],
    model: data.model,
    usage: data.usage,
  });
}
