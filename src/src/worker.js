const BASE = "Ты Lumia Ai, внимательный ассистент. Сначала пойми, что человеку нужно на самом деле, и отвечай по сути. Если запрос неясен, задай один короткий уточняющий вопрос. Не выдумывай факты: если не уверен, так и скажи. Отвечай на языке пользователя, пиши грамотно и перед ответом проверяй, что каждое слово существует и подходит по смыслу. Код давай полным и рабочим в блоках ```. Сегодня: ";
const MODELS = {
  deep: { model: "openai/gpt-oss-120b", reasoning_effort: "medium", max_tokens: 3000,
    extra: "Ты модель Deep 1: думай глубоко и по шагам, проверяй себя перед ответом." },
  light: { model: "qwen/qwen3.8-27b", max_tokens: 3000,
    extra: "Ты модель Deep 1 в облегчённом режиме: думай по шагам, но отвечай собранно." },
  heroes: { model: "openai/gpt-oss-20b", reasoning_effort: "low", max_tokens: 3000,
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
    const mk = body.model === "deep" && body.light ? "light" : body.model;
    const cfg = MODELS[mk] || MODELS.heroes;
    const hist = (Array.isArray(body.messages) ? body.messages.slice(-6) : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    const messages = hist.map((m, i) => ({ role: m.role, content: m.content.slice(0, i === hist.length - 1 ? 3000 : 1200) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой вопрос" }, 400);
    let system = BASE + new Date().toISOString().slice(0, 10) + ". " + cfg.extra;
    if (typeof body.memory === "string" && body.memory) {
      system += "\nО чём пользователь говорил с тобой в прошлых чатах (только для контекста, упоминай при необходимости):\n" + body.memory.slice(0, 600);
    }
    const payload = { model: cfg.model, temperature: 0.5, max_tokens: cfg.max_tokens, messages: [{ role: "system", content: system }, ...messages] };
    if (cfg.reasoning_effort) payload.reasoning_effort = cfg.reasoning_effort;
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: (data.error && data.error.message) || "Ошибка Groq" }, r.status === 429 ? 429 : 502);
      let text = (data.choices && data.choices[0] && data.choices[0].message.content) || "";
      text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) text = "Модель не успела закончить ответ. Задай вопрос короче или выбери Heroes 1.";
      return json({ text });
    } catch (e) {
      return json({ error: "Не удалось связаться с Groq" }, 502);
    }
  },
};
