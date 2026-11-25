// Ons Twee – Telegram bot. Message it to add things to the app.
//   "27 Nov Concordia scrips"          → calendar      "18-26 Des Bruce on the farm" → multi-day event
//   "Saterdag 14:00 Braai by Ma"       → calendar      "koop melk, eiers, brood"     → Groceries
//   "taak: bins uitsit vrydag"         → chores        "date: Perdry"                → date-night idea
//   "life admin: renew licence"        → any list by name ("<list name>: items")
//   "resep: Bobotie https://…"         → recipe idea   /vandag  /week  /lys groceries
// Settings live in private.config: telegram_token, telegram_secret, telegram_code, telegram_users (JSON).
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

function serviceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); return keys.default ?? Object.values(keys)[0]; } catch { return ""; }
}
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPA_URL, serviceKey() as string, { auth: { persistSession: false } });
async function cfg() {
  const { data, error } = await db.rpc("push_config");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value])) as Record<string, string>;
}
async function setCfg(key: string, value: string) { const { error } = await db.rpc("set_config_value", { p_key: key, p_value: value }); if (error) throw error; }

// ---------------------------------------------------------------- dates (SAST)
const TZ = "Africa/Johannesburg";
function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (ds: string, n: number) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf = (ds: string) => new Date(ds + "T00:00:00Z").getUTCDay(); // 0 = Sunday
const pad = (n: number) => String(n).padStart(2, "0");
const MON: Record<string, number> = { jan: 1, januarie: 1, january: 1, feb: 2, februarie: 2, february: 2, mrt: 3, mar: 3, maart: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, junie: 6, june: 6, jul: 7, julie: 7, july: 7, aug: 8, augustus: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, des: 12, dec: 12, desember: 12, december: 12 };
const DOW: Record<string, number> = { sondag: 0, sunday: 0, sun: 0, maandag: 1, monday: 1, mon: 1, dinsdag: 2, tuesday: 2, tue: 2, tues: 2,
  woensdag: 3, wednesday: 3, wed: 3, donderdag: 4, thursday: 4, thu: 4, thurs: 4, vrydag: 5, friday: 5, fri: 5, saterdag: 6, saturday: 6, sat: 6 };
