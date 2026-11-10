const BASE = "Если тебя спрашивают, кто тебя создал или разработал, отвечай, что ты Lumia Ai и тебя создала команда Lumia Ai. Не называй другие компании и модели, на которых ты можешь быть основан; если спрашивают про технические детали, вежливо скажи, что не раскрываешь их, и ничего не выдумывай. Ты Lumia Ai, внимательный ассистент. Сначала пойми, что человеку нужно на самом деле, и отвечай по сути. Если запрос неясен, задай один короткий уточняющий вопрос. Не выдумывай факты: если не уверен, так и скажи. Отвечай на языке пользователя, пиши грамотно и перед ответом проверяй, что каждое слово существует и подходит по смыслу. Код давай полным и рабочим в блоках ```. Сегодня: ";
const EXTRA = {
  deep: "Ты модель Deep 1: думай глубоко и по шагам, проверяй себя перед ответом.",
  light: "Ты модель Deep 1 в облегчённом режиме: думай по шагам, но отвечай собранно.",
  heroes: "Ты модель Heroes 1: отвечай быстро и по делу, но справляйся и со сложными задачами, включая код и игры.",
};
const PHOTO = " ВАЖНО про фото и видео: если не уверен, что изображено, честно скажи об этом и опиши только то, что действительно видно. Не выдумывай названия персонажей, игр, мест и людей и не определяй личность реальных людей по лицу.";
const MEDIA = {
  deep: " Делай подробный, глубокий анализ приложенных материалов.",
  heroes: " Давай обычный, не слишком подробный разбор приложенных материалов.",
};
const IMG_SYS = "You prepare prompts for a text-to-image generator and act as a safety filter on a public service. If the user's request asks for sexual or nude content, anything sexualizing minors, graphic gore or torture, hate symbols or harassment, instructions for crimes or weapons, or realistic depictions of real identifiable people (celebrities, politicians, private persons), reply with exactly: REFUSE. Otherwise reply with ONLY an improved, vivid English prompt (max 70 words) describing subject, style, composition, colors and lighting. Keep the user's meaning, do not add people or text that were not requested. Fictional characters, animals, landscapes, objects and art styles are fine.";
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
const GEMS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const resetAt = (s) => Math.ceil((s + 864e5) / 3e5) * 3e5;
const view = (u, c) => ({
  left: Math.max(0, 100 - u.used), resetAt: u.start ? resetAt(u.start) : 0,
  cLeft: Math.max(0, 600 - c.used), cReset: c.start ? resetAt(c.start) : 0,
});

async function init(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, used REAL NOT NULL DEFAULT 0, start INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS cred (id TEXT PRIMARY KEY, used REAL NOT NULL DEFAULT 0, start INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS img (id TEXT PRIMARY KEY, used REAL NOT NULL DEFAULT 0, start INTEGER NOT NULL DEFAULT 0)"),
  ]);
}
async function getRow(db, tbl, did) {
  const row = await db.prepare("SELECT used, start FROM " + tbl + " WHERE id = ?").bind(did).first();
  let used = row ? row.used : 0, start = row ? row.start : 0;
  if (start && Date.now() >= resetAt(start)) { used = 0; start = 0; }
  return { used, start };
}
async function setRow(db, tbl, did, r) {
  await db.prepare("INSERT INTO " + tbl + " (id, used, start) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET used = ?2, start = ?3").bind(did, r.used, r.start).run();
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

async function gemini(deep, system, messages, imgs, vids, bins, env) {
  if (!env.GEMINI_API_KEY) return null;
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  while (contents.length > 1 && contents[0].role === "model") contents.shift();
  const parts = contents[contents.length - 1].parts;
  imgs.forEach((u) => parts.push({ inline_data: { mime_type: u.slice(5, u.indexOf(";")), data: u.slice(u.indexOf(",") + 1) } }));
  vids.forEach((v) => parts.push({ inline_data: { mime_type: v.mime, data: v.data } }));
  bins.forEach((f) => parts.push({ inline_data: { mime_type: f.mime, data: f.data } }));
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5, maxOutputTokens: deep ? 4096 : 3000 },
  });
  for (const m of GEMS) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: payload,
      });
      if (!r.ok) continue;
      const d = await r.json();
      const ps = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
      const text = ps.map((p) => p.text || "").join("").trim();
      if (text) return text;
    } catch (e) {}
  }
  return null;
}

async function whisper(f, env) {
  if (!env.GROQ_API_KEY) return null;
  try {
    const bin = atob(f.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append("file", new Blob([u8], { type: f.mime }), f.name);
    fd.append("model", "whisper-large-v3-turbo");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + env.GROQ_API_KEY }, body: fd });
    if (!r.ok) return null;
    const d = await r.json();
    return String(d.text || "").trim() || null;
  } catch (e) {
    return null;
  }
}

