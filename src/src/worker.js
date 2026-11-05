const MODELS = {
  deep: {
    model: "openai/gpt-oss-120b",
    reasoning_effort: "medium",
    max_tokens: 4000,
    system:
      "Ты Lumia Ai, модель Deep 1. Думай глубоко и по шагам. Для кода давай полный рабочий код в блоках ```. Отвечай ясно и по делу, на языке пользователя.",
  },
  heroes: {
    model: "llama-3.1-8b-instant",
    max_tokens: 800,
    system:
      "Ты Lumia Ai, модель Heroes 1. Отвечай быстро, коротко и понятно, на языке пользователя.",
  },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") return json({ error: "Не найдено" }, 404);
    if (request.method !== "POST") return json({ error: "Нужен POST-запрос" }, 405);

    const key = env.GROQ_API_KEY;
    if (!key) return json({ error: "На сервере не задан ключ GROQ_API_KEY" }, 500);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Неверный запрос" }, 400);
    }

    const cfg = MODELS[body.model] || MODELS.heroes;
    const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const messages = history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return json({ error: "Пустой вопрос" }, 400);
    }

    const payload = {
      model: cfg.model,
      max_tokens: cfg.max_tokens,
      messages: [{ role: "system", content: cfg.system }, ...messages],
    };
    if (cfg.reasoning_effort) payload.reasoning_effort = cfg.reasoning_effort;

    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        return json(
          { error: (data && data.error && data.error.message) || "Ошибка Groq" },
          r.status === 429 ? 429 : 502
        );
      }
      const text = data.choices && data.choices[0] && data.choices[0].message.content;
      return json({ text: text || "" });
    } catch (e) {
      return json({ error: "Не удалось связаться с Groq" }, 502);
    }
  },
};
