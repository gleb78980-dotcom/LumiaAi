const BASE = "Если тебя спрашивают, кто тебя создал или разработал, отвечай, что ты Lumia Ai и тебя создала команда Lumia Ai. Не называй другие компании и модели, на которых ты можешь быть основан; если спрашивают про технические детали, вежливо скажи, что не раскрываешь их, и ничего не выдумывай. Ты Lumia Ai, внимательный ассистент. Сначала пойми, что человеку нужно на самом деле, и отвечай по сути. Если запрос неясен, задай один короткий уточняющий вопрос. Не выдумывай факты: если не уверен, так и скажи. Отвечай на языке пользователя, пиши грамотно и перед ответом проверяй, что каждое слово существует и подходит по смыслу. Код давай полным и рабочим в блоках ```. Сегодня: ";
const EXTRA = {
  deep: "Ты модель Deep 1: думай глубоко и по шагам, проверяй себя перед ответом.",
  light: "Ты модель Deep 1 в облегчённом режиме: думай по шагам, но отвечай собранно.",
  heroes: "Ты модель Heroes 1: отвечай быстро и по делу, но справляйся и со сложными задачами, включая код и игры.",
};
const PHOTO = " ВАЖНО про фото: если не уверен, что изображено, честно скажи об этом и опиши только то, что действительно видно. Не выдумывай названия персонажей, игр, мест и людей и не определяй личность реальных людей по лицу.";
const P = {
  g120: { p: "groq", m: "openai/gpt-oss-120b", r: "medium" },
  gq: { p: "groq", m: "qwen/qwen3.8-27b" },
  g20: { p: "groq", m: "openai/gpt-oss-20b", r: "low" },
  c120: { p: "cf", m: "@cf/openai/gpt-oss-120b" },
  c20: { p: "cf", m: "@cf/openai/gpt-oss-20b" },
  cq: { p: "cf", m: "@cf/qwen/qwen3.8-27b" },
  glm: { p: "cf", m: "@cf/zai-org/glm-4.7-flash" },
  cl4: { p: "cf", m: "@cf/meta/llama-4-scout-17b-16e-instruct" },
  cm: { p: "cf", m: "@cf/mistralai/mistral-small-3.1-24b-instruct" },
  cg3: { p: "cf", m: "@cf/google/gemma-3-12b-it" },
};
const CHAINS = {
  deep: ["g120", "gq", "c120", "cq", "glm"],
  deepLite: ["gq", "c120", "cq", "glm"],
  heroes: ["g20", "c20", "gq", "glm"],
  heroesLite: ["gq", "g20", "c20", "glm"],
  photo: ["cl4", "cm", "cg3", "cq", "gq"],
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

async function run(id, system, messages, env) {
  const c = P[id];
  try {
    let text = "";
    if (c.p === "groq") {
      if (!env.GROQ_API_KEY) return null;
      const b = { model: c.m, temperature: 0.5, max_tokens: 3000, messages: [{ role: "system", content: system }, ...messages] };
      if (c.r) b.reasoning_effort = c.r;
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.GROQ_API_KEY },
        body: JSON.stringify(b),
      });
      if (!r.ok) return null;
      const d = await r.json();
      text = (d.choices && d.choices[0] && d.choices[0].message.content) || "";
    } else {
      if (!env.AI) return null;
      const d = await env.AI.run(c.m, { max_tokens: 3000, temperature: 0.5, messages: [{ role: "system", content: system }, ...messages] });
      text = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || (d && d.response) || "";
    }
    text = String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