const MON_RX = Object.keys(MON).sort((a, b) => b.length - a.length).join("|");
const DOW_RX = Object.keys(DOW).sort((a, b) => b.length - a.length).join("|");
const fmtDate = (ds: string) => new Date(ds + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function mkDate(d: number, m: number, y?: number) {
  const t = today(); let yy = y ?? Number(t.slice(0, 4));
  if (y && y < 100) yy = 2000 + y;
  let ds = `${yy}-${pad(m)}-${pad(d)}`;
  if (!y && ds < addDays(t, -7)) ds = `${yy + 1}-${pad(m)}-${pad(d)}`;
  return ds;
}
const addMonthsD = (ds: string, n: number) => { const d = new Date(ds + "T00:00:00Z"); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
// Recurring events: does an occurrence START on ds? Does one COVER ds (multi-day)?
type Ev = { date: string; end_date?: string | null; repeat?: string | null; repeat_until?: string | null };
function startsOn(e: Ev, ds: string) {
  if (ds < e.date || (e.repeat_until && ds > e.repeat_until)) return false;
  const rep = e.repeat || "none"; if (rep === "none") return ds === e.date;
  const step = ({ daily: 1, weekly: 7, fortnightly: 14 } as Record<string, number>)[rep];
  if (step) return daysBetween(e.date, ds) % step === 0;
  const m = rep === "yearly" ? 12 : 1; const months = (Number(ds.slice(0, 4)) - Number(e.date.slice(0, 4))) * 12 + Number(ds.slice(5, 7)) - Number(e.date.slice(5, 7));
  return months % m === 0 && addMonthsD(e.date, months) === ds;
}
function occursOn(e: Ev, ds: string) {
  const len = e.end_date && e.end_date > e.date ? daysBetween(e.date, e.end_date) : 0;
  for (let k = 0; k <= len; k++) { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - k); if (startsOn(e, d.toISOString().slice(0, 10))) return true; }
  return false;
}
type Found = { date?: string; end?: string; time?: string; rest: string };
function findDate(text: string): Found {
  let s = " " + text + " ", date: string | undefined, end: string | undefined, time: string | undefined;
  const take = (rx: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => { const m = s.match(rx); if (m && fn(m) !== false) s = s.replace(m[0], " "); return !!m; };
  // ranges: "18 - 26 Des", "18 Des - 3 Jan"
  take(new RegExp(`\\b(\\d{1,2})\\s*(${MON_RX})?\\.?\\s*(?:-|–|tot|to|until)\\s*(\\d{1,2})\\s*(${MON_RX})\\.?\\b`, "i"), (m) => {
    const m2 = MON[m[4].toLowerCase()], m1 = m[2] ? MON[m[2].toLowerCase()] : m2;
    date = mkDate(+m[1], m1); end = mkDate(+m[3], m2); if (end < date) end = mkDate(+m[3], m2, Number(date.slice(0, 4)) + 1);
  }) ||
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { date = `${m[1]}-${m[2]}-${m[3]}`; }) ||
  take(new RegExp(`\\b(\\d{1,2})\\s*(${MON_RX})\\.?(?:\\s+(\\d{4}))?\\b`, "i"), (m) => { date = mkDate(+m[1], MON[m[2].toLowerCase()], m[3] ? +m[3] : undefined); }) ||
  take(new RegExp(`\\b(${MON_RX})\\.?\\s+(\\d{1,2})\\b`, "i"), (m) => { date = mkDate(+m[2], MON[m[1].toLowerCase()]); }) ||
  take(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/, (m) => { if (+m[2] > 12) return false; date = mkDate(+m[1], +m[2], m[3] ? +m[3] : undefined); }) ||
  take(/\b(vandag|today)\b/i, () => { date = today(); }) ||
  take(/\b(oormôre|oormore|day after tomorrow)\b/i, () => { date = addDays(today(), 2); }) ||
  take(/\b(môre|more|tomorrow|tmrw)\b/i, () => { date = addDays(today(), 1); }) ||
  take(new RegExp(`\\b(?:volgende |next |hierdie |this |on |op )?(${DOW_RX})\\b`, "i"), (m) => {
    const want = DOW[m[1].toLowerCase()], t = today(); let n = (want - dowOf(t) + 7) % 7; if (/next|volgende/i.test(m[0]) && n === 0) n = 7; date = addDays(t, n);
  });
  // time: 14:00, 14h00, 2pm, 7 am, om 7
  take(/\b(?:om |at |@ ?)?(\d{1,2})[:h](\d{2})\b/i, (m) => { if (+m[1] > 23) return false; time = `${pad(+m[1])}:${m[2]}`; }) ||
  take(/\b(?:om |at |@ ?)?(\d{1,2})\s*(am|pm|vm|nm)\b/i, (m) => { let h = +m[1] % 12; if (/pm|nm/i.test(m[2])) h += 12; time = `${pad(h)}:00`; }) ||
  take(/\b(?:om|at)\s+(\d{1,2})\b/i, (m) => { time = `${pad(+m[1])}:00`; });
  const rest = s.replace(/\s+/g, " ").replace(/^\s*(?:on|op|at|om|-|–|,)\s+/i, "").replace(/\s+(?:on|op|at|om|-|–|,)\s*$/i, "").trim();
  return { date, end, time, rest };
}

// ---------------------------------------------------------------- telegram
async function tg(token: string, method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
async function matchProfile(first: string, users: Record<string, string | null>) {
  const f = norm(first); if (f.length < 2) return null;
  const { data: ps } = await db.from("profiles").select("user_id,name"); const taken = new Set(Object.values(users));
  return (ps ?? []).find((x) => !taken.has(x.user_id) && x.name && (f.startsWith(norm(x.name)) || norm(x.name).startsWith(f))) ?? null;
}
const escH = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const HELP = `<b>Ons Twee bot</b> – send me things to add:
📅 <code>27 Nov Concordia scrips</code>
📅 <code>Saterdag 14:00 Braai by Ma</code>
📅 <code>18-26 Des Bruce on the farm</code>
🔁 <code>Padel elke Dinsdag 18:00</code>
🛒 <code>koop melk, eiers, brood</code>
💊 <code>apteek: sunscreen</code>
✅ <code>taak: bins uitsit vrydag</code>
💕 <code>date: Perdry</code>
🍳 <code>resep: Bobotie https://…</code>
🗂️ <code>life admin: renew licence</code> (any list: <code>list name: items</code>)
/vandag – today · /week – next 7 days · /lys groceries – show a list`;

async function lists() { const { data } = await db.from("lists").select("id,name,emoji"); return (data ?? []) as { id: string; name: string; emoji: string }[]; }
const splitItems = (t: string) => t.split(/\n|,|;| en | and /i).map((x) => x.trim().replace(/^[-•*]\s*/, "")).filter(Boolean);
async function addItems(listName: string, text: string, by: string | null) {
  const L = await lists(); const l = L.find((x) => x.name.toLowerCase() === listName.toLowerCase());
  if (!l) return `I can't find a list called “${escH(listName)}”.`;
  const items = splitItems(text); if (!items.length) return "What should I add?";
  const { error } = await db.from("list_items").insert(items.map((t) => ({ list_id: l.id, text: t.slice(0, 80), done: false, created_by: by })));
  if (error) throw error;
  return `✅ Added to ${l.emoji ?? ""} <b>${escH(l.name)}</b>:\n${items.map((x) => "• " + escH(x)).join("\n")}`;
}
async function eventsBetween(a: string, b: string) {
  const { data } = await db.from("events").select("*").lte("date", b);
  const out: Record<string, unknown>[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) for (const e of data ?? []) {
    if (!startsOn(e, d) && !(d === a && occursOn(e, d))) continue;
    const len = e.end_date && e.end_date > e.date ? daysBetween(e.date, e.end_date) : 0; let s0 = d; while (!startsOn(e, s0)) s0 = addDays(s0, -1);
    out.push({ ...e, date: s0, end_date: len ? addDays(s0, len) : null });
  }
  return out.sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.start_time ?? "").localeCompare(String(y.start_time ?? ""))) as any[];
}
const REPEAT_RX: [RegExp, string][] = [[new RegExp(`\\b(elke|every)(?=\\s+(${DOW_RX})\\b)`, "i"), "weekly"], [/\b(elke dag|every day|daily|daagliks)\b/i, "daily"], [/\b(elke 2 weke|elke twee weke|every 2 weeks|every two weeks|fortnightly)\b/i, "fortnightly"],
  [/\b(elke week|every week|weekly|weekliks)\b/i, "weekly"], [/\b(elke maand|every month|monthly|maandeliks)\b/i, "monthly"], [/\b(elke jaar|every year|yearly|annually|jaarliks)\b/i, "yearly"]];
