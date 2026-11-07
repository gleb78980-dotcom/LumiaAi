const BASE = "Ты Lumia Ai, внимательный ассистент. Сначала пойми, что человеку нужно на самом деле, и отвечай по сути. Если запрос неясен, задай один короткий уточняющий вопрос. Не выдумывай факты: если не уверен, так и скажи. Отвечай на языке пользователя. Код давай полным и рабочим в блоках ```. Сегодня: ";
const MODELS = {
  deep: { model: "openai/gpt-oss-120b", reasoning_effort: "high", max_tokens: 4000,
    extra: "Ты модель Deep 1: думай глубоко и по шагам, проверяй себя перед ответом." },
  heroes: { model: "openai/gpt-oss-20b", reasoning_effort: "low", max_tokens: 4000,
    extra: "Ты модель Heroes 1: отвечай быстро и по делу, но справляйся и со сложными задачами, включая код и игры." },
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") return json({ error: "Не найдено" }, 404);
    if (request.method !== "POST") return json({ error: "Нужен POST-запрос" }, 405);
    const key = env.GROQ_API_KEY;
    if (!key) return json({ error: "Нет ключа GROQ_API_KEY" }, 500);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Неверный запрос" }, 400); }
    const cfg = { ...(MODELS[body.model] || MODELS.heroes) };
    if (body.model === "deep" && body.light) {
      cfg.reasoning_effort = "low"; cfg.max_tokens = 2000; cfg.extra += " Сейчас облегчённый режим: отвечай короче.";
    }
    const messages = (Array.isArray(body.messages) ? body.messages.slice(-12) : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой вопрос" }, 400);
    let system = BASE + new Date().toISOString().slice(0, 10) + ". " + cfg.extra;
    if (typeof body.memory === "string" && body.memory) {
      system += "\nО чём пользователь говорил с тобой в прошлых чатах (только для контекста, упоминай при необходимости):\n" + body.memory.slice(0, 800);
    }
    const payload = { model: cfg.model, max_tokens: cfg.max_tokens, messages: [{ role: "system", content: system }, ...messages] };
    if (cfg.reasoning_effort) payload.reasoning_effort = cfg.reasoning_effort;
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: (data.error && data.error.message) || "Ошибка Groq" }, r.status === 429 ? 429 : 502);
      return json({ text: (data.choices && data.choices[0] && data.choices[0].message.content) || "" });
    } catch (e) {
      return json({ error: "Не удалось связаться с Groq" }, 502);
    }
  },
};