async function stt(request, url, env) {
  const did = url.searchParams.get("did") || "";
  if (!/^[A-Za-z0-9-]{16,64}$/.test(did)) return json({ error: "Нет кода устройства" }, 400);
  if (!env.DB || !env.GROQ_API_KEY) return json({ stt: true, error: "stt" }, 503);
  const u = await getUsage(env.DB, did);
  if (100 - u.used <= 0) return json({ limit: true, left: 0, resetAt: resetAt(u.start) }, 429);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 10.5e6) return json({ stt: true, error: "size" }, 413);
  let name = "audio.mp3";
  try { name = decodeURIComponent(request.headers.get("X-Name") || name); } catch (e) {}
  name = name.replace(/[^\w.\-]+/g, "_").slice(-60);
  if (!/\.(mp3|wav|m4a|ogg|flac|webm|mp4|mpeg|mpga)$/i.test(name)) name += ".mp3";
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: request.headers.get("Content-Type") || "audio/mpeg" }), name);
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("response_format", "json");
  try {
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + env.GROQ_API_KEY }, body: fd });
    if (!r.ok) return json({ stt: true, error: "stt" }, 503);
    const d = await r.json();
    const text = String((d && d.text) || "").trim();
    if (text.length < 3) return json({ stt: true, error: "empty" }, 503);
    const used = Math.min(100, u.used + 3), start = u.start || Date.now();
    await saveUsage(env.DB, did, used, start);
    return json({ text, ...view(used, start) });
  } catch (e) {
    return json({ stt: true, error: "stt" }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat" && url.pathname !== "/api/usage" && url.pathname !== "/api/stt") return json({ error: "Не найдено" }, 404);
    if (request.method !== "POST") return json({ error: "Нужен POST-запрос" }, 405);
    if (url.pathname === "/api/stt") return stt(request, url, env);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Неверный запрос" }, 400); }
    const did = typeof body.did === "string" && /^[A-Za-z0-9-]{16,64}$/.test(body.did) ? body.did : null;
    if (!did) return json({ error: "Нет кода устройства" }, 400);
    if (!env.DB) return json({ error: "База данных не подключена" }, 500);
    let { used, start } = await getUsage(env.DB, did);
    if (url.pathname === "/api/usage") return json(view(used, start));

    if (100 - used <= 0) return json({ limit: true, error: "Лимит закончился", left: 0, resetAt: resetAt(start) }, 429);
    const isDeep = body.model === "deep";
    const light = 100 - used < 30;
    const imgs = (Array.isArray(body.images) ? body.images : [])
      .filter((u) => typeof u === "string" && u.startsWith("data:image/") && u.length < 900000).slice(0, 5);
    const cost = (isDeep || imgs.length) ? (light ? 3 : 6) : (light ? 2 : 4);
    const chain = imgs.length ? CHAINS.photo : CHAINS[(isDeep ? "deep" : "heroes") + (light ? "Lite" : "")];
    const extra = (isDeep ? (light ? EXTRA.light : EXTRA.deep) : EXTRA.heroes) + (imgs.length ? PHOTO : "");
    const hist = (Array.isArray(body.messages) ? body.messages.slice(-6) : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    const messages = hist.map((m, i) => ({ role: m.role, content: m.content.slice(0, i === hist.length - 1 ? 16000 : 1200) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой вопрос" }, 400);
    if (imgs.length) {
      const last = messages[messages.length - 1];
      last.content = [{ type: "text", text: last.content }, ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))];
    }
    const L = LANGS[body.lang] || "Russian";
    let system = BASE + new Date().toISOString().slice(0, 10) + ". " + extra + " IMPORTANT: always reply in " + L + ", with flawless grammar and natural wording. Before answering, make sure every word truly exists in " + L + " and fits the meaning. The user's interface is in " + L + ".";
    if (typeof body.memory === "string" && body.memory) {
      system += "\nО чём пользователь говорил с тобой в прошлых чатах (только для контекста, упоминай при необходимости):\n" + body.memory.slice(0, 600);
    }
    let text = null;
    for (const id of chain) {
      text = await run(id, system, messages, env);
      if (text) break;
    }
    if (!text) return json(imgs.length ? { error: "photo", photo: true } : { error: "Все модели сейчас заняты" }, 503);
    used = Math.min(100, used + cost);
    if (!start) start = Date.now();
    await saveUsage(env.DB, did, used, start);
    return json({ text, light: isDeep && light, ...view(used, start) });
  },
};
