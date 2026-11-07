const BASE = "Ты Lumia Ai, внимательный ассистент. Сначала пойми, что человеку нужно на самом деле, и отвечай по сути. Если запрос неясен, задай один короткий уточняющий вопрос. Не выдумывай факты: если не уверен, так и скажи. Отвечай на языке пользователя, пиши грамотно и перед ответом проверяй, что каждое слово существует и подходит по смыслу. Код давай полным и рабочим в блоках ```. Сегодня: ";
const MODELS = {
  deep: { model: "openai/gpt-oss-120b", reasoning_effort: "medium", max_tokens: 3000,
    extra: "Ты модель Deep 1: думай глубоко и по шагам, проверяй себя перед ответом." },
  light: { model: "qwen/qwen3.8-27b", max_tokens: 3000,
    extra: "Ты модель Deep 1 в облегчённом режиме: думай по шагам, но отвечай собранно." },
  heroes: { model: "openai/gpt-oss-20b", reasoning_effort: "low", max_tokens: 3000,
    extra: "Ты модель Heroes 1: отвечай быстро и по делу, но справляйся и со сложными задачами, включая код и игры." },
};
const LANGS = { ru: "Russian", en: "English", uk: "Ukrainian", es: "Spanish", de: "German", fr: "French", it: "Italian", pt: "Portuguese", pl: "Polish", tr: "Turkish", zh: "Simplified Chinese", ja: "Japanese", ko: "Korean", hi: "Hindi", th: "Thai" };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const resetAt = (s) => Math.ceil((s + 864e5) / 3e5) * 3e5;
const view = (used, start) => ({ left: Math.max(0, 100 - used), resetAt: start ? resetAt(start) : 0 });

async function getUsage(db, did) {
  await db.prepare("CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, used REAL NOT NULL DEFAULT 0, start INTEGER NOT NULL DEFAULT 0)").run();
  const row = await db.prepare("SELECT used, start FROM usage WHERE id = ?").bind(did).first();
  let used = row ? row.used : 0, start = row ? row.start : 0;
  if (start && Date.now() >= resetAt(start)) { used = 0; start = 0; }
  return { used, start };
}
async function saveUsage(db, did, used, start) {
  await db.prepare("INSERT INTO usage (id, used, start) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET used = ?2, start = ?3").bind(did, used, start).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat" && url.pathname !== "/api/usage") return json({ error: "Не найдено" }, 404);
    if (request.method !== "POST") return json({ error: "Нужен POST-запрос" }, 405);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Неверный запрос" }, 400); }
    const did = typeof body.did === "string" && /^[A-Za-z0-9-]{16,64}$/.test(body.did) ? body.did : null;
    if (!did) return json({ error: "Нет кода устройства" }, 400);
    if (!env.DB) return json({ error: "База данных не подключена" }, 500);
    let { used, start } = await getUsage(env.DB, did);
    if (url.pathname === "/api/usage") return json(view(used, start));

    if (100 - used <= 0) return json({ limit: true, error: "Лимит закончился", left: 0, resetAt: resetAt(start) }, 429);
    const key = env.GROQ_API_KEY;
    if (!key) return json({ error: "Нет ключа GROQ_API_KEY" }, 500);
    const isDeep = body.model === "deep";
    const light = isDeep && 100 - used < 30;
    const cost = isDeep ? (light ? 3 : 6) : 4;
    const cfg = MODELS[isDeep ? (light ? "light" : "deep") : "heroes"];
    const hist = (Array.isArray(body.messages) ? body.messages.slice(-6) : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    const messages = hist.map((m, i) => ({ role: m.role, content: m.content.slice(0, i === hist.length - 1 ? 3000 : 1200) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой вопрос" }, 400);
    const L = LANGS[body.lang] || "Russian";
    let system = BASE + new Date().toISOString().slice(0, 10) + ". " + cfg.extra + " IMPORTANT: always reply in " + L + ", with flawless grammar and natural wording. Before answering, make sure every word truly exists in " + L + " and fits the meaning. The user's interface is in " + L + ".";
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
      used = Math.min(100, used + cost);
      if (!start) start = Date.now();
      await saveUsage(env.DB, did, used, start);
      return json({ text, light, ...view(used, start) });
    } catch (e) {
      return json({ error: "Не удалось связаться с Groq" }, 502);
    }
  },
};
