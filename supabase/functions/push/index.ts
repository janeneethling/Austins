// Ons Twee – Supabase Edge Function that sends push notifications.
//   { "type": "reminders" }                     every 5 min: events starting within the hour
//   { "type": "digest" }                        07:00 daily: chores, birthdays, trips, today's events
//   { "type": "budget", "transaction_id": ... } after an expense: alert if a category just went over budget
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:us@example.com", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

const CATS: Record<string, string> = {
  groceries: "🛒 Groceries", eating_out: "🍔 Eating out", home: "🏠 Home & rent", utilities: "💡 Utilities", transport: "⛽ Transport",
  health: "💊 Health", shopping: "🛍️ Shopping", entertainment: "🎬 Entertainment", gifts: "🎁 Gifts", travel: "✈️ Travel",
  pets: "🐾 Pets", insurance: "🛡️ Insurance", other: "➕ Other",
};
type Sub = { endpoint: string; user_id: string; subscription: webpush.PushSubscription; prefs: Record<string, boolean> };
const rand = () => Math.random().toString(36).slice(2, 8);
const rands = (n: number) => "R" + Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ");

function sast(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (ds: string, n: number) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function nextOccurrence(p: { month: number; day: number }, from: string) {
  const y = Number(from.slice(0, 4));
  for (const yy of [y, y + 1]) {
    const last = new Date(Date.UTC(yy, p.month, 0)).getUTCDate();
    const ds = `${yy}-${String(p.month).padStart(2, "0")}-${String(Math.min(p.day, last)).padStart(2, "0")}`;
    if (ds >= from) return ds;
  }
  return "9999-12-31";
}

async function subs(kind: string, users?: string[]) {
  const { data } = await db.from("push_subscriptions").select("*");
  return ((data ?? []) as Sub[]).filter((s) => s.prefs?.[kind] !== false && (!users || users.includes(s.user_id)));
}
async function send(targets: Sub[], msg: { title: string; body: string; url?: string; tag?: string }) {
  let sent = 0;
  await Promise.all(targets.map(async (s) => {
    try { await webpush.sendNotification(s.subscription, JSON.stringify(msg), { TTL: 3600, urgency: "high" }); sent++; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  return sent;
}
async function profiles() { const { data } = await db.from("profiles").select("user_id,name"); return data ?? []; }

// ---- 1. Event reminders --------------------------------------------------
async function reminders() {
  const now = new Date(), soon = new Date(now.getTime() + 62 * 60000);
  const { data: events, error } = await db.from("events").update({ reminder_sent: true })
    .eq("reminder_sent", false).gt("start_at", now.toISOString()).lte("start_at", soon.toISOString()).select("*");
  if (error) throw error;
  let n = 0;
  for (const e of events ?? []) {
    const mins = Math.max(1, Math.round((new Date(e.start_at).getTime() - now.getTime()) / 60000));
    const users = e.who && e.who !== "both" ? [e.who] : undefined;
    n += await send(await subs("events", users), {
      title: `📅 ${e.title} ${mins >= 55 ? "in 1 hour" : `in ${mins} min`}`,
      body: [String(e.start_time).slice(0, 5), e.location].filter(Boolean).join(" · "),
      url: `./#/calendar/${e.date}`, tag: `ev-${e.id}`,
    });
  }
  return n;
}

// ---- 2. Morning summary ----------------------------------------------------
async function digest() {
  const today = sast(), tomorrow = addDays(today, 1), inWeek = addDays(today, 7);
  const [{ data: tasks }, { data: people }, { data: trips }, { data: events }, ps] = await Promise.all([
    db.from("tasks").select("*").eq("done", false).lte("due", today),
    db.from("people").select("*"),
    db.from("trips").select("*").eq("start_date", tomorrow),
    db.from("events").select("*").lte("date", today).or(`end_date.gte.${today},and(end_date.is.null,date.eq.${today})`),
    profiles(),
  ]);
  const dates: string[] = [];
  for (const p of people ?? []) {
    const d = nextOccurrence(p, today);
    const what = p.kind === "birthday" ? `🎂 ${p.name}'s birthday` : p.kind === "anniversary" ? `💍 ${p.name}` : `⭐ ${p.name}`;
    if (d === today) dates.push(`${what} is TODAY`);
    else if (d === tomorrow) dates.push(`${what} is tomorrow`);
    else if (d === inWeek) dates.push(`${what} is in a week – gift? 🎁`);
  }
  let n = 0;
  for (const s of await subs("digest")) {
    const mine = (tasks ?? []).filter((t) => !t.assignee || t.assignee === s.user_id);
    const evs = (events ?? []).filter((e) => !e.who || e.who === "both" || e.who === s.user_id);
    const lines: string[] = [];
    if (evs.length) lines.push(`📅 Today: ${evs.map((e) => (e.start_time ? String(e.start_time).slice(0, 5) + " " : "") + e.title).join(", ")}`);
    if (mine.length) lines.push(`✅ ${mine.length} chore${mine.length > 1 ? "s" : ""}: ${mine.slice(0, 3).map((t) => t.title).join(", ")}${mine.length > 3 ? "…" : ""}`);
    lines.push(...dates);
    for (const t of trips ?? []) lines.push(`✈️ ${t.name} starts tomorrow – packed? 🧳`);
    if (!lines.length) continue;                       // nothing to say: no notification
    const name = ps.find((p) => p.user_id === s.user_id)?.name ?? "";
    n += await send([s], { title: `☀️ Goeie môre${name ? ", " + name : ""}!`, body: lines.join("\n"), url: "./#/home", tag: `digest-${today}` });
  }
  return n;
}

// ---- 3. Budget alert --------------------------------------------------------
async function budget(txId: string) {
  const { data: tx } = await db.from("transactions").select("*").eq("id", txId).maybeSingle();
  if (!tx || tx.type !== "expense") return 0;
  const { data: b } = await db.from("budgets").select("*").eq("category", tx.category).maybeSingle();
  if (!b) return 0;
  const month = String(tx.date).slice(0, 7);
  const end = addDays(month + "-28", 4).slice(0, 7) + "-01";
  const { data: rows } = await db.from("transactions").select("amount").eq("type", "expense").eq("category", tx.category).gte("date", month + "-01").lt("date", end);
  const spent = (rows ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const before = spent - Number(tx.amount), limit = Number(b.amount);
  if (!(before <= limit && spent > limit)) return 0;  // only the moment it tips over
  const who = (await profiles()).find((p) => p.user_id === tx.paid_by)?.name;
  return await send(await subs("budget"), {
    title: `💸 ${CATS[tx.category] ?? tx.category} is over budget`,
    body: `${rands(spent)} of ${rands(limit)} this month${who ? ` (last: ${who}, ${rands(Number(tx.amount))})` : ""}`,
    url: "./#/money", tag: `budget-${tx.category}-${month}-${rand()}`,
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("unauthorised", { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const sent = body.type === "digest" ? await digest() : body.type === "budget" ? await budget(body.transaction_id) : await reminders();
    return Response.json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