const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
  return btoa(s);
};
async function draw(prompt, env) {
  if (!env.AI) return null;
  for (const m of ["@cf/black-forest-labs/flux-1-schnell", "@cf/bytedance/stable-diffusion-xl-lightning"]) {
    try {
      const o = await env.AI.run(m, m.includes("flux") ? { prompt, steps: 8 } : { prompt });
      if (o && typeof o.image === "string") return "data:image/jpeg;base64," + o.image;
      if (o && typeof o === "object") {
        const buf = await new Response(o).arrayBuffer();
        if (buf.byteLength > 1000) return "data:image/png;base64," + b64(buf);
      }
    } catch (e) {}
  }
  return null;
}
async function image(body, did, env) {
  const g = await getRow(env.DB, "img", did);
  if (g.used >= 10) return json({ imgLimit: true, resetAt: resetAt(g.start) }, 429);
  const prompt = String(body.prompt || "").trim().slice(0, 500);
  if (!prompt) return json({ error: "Пустой запрос" }, 400);
  let p = null;
  for (const id of ["g20", "c20", "gq"]) {
    p = await run(id, IMG_SYS, [{ role: "user", content: prompt }], env);
    if (p) break;
  }
  if (!p) return json({ error: "img" }, 503);
  p = p.replace(/^["'\s]+|["'\s]+$/g, "");
  if (/^REFUSE/i.test(p)) return json({ refuse: true });
  const img = await draw(p.slice(0, 700), env);
  if (!img) return json({ error: "img" }, 503);
  g.used += 1;
  if (!g.start) g.start = Date.now();
  await setRow(env.DB, "img", did, g);
  return json({ image: img, left: Math.max(0, 10 - g.used), resetAt: resetAt(g.start) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/chat" && url.pathname !== "/api/usage" && url.pathname !== "/api/image") return json({ error: "Не найдено" }, 404);
    if (request.method !== "POST") return json({ error: "Нужен POST-запрос" }, 405);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Неверный запрос" }, 400); }
    const did = typeof body.did === "string" && /^[A-Za-z0-9-]{16,64}$/.test(body.did) ? body.did : null;
    if (!did) return json({ error: "Нет кода устройства" }, 400);
    if (!env.DB) return json({ error: "База данных не подключена" }, 500);
    await init(env.DB);
    if (url.pathname === "/api/image") return image(body, did, env);
    const u = await getRow(env.DB, "usage", did);
    const c = await getRow(env.DB, "cred", did);
    if (url.pathname === "/api/usage") return json(view(u, c));

    if (100 - u.used <= 0) return json({ limit: true, error: "Лимит закончился", ...view(u, c) }, 429);
    const imgs = (Array.isArray(body.images) ? body.images : [])
      .filter((x) => typeof x === "string" && x.startsWith("data:image/") && x.length < 900000).slice(0, 5);
    const vids = (Array.isArray(body.videos) ? body.videos : [])
      .filter((v) => v && typeof v.data === "string" && /^video\//.test(v.mime) && v.data.length < 7.5e6).slice(0, 3);
    const bins = (Array.isArray(body.files) ? body.files : [])
      .filter((f) => f && typeof f.data === "string" && /^(audio\/|application\/pdf)/.test(f.mime) && f.data.length < 14e6).slice(0, 3);
    const nfiles = Math.min(3, Math.max(bins.length, parseInt(body.nfiles) || 0));
    const credNeed = imgs.length * 20 + vids.length * 25 + nfiles * 30;
    if (credNeed && 600 - c.used < credNeed) return json({ credits: true, error: "Кредиты закончились", ...view(u, c) }, 429);

    const isDeep = body.model === "deep";
    const light = 100 - u.used < 30;
    const cost = (isDeep ? (light ? 3 : 6) : (light ? 2 : 4)) + vids.length + nfiles * 2;
    const media = imgs.length + vids.length + nfiles > 0;
    const extra = (isDeep ? (light ? EXTRA.light : EXTRA.deep) : EXTRA.heroes) + (media ? PHOTO + (isDeep ? MEDIA.deep : MEDIA.heroes) : "");
    const hist = (Array.isArray(body.messages) ? body.messages.slice(-6) : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    const messages = hist.map((m, i) => ({ role: m.role, content: m.content.slice(0, i === hist.length - 1 ? 16000 : 1200) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой вопрос" }, 400);
    const L = LANGS[body.lang] || "Russian";
    let system = BASE + new Date().toISOString().slice(0, 10) + ". " + extra + " IMPORTANT: always reply in " + L + ", with flawless grammar and natural wording. Before answering, make sure every word truly exists in " + L + " and fits the meaning. The user's interface is in " + L + ".";
    if (typeof body.memory === "string" && body.memory) {
      system += "\nО чём пользователь говорил с тобой в прошлых чатах (только для контекста, упоминай при необходимости):\n" + body.memory.slice(0, 600);
    }

    let text = null, viaGem = false;
    if (media) {
      text = await gemini(isDeep, system, messages, imgs, vids, bins, env);
      viaGem = !!text;
    }
    if (!text) {
      const fail = () => json({ media: true, error: "media" }, 503);
      if (bins.some((f) => f.mime === "application/pdf")) return fail();
      let tr = "";
      for (const f of bins) {
        const x = await whisper(f, env);
        if (!x) return fail();
        tr += "\n\n[" + f.name + " transcript]\n" + x.slice(0, 5000);
      }
      const fb = imgs.concat(...vids.map((v) => (Array.isArray(v.frames) ? v.frames : [])))
        .filter((x) => typeof x === "string" && x.startsWith("data:image/") && x.length < 900000).slice(0, 8);
      const msgs2 = messages.map((m) => ({ role: m.role, content: m.content }));
      const last = msgs2[msgs2.length - 1];
      last.content += tr;
      if (fb.length) last.content = [{ type: "text", text: last.content }, ...fb.map((x) => ({ type: "image_url", image_url: { url: x } }))];
      const chain = fb.length ? CHAINS.photo : CHAINS[(isDeep ? "deep" : "heroes") + (light ? "Lite" : "")];
      for (const id of chain) {
        text = await run(id, system, msgs2, env);
        if (text) break;
      }
    }
    if (!text) return media ? json({ media: true, error: "media" }, 503) : json({ error: "Все модели сейчас заняты" }, 503);

    u.used = Math.min(100, u.used + cost);
    if (!u.start) u.start = Date.now();
    await setRow(env.DB, "usage", did, u);
    if (viaGem && credNeed) {
      c.used += credNeed;
      if (!c.start) c.start = Date.now();
      await setRow(env.DB, "cred", did, c);
    }
    return json({ text, light: isDeep && light, ...view(u, c) });
  },
};