async function handle(text: string, by: string | null): Promise<string> {
  const t = text.trim(); const low = t.toLowerCase();
  if (/^\/(help|hulp)/.test(low)) return HELP;
  if (/^\/(vandag|today)/.test(low) || /^\/week/.test(low)) {
    const a = today(), b = /^\/week/.test(low) ? addDays(a, 6) : a; const ev = await eventsBetween(a, b);
    if (!ev.length) return b === a ? "Nothing on the calendar today 🌤️" : "Nothing on the calendar this week 🌤️";
    return `📅 <b>${b === a ? "Today" : "Next 7 days"}</b>\n` + ev.map((e) => `• ${fmtDate(e.date)}${e.end_date && e.end_date !== e.date ? "–" + fmtDate(e.end_date) : ""}${e.start_time ? " " + String(e.start_time).slice(0, 5) : ""} – ${escH(e.title)}`).join("\n");
  }
  if (/^\/(lys|list)/.test(low)) {
    const name = t.replace(/^\/\S+\s*/, "").trim() || "Groceries"; const L = await lists();
    const l = L.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? L.find((x) => x.name.toLowerCase().startsWith(name.toLowerCase()));
    if (!l) return `Lists: ${L.map((x) => escH(x.name)).join(", ")}`;
    const { data } = await db.from("list_items").select("text,qty").eq("list_id", l.id).eq("done", false).order("created_at");
    return data?.length ? `${l.emoji ?? ""} <b>${escH(l.name)}</b>\n${data.map((i) => "• " + escH(i.text) + (i.qty ? ` (${escH(i.qty)})` : "")).join("\n")}` : `${l.emoji ?? ""} ${escH(l.name)} is empty ✨`;
  }
  // "<prefix>: rest" or "<keyword> rest"
  const m = t.match(/^([^:\n]{1,30}):\s*([\s\S]+)$/); const head = m ? m[1].trim().toLowerCase() : low.split(/\s+/)[0]; const body = m ? m[2].trim() : t.slice(low.split(/\s+/)[0].length).trim();
  if (/^(koop|buy|groceries|grocery|kos|winkel|shop|shopping|\+)$/.test(head)) return addItems("Groceries", body, by);
  if (/^(apteek|pharmacy|chemist)$/.test(head)) return addItems("Pharmacy", body, by);
  if (/^(taak|take|chore|chores|todo|to-do|doen)$/.test(head)) {
    const f = findDate(body); if (!f.rest) return "What's the chore?";
    const { error } = await db.from("tasks").insert({ title: f.rest.slice(0, 120), due: f.date ?? null, repeat: "none", done: false, created_by: by }); if (error) throw error;
    return `✅ Chore added: <b>${escH(f.rest)}</b>${f.date ? ` (due ${fmtDate(f.date)})` : ""}`;
  }
  if (/^(date|date idea|date night|idee|datum idee|bucket|bucket list)$/.test(head) && body) {
    const kind = head.startsWith("bucket") ? "bucket" : "date";
    const { error } = await db.from("ideas").insert({ kind, title: body.slice(0, 120), created_by: by }); if (error) throw error;
    return `${kind === "date" ? "💕 Date idea" : "🌍 Bucket list"} added: <b>${escH(body)}</b>`;
  }
  if (/^(resep|recipe|recipes)$/.test(head) && body) {
    const link = body.match(/https?:\/\/\S+/)?.[0] ?? null; const title = body.replace(link ?? "", "").trim() || "New recipe";
    const { error } = await db.from("recipes").insert({ title: title.slice(0, 120), link, status: "idea", category: "Dinner", created_by: by }); if (error) throw error;
    return `🍳 Recipe idea saved: <b>${escH(title)}</b>`;
  }
  if (m) { // any list by name, e.g. "life admin: …", "discussion points: …", "werk: …"
    const alias: Record<string, string> = { admin: "life admin", bespreek: "discussion points", discuss: "discussion points", discussion: "discussion points", werk: "work reminders", work: "work reminders" };
    const L = await lists(); const name = alias[head] ?? head;
    const l = L.find((x) => x.name.toLowerCase() === name) ?? L.find((x) => x.name.toLowerCase().startsWith(name));
    if (l) return addItems(l.name, body, by);
    if (!/^(cal|kal|kalender|calendar|event|afspraak)$/.test(head)) return `I don't know “${escH(m[1])}”. Send /help to see what I understand.`;
  }
  // calendar
  const src = /^(cal|kal|kalender|calendar|event|afspraak)$/.test(head) ? body : t;
  let repeat = "none", src2 = src;
  for (const [rx, r] of REPEAT_RX) if (rx.test(src2)) { repeat = r; src2 = src2.replace(rx, " "); break; }
  const f = findDate(src2);
  if (!f.date) return `I couldn't find a date in that 🤔\nTry: <code>27 Nov ${escH(src.slice(0, 40))}</code>\nor <code>koop ${escH(src.slice(0, 40))}</code> for groceries. /help shows all options.`;
  if (!f.rest) return "What's the event called?";
  const { error } = await db.from("events").insert({ title: f.rest.slice(0, 120), date: f.date, end_date: f.end ?? null, start_time: f.time ?? null, who: "both", repeat, created_by: by });
  if (error) throw error;
  return `📅 Added: <b>${escH(f.rest)}</b>\n${fmtDate(f.date)}${f.end ? " – " + fmtDate(f.end) : ""}${f.time ? " at " + f.time : " (all day)"}${repeat !== "none" ? `\n🔁 Repeats ${repeat === "fortnightly" ? "every 2 weeks" : repeat}` : ""}`;
}

Deno.serve(async (req) => {
  try {
    const c = await cfg(); const token = c.telegram_token;
    if (!token) return new Response("no token", { status: 503 });
    const url = new URL(req.url);
    if (url.searchParams.get("setup")) { // one-time: register this function as the bot's webhook
      if (url.searchParams.get("setup") !== c.cron_secret) return new Response("unauthorised", { status: 401 });
      const hook = `${SUPA_URL}/functions/v1/telegram`;
      const r1 = await tg(token, "setWebhook", { url: hook, secret_token: c.telegram_secret, allowed_updates: ["message"] });
      const r2 = await tg(token, "setMyCommands", { commands: [{ command: "vandag", description: "Today's calendar" }, { command: "week", description: "Next 7 days" }, { command: "lys", description: "Show a list, e.g. /lys groceries" }, { command: "help", description: "What I understand" }] });
      return Response.json({ webhook: r1, commands: r2 });
    }
    if (req.headers.get("x-telegram-bot-api-secret-token") !== c.telegram_secret) return new Response("unauthorised", { status: 401 });
    const upd = await req.json(); const msg = upd.message; if (!msg?.text || !msg.from) return new Response("ok");
    const chat = msg.chat.id, uid = String(msg.from.id);
    const users: Record<string, string | null> = JSON.parse(c.telegram_users || "{}");
    const reply = (text: string) => tg(token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, reply_to_message_id: msg.message_id });
    if (!(uid in users)) { // pairing: "/start CODE"
      const code = msg.text.trim().split(/\s+/)[1] ?? msg.text.trim();
      if (code !== c.telegram_code || Object.keys(users).length >= 2) { await reply("🔒 This is a private bot."); return new Response("ok"); }
      const p = await matchProfile(msg.from.first_name, users);
      users[uid] = p?.user_id ?? null; await setCfg("telegram_users", JSON.stringify(users));
      await reply(`👋 Welcome${p ? ", " + escH(p.name) : ""}! You're linked to Ons Twee.\n\n${HELP}`); return new Response("ok");
    }
    let by = users[uid];
    if (!by) { // linked before their app profile existed – try again by first name
      const p = await matchProfile(msg.from.first_name, users);
      if (p) { by = users[uid] = p.user_id; await setCfg("telegram_users", JSON.stringify(users)); }
    }
    let out: string; try { out = await handle(msg.text, by); } catch (e) { console.error(e); out = "😕 Something went wrong saving that. Please try again or add it in the app."; }
    await reply(out); return new Response("ok");
  } catch (e) { console.error(e); return new Response("error", { status: 200 }); }
});
