import { CONFIG } from './config.js';
import { api, DEMO, TABLES, resetDemo } from './api.js';
import { pushStatus, enablePush, disablePush, currentSub, syncPush, getPrefs, savePrefs, testNotification } from './push.js';

// ================================================================== constants
const EXPENSE_CATS = [
  ['groceries', '🛒', 'Groceries'], ['eating_out', '🍔', 'Eating out'], ['home', '🏠', 'Home & rent'],
  ['utilities', '💡', 'Utilities'], ['transport', '⛽', 'Transport'], ['health', '💊', 'Health'],
  ['shopping', '🛍️', 'Shopping'], ['entertainment', '🎬', 'Entertainment'], ['gifts', '🎁', 'Gifts'],
  ['travel', '✈️', 'Travel'], ['pets', '🐾', 'Pets'], ['insurance', '🛡️', 'Insurance'], ['other', '➕', 'Other'],
];
const INCOME_CATS = [['salary', '💼', 'Salary'], ['side', '💡', 'Side income'], ['refund', '↩️', 'Refund'], ['other_income', '💵', 'Other income']];
const CAT = Object.fromEntries([...EXPENSE_CATS, ...INCOME_CATS].map(([id, emoji, name]) => [id, { id, emoji, name }]));
const COLORS = ['#e4572e', '#f08c00', '#e0a526', '#2f9e44', '#0ca678', '#1c9bd6', '#4263eb', '#7048e8', '#ae3ec9', '#d6336c', '#795548', '#495057'];
const MEASURES = [['weight', 'Weight', 'kg'], ['body_fat', 'Body fat', '%'], ['waist', 'Waist', 'cm'], ['hips', 'Hips', 'cm'], ['chest', 'Chest', 'cm'], ['arm', 'Arm', 'cm'], ['thigh', 'Thigh', 'cm']];
const TZ = CONFIG.TIMEZONE || 'Africa/Johannesburg';

// ================================================================== state
const S = { db: Object.fromEntries(TABLES.map((t) => [t, []])), me: null, email: '', month: null, day: null, calMonth: null, ideaTab: 'date', pending: false };
const $app = document.getElementById('app');

// ================================================================== utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
function nowParts() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hour: Number(p.hour) };
}
const today = () => nowParts().date;
const toUTC = (ds) => new Date(ds + 'T00:00:00Z');
const addDays = (ds, n) => { const d = toUTC(ds); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ds, n) => { const d = toUTC(ds); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const dow = (ds) => (toUTC(ds).getUTCDay() + 6) % 7;
const fmt = (ds, o) => toUTC(ds).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
const fmtShort = (ds) => fmt(ds, { weekday: 'short', day: 'numeric', month: 'short' });
const hm = (t) => (t ? String(t).slice(0, 5) : '');
const moneyFmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: CONFIG.CURRENCY || 'ZAR', maximumFractionDigits: 0 });
const money = (n) => moneyFmt.format(Number(n) || 0);
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const uid = () => Math.random().toString(36).slice(2, 10);

const profile = (id) => S.db.profiles.find((p) => p.user_id === id);
const me = () => profile(S.me);
const partner = () => S.db.profiles.find((p) => p.user_id !== S.me);
const people2 = () => [me(), partner()].filter(Boolean);
function avatar(p, size = 28) {
  if (!p) return '';
  return `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;--c:${esc(p.color)}">${esc(p.name.trim().charAt(0).toUpperCase())}</span>`;
}
const whoChip = (id) => (id && id !== 'both' ? avatar(profile(id), 22) : `<span class="both">${people2().map((p) => avatar(p, 22)).join('')}</span>`);

function toast(msg, ms = 2400) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}
async function guard(fn) { try { return await fn(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); } }

async function save(table, row) { const r = await api.save(table, row); await refresh(table); return r; }
async function remove(table, id) { await api.remove(table, id); await refresh(table); }
async function refresh(table) {
  S.db[table] = await api.load(table);
  const kids = { goals: 'goal_deposits', lists: 'list_items', people: 'gifts', trips: 'trip_items' }[table];
  if (kids) S.db[kids] = await api.load(kids);
  cache(); safeRender();
}
function cache() { try { localStorage.setItem('onstwee-cache', JSON.stringify(S.db)); } catch { /* */ } }
function safeRender() {
  const a = document.activeElement;
  if (document.querySelector('.sheet-bg') || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.dataset.keep !== undefined)) { S.pending = true; return; }
  render();
}

// ================================================================== routing
const route = () => { const [name, id] = (location.hash.replace(/^#\/?/, '') || 'home').split('/'); return { name, id }; };
const go = (h) => { location.hash = h; };
window.addEventListener('hashchange', () => { if (document.querySelector('.sheet-bg')) closeSheet(); render(); window.scrollTo(0, 0); });

// ================================================================== shell
const TABS = [['home', '🏠', 'Home'], ['calendar', '📅', 'Calendar'], ['money', '💰', 'Money'], ['lists', '🛒', 'Lists'], ['health', '❤️', 'Health']];
const VIEWS = {};
function render() {
  S.pending = false;
  if (!S.me) return;
  const r = route();
  const view = VIEWS[r.name] || VIEWS.home;
  const tab = { goals: 'money', list: 'lists', recipes: 'lists', recipe: 'lists', tasks: 'home', ideas: 'home', dates: 'home', person: 'home', trips: 'home', trip: 'home', settings: 'home' }[r.name] || r.name;
  $app.innerHTML = `${DEMO ? '<div class="demo">Demo mode – sample data on this device only.</div>' : ''}
    <main>${view(r.id)}</main>
    <nav class="tabbar">${TABS.map(([id, ic, label]) => `<a href="#/${id}" class="tab ${tab === id ? 'on' : ''}"><span class="ti">${ic}</span><span>${label}</span></a>`).join('')}</nav>`;
}
const header = (title, { back, add, sub } = {}) => `<header class="top">
  ${back ? `<a class="icon" href="${back}" aria-label="Back">‹</a>` : ''}
  <div class="tt"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
  ${add ? `<button class="addbtn" data-act="${add}" aria-label="Add">＋</button>` : ''}
</header>`;
const empty = (emoji, text) => `<div class="empty"><span>${emoji}</span><p>${esc(text)}</p></div>`;

// ================================================================== HOME
VIEWS.home = () => {
  const td = today(); const h = nowParts().hour;
  const greet = h < 12 ? 'Goeie môre' : h < 18 ? 'Goeie middag' : 'Goeienaand';
  const soon = upcomingItems(14).slice(0, 5);
  const month = td.slice(0, 7);
  const spent = sum(S.db.transactions.filter((t) => t.type === 'expense' && t.date.startsWith(month)), (t) => t.amount);
  const budget = sum(S.db.budgets, (b) => b.amount);
  const grocery = S.db.lists.find((l) => l.name === 'Groceries');
  const gCount = grocery ? S.db.list_items.filter((i) => i.list_id === grocery.id && !i.done).length : 0;
  const tiles = [
    ['#/recipes', '🍳', 'Recipes', S.db.recipes.length ? `${S.db.recipes.length} saved` : 'Add one'],
    ['#/ideas', '💡', 'Date nights', `${S.db.ideas.filter((i) => !i.done && i.kind === 'date').length} ideas`],
    ['#/dates', '🎁', 'Dates & gifts', nextPersonLabel()],
    ['#/trips', '✈️', 'Trips', nextTripLabel()],
    ['#/goals', '🎯', 'Savings', `${S.db.goals.length} goals`],
    ['#/settings', '⚙️', 'Settings', esc(me()?.name || '')],
  ];
  return `
  <header class="hello">
    <p class="sub">${esc(fmt(td, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    <h1>${greet}, ${esc(me()?.name || '')} 👋</h1>
  </header>
  <section class="tiles">${tiles.map(([href, ic, name, sub]) => `<a class="tile" href="${href}"><span class="tic">${ic}</span><b>${name}</b><small>${sub}</small></a>`).join('')}</section>

  <section class="card">
    <div class="ch"><h3>📅 Coming up</h3><a class="link" href="#/calendar">Calendar ›</a></div>
    ${soon.length ? `<ul class="rows">${soon.map((x) => `<li><a class="rowa" href="${x.href}"><span class="when"><b>${x.date === td ? 'Today' : x.date === addDays(td, 1) ? 'Tmrw' : esc(fmt(x.date, { day: 'numeric', month: 'short' }))}</b><small>${esc(x.time || fmt(x.date, { weekday: 'short' }))}</small></span><span class="what">${x.icon} ${esc(x.title)}</span>${x.who ? whoChip(x.who) : ''}</a></li>`).join('')}</ul>` : '<p class="muted">Nothing in the next two weeks.</p>'}
  </section>


  <section class="two-cards">
    <a class="card mini" href="#/money"><small>Spent in ${esc(fmt(month + '-01', { month: 'long' }))}</small><b>${money(spent)}</b>
      ${budget ? `${bar(spent, budget)}<small>${spent <= budget ? money(budget - spent) + ' left' : money(spent - budget) + ' over'}</small>` : '<small>Set budgets in Money</small>'}</a>
    <a class="card mini" href="${grocery ? '#/list/' + grocery.id : '#/lists'}"><small>Grocery list</small><b>🛒 ${gCount}</b><small>${gCount === 1 ? 'item' : 'items'} to buy</small></a>
  </section>`;
};
function nextOccurrence(p, from = today()) {
  const y = Number(from.slice(0, 4));
  for (const yy of [y, y + 1]) {
    const last = new Date(Date.UTC(yy, p.month, 0)).getUTCDate();
    const ds = `${yy}-${pad(p.month)}-${pad(Math.min(p.day, last))}`;
    if (ds >= from) return ds;
  }
}
function nextPersonLabel() {
  const n = S.db.people.map((p) => ({ p, d: nextOccurrence(p) })).sort((a, b) => a.d.localeCompare(b.d))[0];
  if (!n) return 'Add birthdays';
  const days = diffDays(today(), n.d);
  return `${esc(n.p.name)} ${days === 0 ? 'today!' : `in ${days}d`}`;
}
function nextTripLabel() {
  const t = S.db.trips.filter((x) => (x.end_date || x.start_date || '9') >= today()).sort((a, b) => (a.start_date || '9').localeCompare(b.start_date || '9'))[0];
  if (!t) return 'Plan one';
  return t.start_date ? (t.start_date > today() ? `${diffDays(today(), t.start_date)} days to go` : 'Happening now') : esc(t.name);
}
// Recurring events: every occurrence of every event that overlaps [from, to]. Editing an event edits the whole series.
const REPEATS = [['none', 'Never'], ['daily', 'Every day'], ['weekly', 'Every week'], ['fortnightly', 'Every 2 weeks'], ['monthly', 'Every month'], ['yearly', 'Every year']];
const REPEAT_LABEL = { daily: 'daily', weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly', yearly: 'yearly' };
function eventInstances(from, to) {
  const out = [];
  S.db.events.forEach((e) => {
    const len = e.end_date && e.end_date > e.date ? diffDays(e.date, e.end_date) : 0;
    const push = (s) => { const last = addDays(s, len); if (s <= to && last >= from) out.push({ e, s, last }); };
    const rep = e.repeat || 'none', until = e.repeat_until || '9999-12-31';
    if (rep === 'none') return push(e.date);
    const step = { daily: 1, weekly: 7, fortnightly: 14 }[rep];
    if (step) {
      let k = Math.max(0, Math.ceil(diffDays(e.date, addDays(from, -len)) / step));
      for (let s = addDays(e.date, k * step); s <= to && s <= until; k++, s = addDays(e.date, k * step)) push(s);
    } else {
      const m = rep === 'yearly' ? 12 : 1;
      for (let k = 0, s = e.date; s <= to && s <= until && k < 2400; k++, s = addMonths(e.date, k * m)) push(s);
    }
  });
  return out;
}
function upcomingItems(days) {
  const td = today(), end = addDays(td, days); const out = [];
  eventInstances(td, end).forEach(({ e, s }) => out.push({ date: s < td ? td : s, time: hm(e.start_time), title: e.title, icon: '📅', who: e.who, href: `#/calendar/${s < td ? td : s}` }));
  S.db.people.forEach((p) => { const d = nextOccurrence(p); if (d <= end) out.push({ date: d, title: personTitle(p, d), icon: p.kind === 'birthday' ? '🎂' : p.kind === 'anniversary' ? '💍' : '⭐', href: `#/person/${p.id}` }); });
  S.db.trips.forEach((t) => { if (t.start_date && t.start_date >= td && t.start_date <= end) out.push({ date: t.start_date, title: t.name, icon: '✈️', href: `#/trip/${t.id}` }); });
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
function personTitle(p, d) {
  const years = p.year ? Number(d.slice(0, 4)) - p.year : null;
  if (p.kind === 'birthday') return `${p.name}'s birthday${years ? ` (${years})` : ''}`;
  if (p.kind === 'anniversary') return `${p.name}${years ? ` – ${years} years` : ''}`;
  return p.name;
}
const bar = (v, max, color) => `<span class="bar"><i style="width:${Math.min(100, max ? (v / max) * 100 : 0)}%;${v > max ? 'background:var(--no)' : color ? `background:${color}` : ''}"></i></span>`;

// ================================================================== CALENDAR
const EVENT_COLORS = [['#2fb36d', 'Green'], ['#f2b632', 'Yellow'], ['#e5484d', 'Red'], ['#3b9eea', 'Blue'], ['#9b6cf0', 'Purple'],
  ['#ef5da8', 'Pink'], ['#f48a2a', 'Orange'], ['#14b8a6', 'Teal'], ['#8a9199', 'Grey']];
const evColor = (e) => e.color || (e.who && e.who !== 'both' ? profile(e.who)?.color : null) || EVENT_COLORS[0][0];
const MAX_LANES = 3;
// Everything that shows as a bar on the month grid: events (can span days), birthdays/anniversaries, trips.
function spansBetween(from, to) {
  const out = [];
  eventInstances(from, to).forEach(({ e, s, last }) => out.push({ s, e: last, title: e.title, color: evColor(e) }));
  S.db.people.forEach((p) => { const d = nextOccurrence(p, from); if (d && d <= to) out.push({ s: d, e: d, title: (p.kind === 'birthday' ? '🎂 ' : p.kind === 'anniversary' ? '💍 ' : '⭐ ') + p.name, color: '#ef5da8' }); });
  S.db.trips.forEach((t) => { if (!t.start_date) return; const last = t.end_date || t.start_date; if (t.start_date <= to && last >= from) out.push({ s: t.start_date, e: last, title: '✈️ ' + t.name, color: '#3b9eea' }); });
  return out;
}
function weekRow(ws, td) {
  const we = addDays(ws, 6);
  const spans = spansBetween(ws, we).map((x) => ({ ...x, c0: x.s < ws ? 0 : diffDays(ws, x.s), c1: x.e > we ? 6 : diffDays(ws, x.e), cont: x.s < ws, more: x.e > we }))
    .sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0));
  const lanes = []; const hidden = Array(7).fill(0);
  spans.forEach((x) => {
    let l = lanes.findIndex((used) => used.every((u) => x.c1 < u[0] || x.c0 > u[1]));
    if (l === -1) { lanes.push([]); l = lanes.length - 1; }
    lanes[l].push([x.c0, x.c1]); x.lane = l;
  });
  spans.forEach((x) => { if (x.lane >= MAX_LANES) for (let c = x.c0; c <= x.c1; c++) hidden[c]++; });
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return `<div class="wkrow">
    <div class="wkdays">${days.map((ds) => `<button class="mday ${ds.slice(0, 7) !== S.calMonth ? 'out' : ''} ${ds === td ? 'today' : ''} ${ds === S.day ? 'sel' : ''} ${dow(ds) === 6 ? 'sun' : ''}" data-act="pick-day" data-day="${ds}"><span class="dn">${Number(ds.slice(8))}</span></button>`).join('')}</div>
    <div class="wkbars">${spans.filter((x) => x.lane < MAX_LANES).map((x) => `<span class="ebar ${x.cont ? 'cont' : ''} ${x.more ? 'more' : ''}" style="grid-column:${x.c0 + 1}/${x.c1 + 2};grid-row:${x.lane + 1};--c:${esc(x.color)}">${esc(x.title)}</span>`).join('')}
      ${hidden.map((n, c) => (n ? `<span class="emore" style="grid-column:${c + 1};grid-row:${MAX_LANES + 1}">+${n}</span>` : '')).join('')}</div>
  </div>`;
}
VIEWS.calendar = (pick) => {
  const td = today();
  if (pick && /^\d{4}-\d\d-\d\d$/.test(pick)) { S.day = pick; S.calMonth = pick.slice(0, 7); }
  S.calMonth ||= td.slice(0, 7); S.day ||= td;
  const first = `${S.calMonth}-01`;
  const last = addDays(addMonths(first, 1), -1);
  let ws = addDays(first, -dow(first)); let weeks = '';
  while (ws <= last) { weeks += weekRow(ws, td); ws = addDays(ws, 7); }
  const list = itemsOn(S.day);
  return `${header(esc(fmt(first, { month: 'long', year: 'numeric' })), { add: 'add-event' })}
    <div class="monthnav"><button class="pill" data-act="cal-prev">‹ Prev</button><button class="pill" data-act="cal-today">Today</button><button class="pill" data-act="cal-next">Next ›</button></div>
    <section class="card cal"><div class="dows">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span>${d}</span>`).join('')}</div>${weeks}</section>
    <div class="ch" id="dayhead"><h2>${esc(fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2><button class="link" data-act="add-event" data-date="${S.day}">＋ Add</button></div>
    ${list.length ? `<div class="list">${list.map((x) => `<${x.edit ? `button data-act="${x.edit}" data-id="${x.id}"` : `a href="${x.href}"`} class="card ev" style="--c:${x.color}">
        <span class="evb"><b>${x.icon} ${esc(x.title)}</b><small>${esc(x.sub)}</small></span>${x.who ? whoChip(x.who) : ''}</${x.edit ? 'button' : 'a'}>`).join('')}</div>` : empty('🌤️', 'Nothing planned.')}`;
};
function itemsOn(ds) {
  const out = [];
  eventInstances(ds, ds).forEach(({ e, s: start, last }) => {
    const multi = last !== start;
    const sub = [multi ? `Day ${diffDays(start, ds) + 1} of ${diffDays(start, last) + 1}` : '', e.start_time && ds === start ? hm(e.start_time) + (e.end_time && !multi ? '–' + hm(e.end_time) : '') : '', e.location,
      e.repeat && e.repeat !== 'none' ? `🔁 ${REPEAT_LABEL[e.repeat]}` : ''].filter(Boolean).join(' · ');
    out.push({ id: e.id, edit: 'edit-event', title: e.title, sub: sub || 'All day', icon: '📅', who: e.who, color: evColor(e), t: hm(e.start_time) || '00:00' });
  });
  S.db.people.forEach((p) => { if (nextOccurrence(p, ds) === ds) out.push({ href: `#/person/${p.id}`, title: personTitle(p, ds), sub: p.kind === 'birthday' ? 'Birthday' : p.kind === 'anniversary' ? 'Anniversary' : 'Important date', icon: p.kind === 'birthday' ? '🎂' : p.kind === 'anniversary' ? '💍' : '⭐', color: '#ef5da8', t: '00:00' }); });
  S.db.trips.forEach((t) => { if (t.start_date && t.start_date <= ds && ds <= (t.end_date || t.start_date)) out.push({ href: `#/trip/${t.id}`, title: t.name, sub: t.destination || 'Trip', icon: '✈️', color: '#3b9eea', t: '00:01' }); });
  return out.sort((a, b) => a.t.localeCompare(b.t));
}
const eventForm = (row = {}) => openForm({
  title: row.id ? 'Edit event' : 'New event', table: 'events', row: row.id && !row.color ? { ...row, color: evColor(row) } : row,
  fields: [
    { k: 'title', label: 'What?', req: true, ph: 'e.g. Dinner with the Smiths' },
    { k: 'date', label: 'Date', type: 'date', req: true, half: true }, { k: 'end_date', label: 'End date (optional)', type: 'date', half: true },
    { k: 'start_time', label: 'Start', type: 'time', half: true }, { k: 'end_time', label: 'End', type: 'time', half: true },
    { k: 'location', label: 'Where?', ph: '📍' },
    { k: 'repeat', label: 'Repeat', type: 'select', half: true, options: REPEATS }, { k: 'repeat_until', label: 'Until (optional)', type: 'date', half: true },
    { k: 'color', label: 'Colour', type: 'color', options: EVENT_COLORS },
    { k: 'who', label: 'Who', type: 'seg', options: [['both', 'Both of us'], ...people2().map((p) => [p.user_id, p.name])] },
    { k: 'notes', label: 'Notes', type: 'textarea' },
  ],
  defaults: { date: S.day || today(), who: 'both', color: EVENT_COLORS[0][0], repeat: 'none' },
  validate: (v) => (v.end_date && v.end_date < v.date ? 'End date is before the start date.' : v.repeat_until && v.repeat_until < v.date ? '“Until” is before the start date.' : null),
});

// ================================================================== MONEY
VIEWS.money = () => {
  S.month ||= today().slice(0, 7);
  const tx = S.db.transactions.filter((t) => t.date.startsWith(S.month)).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
  const income = sum(tx.filter((t) => t.type === 'income'), (t) => t.amount);
  const exp = tx.filter((t) => t.type === 'expense');
  const spent = sum(exp, (t) => t.amount);
  const byCat = {}; exp.forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount)));
  const budgets = Object.fromEntries(S.db.budgets.map((b) => [b.category, Number(b.amount)]));
  const cats = EXPENSE_CATS.map(([id]) => id).filter((id) => budgets[id] || byCat[id]);
  const totalBudget = sum(Object.values(budgets));
  const groups = {}; tx.forEach((t) => (groups[t.date] ||= []).push(t));
  const goalsSaved = sum(S.db.goal_deposits, (d) => d.amount), goalsTarget = sum(S.db.goals, (g) => g.target);
  return `${header('Money', { add: 'add-tx' })}
    <div class="monthnav"><button class="pill" data-act="m-prev">‹</button><b>${esc(fmt(S.month + '-01', { month: 'long', year: 'numeric' }))}</b><button class="pill" data-act="m-next">›</button></div>
    <section class="stats3">
      <div class="card stat"><small>Income</small><b class="pos">${money(income)}</b></div>
      <div class="card stat"><small>Spent</small><b>${money(spent)}</b></div>
      <div class="card stat"><small>Left</small><b class="${income - spent < 0 ? 'neg' : 'pos'}">${money(income - spent)}</b></div>
    </section>
    <section class="card">
      <div class="ch"><h3>📊 Budget</h3><button class="link" data-act="edit-budgets">Edit budgets</button></div>
      ${cats.length ? `${totalBudget ? `<div class="brow total"><span>Total</span><span>${money(spent)} / ${money(totalBudget)}</span></div>${bar(spent, totalBudget)}` : ''}
        <ul class="budget">${cats.map((c) => `<li><div class="brow"><span>${CAT[c].emoji} ${CAT[c].name}</span><span>${money(byCat[c] || 0)}${budgets[c] ? ` <small>/ ${money(budgets[c])}</small>` : ''}</span></div>${budgets[c] ? bar(byCat[c] || 0, budgets[c]) : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Tap “Edit budgets” to set a monthly amount per category.</p>'}
      ${people2().length > 1 && spent ? `<p class="paidby">${people2().map((p) => `${avatar(p, 20)} paid <b>${money(sum(exp.filter((t) => t.paid_by === p.user_id), (t) => t.amount))}</b>`).join(' &nbsp; ')}</p>` : ''}
    </section>
    <a class="card goalslink" href="#/goals"><span class="tic">🎯</span><span><b>Savings goals</b><small>${money(goalsSaved)} saved of ${money(goalsTarget)}</small></span><span class="chev">›</span></a>
    <h3 class="sec">Transactions</h3>
    ${tx.length ? Object.entries(groups).map(([d, list]) => `<div class="txday"><small>${esc(fmtShort(d))}</small>${list.map((t) => `
      <button class="card tx" data-act="edit-tx" data-id="${t.id}"><span class="tic">${CAT[t.category]?.emoji || '➕'}</span>
        <span class="txb"><b>${esc(t.note || CAT[t.category]?.name || 'Other')}</b><small>${esc(CAT[t.category]?.name || '')}${profile(t.paid_by) ? ' · ' + esc(profile(t.paid_by).name) : ''}</small></span>
        <b class="${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</b></button>`).join('')}</div>`).join('')
      : empty('🪙', 'No transactions this month yet. Tap ＋ to add one.')}`;
};
const txForm = (row = {}) => openForm({
  title: row.id ? 'Edit transaction' : 'Add money in/out', table: 'transactions', row,
  fields: [
    { k: 'type', label: '', type: 'seg', options: [['expense', '💸 Spent'], ['income', '💰 Received']], rerender: true },
    { k: 'amount', label: 'Amount (R)', type: 'money', req: true, autofocus: true },
    { k: 'category', label: 'Category', type: 'cats' },
    { k: 'note', label: 'Note', ph: 'e.g. Woolies' },
    { k: 'date', label: 'Date', type: 'date', req: true, half: true },
    { k: 'paid_by', label: 'Who', type: 'select', half: true, options: people2().map((p) => [p.user_id, p.name]) },
  ],
  defaults: { type: 'expense', category: 'groceries', date: today(), paid_by: S.me },
});
function budgetForm() {
  const cur = Object.fromEntries(S.db.budgets.map((b) => [b.category, b]));
  openSheet(`<h2>Monthly budgets</h2><p class="muted">Leave empty for no budget.</p>
    <form data-form="budgets" class="form">${EXPENSE_CATS.map(([id, e, n]) => `<label class="brow inp"><span>${e} ${n}</span><input inputmode="decimal" name="${id}" value="${cur[id] ? Number(cur[id].amount) : ''}" placeholder="R"></label>`).join('')}
    <button class="btn pri wide">Save budgets</button></form>`);
}

// ---------- goals
VIEWS.goals = () => `${header('Savings goals', { back: '#/money', add: 'add-goal' })}
  ${S.db.goals.length ? S.db.goals.map((g) => {
    const saved = sum(S.db.goal_deposits.filter((d) => d.goal_id === g.id), (d) => d.amount);
    const left = Math.max(0, g.target - saved);
    const months = g.target_date ? Math.max(1, Math.ceil(diffDays(today(), g.target_date) / 30.4)) : null;
    return `<section class="card goal">
      <div class="ch"><h3>${esc(g.emoji || '🎯')} ${esc(g.name)}</h3><button class="link" data-act="edit-goal" data-id="${g.id}">Edit</button></div>
      <div class="brow"><b>${money(saved)}</b><span class="muted">of ${money(g.target)}</span></div>
      ${bar(saved, g.target, 'var(--green)')}
      <p class="muted">${left ? `${money(left)} to go${months && g.target_date > today() ? ` · ${money(left / months)}/month until ${esc(fmt(g.target_date, { month: 'short', year: 'numeric' }))}` : ''}` : '🎉 Goal reached!'}</p>
      <button class="btn ghost wide" data-act="add-deposit" data-id="${g.id}">＋ Add money</button>
    </section>`;
  }).join('') : empty('🎯', 'No goals yet. Tap ＋ to start saving for something.')}`;
const goalForm = (row = {}) => openForm({
  title: row.id ? 'Edit goal' : 'New savings goal', table: 'goals', row,
  fields: [{ k: 'emoji', label: 'Emoji', type: 'emoji', options: ['🎯', '🌴', '🏡', '🚗', '💍', '🛟', '👶', '🎓', '✈️', '🐶'] }, { k: 'name', label: 'Saving for', req: true, ph: 'e.g. Bali trip' },
    { k: 'target', label: 'Target (R)', type: 'money', req: true, half: true }, { k: 'target_date', label: 'By when (optional)', type: 'date', half: true }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  defaults: { emoji: '🎯' },
});
const depositForm = (goalId) => openForm({
  title: 'Add to savings', table: 'goal_deposits', row: {},
  fields: [{ k: 'amount', label: 'Amount (R) – use minus to take out', type: 'money', req: true, autofocus: true, allowNeg: true }, { k: 'date', label: 'Date', type: 'date', half: true }, { k: 'user_id', label: 'Who', type: 'select', half: true, options: people2().map((p) => [p.user_id, p.name]) }],
  defaults: { goal_id: goalId, date: today(), user_id: S.me },
});

// ================================================================== LISTS
VIEWS.lists = () => {
  const lists = [...S.db.lists].sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.name.localeCompare(b.name));
  const rc = S.db.recipes.length, fav = S.db.recipes.filter((r) => r.status === 'favourite').length;
  return `${header('Lists', { add: 'add-list' })}
    <a class="card lrow recipes-link" href="#/recipes"><span class="tic big">🍳</span><span class="txb"><b>Recipes</b><small>${rc ? `${rc} saved${fav ? ` · ❤️ ${fav}` : ''}` : 'Save recipes and ideas'}</small></span><span class="chev">›</span></a>
    <div class="list">${lists.map((l) => {
      const items = S.db.list_items.filter((i) => i.list_id === l.id); const open = items.filter((i) => !i.done).length;
      return `<a class="card lrow" href="#/list/${l.id}"><span class="tic big">${esc(l.emoji || '📝')}</span><span class="txb"><b>${esc(l.name)}</b><small>${open ? `${open} to get` : items.length ? 'All done ✓' : 'Empty'}</small></span><span class="chev">›</span></a>`;
    }).join('')}</div>`;
};
VIEWS.list = (id) => {
  const l = S.db.lists.find((x) => x.id === id);
  if (!l) return header('List', { back: '#/lists' }) + empty('🤷', 'List not found.');
  const items = S.db.list_items.filter((i) => i.list_id === id);
  const open = items.filter((i) => !i.done).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const done = items.filter((i) => i.done);
  const row = (i) => `<li class="${i.done ? 'done' : ''}"><button class="check" data-act="toggle-item" data-id="${i.id}" aria-label="tick">${i.done ? '✓' : ''}</button>
    <span class="itx">${esc(i.text)}${i.qty ? ` <small>${esc(i.qty)}</small>` : ''}</span><button class="x" data-act="del-item" data-id="${i.id}" aria-label="delete">✕</button></li>`;
  return `${header(`${esc(l.emoji || '')} ${esc(l.name)}`, { back: '#/lists' })}
    <form class="additem card" data-form="item" data-list="${id}">
      <input name="text" placeholder="Add an item…" autocomplete="off" data-keep enterkeyhint="done" maxlength="80">
      <input name="qty" placeholder="Qty" autocomplete="off" data-keep class="qty" maxlength="12">
      <button class="btn pri">Add</button>
    </form>
    ${open.length ? `<ul class="card items">${open.map(row).join('')}</ul>` : empty('✨', done.length ? 'Everything is ticked off!' : 'Nothing on the list yet.')}
    ${done.length ? `<div class="ch"><h3 class="muted">Got it (${done.length})</h3><button class="link" data-act="clear-done" data-id="${id}">Clear ticked</button></div><ul class="card items">${done.map(row).join('')}</ul>` : ''}
    <div class="btnrow"><button class="btn ghost" data-act="edit-list" data-id="${id}">Rename list</button></div>`;
};
const listForm = (row = {}) => openForm({
  title: row.id ? 'Edit list' : 'New list', table: 'lists', row,
  fields: [{ k: 'emoji', label: 'Emoji', type: 'emoji', options: ['📝', '🛒', '💊', '🏠', '🐶', '🎁', '🧹', '🌱', '👶', '🍷'] }, { k: 'name', label: 'Name', req: true, ph: 'e.g. Hardware store' }],
  defaults: { emoji: '📝' }, after: (r) => !row.id && go(`#/list/${r.id}`),
});

// ================================================================== RECIPES
const RECIPE_STATUS = [['idea', '💡 Idea'], ['tried', '✅ Tried'], ['favourite', '❤️ Favourite']];
const RECIPE_CATS = ['Breakfast', 'Lunch', 'Dinner', 'Braai', 'Sides & salads', 'Dessert', 'Baking', 'Snacks', 'Drinks', 'Other'];
VIEWS.recipes = () => {
  const f = S.recipeTab || 'all';
  const list = S.db.recipes.filter((r) => f === 'all' || r.status === f)
    .sort((a, b) => (a.status === 'favourite' ? 0 : 1) - (b.status === 'favourite' ? 0 : 1) || a.title.localeCompare(b.title));
  const groups = {}; list.forEach((r) => (groups[r.category || 'Other'] ||= []).push(r));
  const order = [...RECIPE_CATS, ...Object.keys(groups).filter((c) => !RECIPE_CATS.includes(c))].filter((c) => groups[c]);
  return `${header('Recipes', { back: '#/lists', add: 'add-recipe' })}
    <div class="segc wide">${[['all', 'All'], ...RECIPE_STATUS].map(([k, n]) => `<button class="${f === k ? 'on' : ''}" data-act="recipe-tab" data-id="${k}">${n}</button>`).join('')}</div>
    ${list.length ? order.map((c) => `<h3 class="sec">${esc(c)}</h3><div class="list">${groups[c].map((r) => `<a class="card lrow" href="#/recipe/${r.id}"><span class="tic big">${esc(r.emoji || '🍽️')}</span>
      <span class="txb"><b>${esc(r.title)}${r.status === 'favourite' ? ' ❤️' : ''}</b><small>${[r.status === 'idea' ? '💡 Idea' : r.status === 'tried' ? '✅ Tried' : '', r.time, r.servings ? `serves ${r.servings}` : '', r.link ? '🔗' : ''].filter(Boolean).map(esc).join(' · ')}</small></span><span class="chev">›</span></a>`).join('')}</div>`).join('')
      : empty('🍳', f === 'all' ? 'Save a recipe or jot down an idea with ＋' : 'Nothing here yet.')}`;
};
const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
VIEWS.recipe = (id) => {
  const r = S.db.recipes.find((x) => x.id === id);
  if (!r) return header('Not found', { back: '#/recipes' }) + empty('🤷', 'Recipe not found.');
  const ing = lines(r.ingredients), steps = lines(r.method);
  const host = (() => { try { return new URL(r.link).hostname.replace(/^www\./, ''); } catch { return r.link; } })();
  return `${header(`${esc(r.emoji || '🍽️')} ${esc(r.title)}`, { back: '#/recipes' })}
    <section class="card"><div class="segc wide">${RECIPE_STATUS.map(([k, n]) => `<button class="${r.status === k ? 'on' : ''}" data-act="recipe-status" data-id="${r.id}" data-v="${k}">${n}</button>`).join('')}</div>
      <p class="muted">${[r.category, r.time ? `⏱️ ${r.time}` : '', r.servings ? `🍽️ Serves ${r.servings}` : ''].filter(Boolean).map(esc).join(' · ')}</p>
      ${r.link ? `<a class="btn ghost wide" href="${esc(/^https?:\/\//i.test(r.link) ? r.link : 'https://' + r.link)}" target="_blank" rel="noopener">🔗 Open recipe · ${esc(host)}</a>` : ''}
      <button class="link" data-act="edit-recipe" data-id="${r.id}">Edit</button></section>
    ${ing.length ? `<div class="ch"><h3>🧺 Ingredients</h3><button class="link" data-act="recipe-to-groceries" data-id="${r.id}">＋ Add to Groceries</button></div>
      <ul class="card rows ing">${ing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${steps.length ? `<h3 class="sec">👩‍🍳 Method</h3><ol class="card steps">${steps.map((x) => `<li>${esc(x.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol>` : ''}
    ${r.notes ? `<h3 class="sec">📝 Notes</h3><section class="card"><p class="notes">${esc(r.notes)}</p></section>` : ''}
    ${!ing.length && !steps.length && !r.link ? empty('✍️', 'Tap Edit to add the ingredients, method or a link.') : ''}`;
};
const recipeForm = (row = {}) => openForm({
  title: row.id ? 'Edit recipe' : 'New recipe or idea', table: 'recipes', row,
  fields: [{ k: 'emoji', label: 'Emoji', type: 'emoji', options: ['🍽️', '🍝', '🥩', '🍗', '🐟', '🥗', '🍲', '🍕', '🌮', '🍰', '🍪', '🥞', '🍹'] },
    { k: 'title', label: 'Name', req: true, ph: 'e.g. Ouma se melktert' },
    { k: 'status', label: '', type: 'seg', options: RECIPE_STATUS },
    { k: 'category', label: 'Type', type: 'select', half: true, options: RECIPE_CATS.map((c) => [c, c]) },
    { k: 'time', label: 'Time', half: true, ph: 'e.g. 45 min' },
    { k: 'servings', label: 'Serves', half: true, ph: 'e.g. 4' },
    { k: 'link', label: 'Link', half: true, ph: 'https://…' },
    { k: 'ingredients', label: 'Ingredients (one per line)', type: 'textarea', rows: 6, ph: '500 g mince\n1 onion\n2 cloves garlic' },
    { k: 'method', label: 'Method (one step per line)', type: 'textarea', rows: 6 },
    { k: 'notes', label: 'Notes', type: 'textarea' }],
  defaults: { emoji: '🍽️', status: 'idea', category: 'Dinner' },
  after: (r) => !row.id && go(`#/recipe/${r.id}`),
});

// ================================================================== HEALTH
VIEWS.health = () => {
  const ps = people2();
  const logsOf = (id) => S.db.body_logs.filter((l) => l.user_id === id).sort((a, b) => a.date.localeCompare(b.date));
  const cards = ps.map((p) => {
    const L = logsOf(p.user_id).filter((l) => l.weight != null);
    const cur = L.at(-1), start = L[0];
    const ch = cur && start ? cur.weight - start.weight : null;
    const toGoal = cur && p.goal_weight ? cur.weight - p.goal_weight : null;
    const bmi = cur && p.height_cm ? cur.weight / (p.height_cm / 100) ** 2 : null;
    return `<div class="card person" style="--c:${esc(p.color)}">
      <div class="ph">${avatar(p, 30)}<b>${esc(p.name)}</b></div>
      <div class="big">${cur ? `${cur.weight}<small> kg</small>` : '–'}</div>
      <small class="muted">${cur ? esc(fmt(cur.date, { day: 'numeric', month: 'short' })) : 'No entries yet'}</small>
      ${ch != null ? `<span class="delta ${ch <= 0 ? 'good' : ''}">${ch > 0 ? '+' : ''}${ch.toFixed(1)} kg since start</span>` : ''}
      ${toGoal != null ? `<small>${toGoal > 0 ? `${toGoal.toFixed(1)} kg to goal (${p.goal_weight})` : '🎉 Goal reached'}</small>` : ''}
      ${bmi ? `<small class="muted">BMI ${bmi.toFixed(1)}</small>` : ''}
    </div>`;
  }).join('');
  const series = ps.map((p) => ({ color: p.color, name: p.name, goal: p.goal_weight, pts: logsOf(p.user_id).filter((l) => l.weight != null).map((l) => [l.date, Number(l.weight)]) })).filter((s) => s.pts.length);
  const mrows = MEASURES.slice(1).filter(([k]) => S.db.body_logs.some((l) => l[k] != null));
  const firstLast = (id, k) => { const L = logsOf(id).filter((l) => l[k] != null); return L.length ? [L[0][k], L.at(-1)[k]] : null; };
  const history = [...S.db.body_logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  return `${header('Health', { add: 'add-log' })}
    <section class="people2">${cards}</section>
    <section class="card"><h3>⚖️ Weight</h3>${series.length ? lineChart(series) : '<p class="muted">Log your weight to see a chart.</p>'}
      <div class="legend">${series.map((s) => `<span><i style="background:${esc(s.color)}"></i>${esc(s.name)}</span>`).join('')}</div></section>
    ${mrows.length ? `<section class="card"><h3>📏 Measurements</h3><table class="mt"><thead><tr><th></th>${ps.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
      ${mrows.map(([k, name, unit]) => `<tr><td>${name}</td>${ps.map((p) => { const fl = firstLast(p.user_id, k); if (!fl) return '<td class="muted">–</td>'; const d = fl[1] - fl[0];
        return `<td><b>${fl[1]}</b><small>${unit}</small>${d ? ` <span class="delta ${d < 0 ? 'good' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>` : ''}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table><p class="muted small">Latest value, and change since the first entry.</p></section>` : ''}
    <h3 class="sec">History</h3>
    ${history.length ? `<div class="list">${history.map((l) => { const p = profile(l.user_id); const mine = l.user_id === S.me;
      return `<${mine ? `button data-act="edit-log" data-id="${l.id}"` : 'div'} class="card tx">${avatar(p, 28)}<span class="txb"><b>${l.weight != null ? l.weight + ' kg' : 'Measurements'}</b>
        <small>${esc(fmtShort(l.date))}${MEASURES.slice(1).filter(([k]) => l[k] != null).map(([k, n, u]) => ` · ${n.toLowerCase()} ${l[k]}${u}`).join('')}</small></span>${mine ? '<span class="chev">›</span>' : ''}</${mine ? 'button' : 'div'}>`; }).join('')}</div>`
      : empty('🌱', 'Tap ＋ to log your first weigh-in.')}`;
};
function lineChart(series) {
  const W = 340, H = 180, P = { l: 34, r: 10, t: 12, b: 24 };
  const all = series.flatMap((s) => s.pts); const goals = series.map((s) => s.goal).filter(Boolean);
  const xs = all.map(([d]) => toUTC(d).getTime()); const ys = [...all.map(([, v]) => v), ...goals];
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 864e5 * 3; x1 += 864e5 * 3; }
  let y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  const X = (d) => P.l + ((toUTC(d).getTime() - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const ticks = [y0, Math.round((y0 + y1) / 2), y1];
  const dates = [new Date(x0).toISOString().slice(0, 10), new Date(x1).toISOString().slice(0, 10)];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Weight chart">
    ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${dates.map((d, i) => `<text x="${i ? W - P.r : P.l}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${esc(fmt(d, { day: 'numeric', month: 'short' }))}</text>`).join('')}
    ${series.map((s) => `${s.goal ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(s.goal)}" y2="${Y(s.goal)}" stroke="${esc(s.color)}" stroke-dasharray="4 4" opacity=".55"/>` : ''}
      <polyline fill="none" stroke="${esc(s.color)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${s.pts.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>
      ${s.pts.map(([d, v], i) => (i === s.pts.length - 1 ? `<circle cx="${X(d)}" cy="${Y(v)}" r="4" fill="${esc(s.color)}"/>` : '')).join('')}`).join('')}
  </svg>`;
}
const logForm = (row = {}) => openForm({
  title: row.id ? 'Edit entry' : 'Log weight & measurements', table: 'body_logs', row,
  fields: [{ k: 'date', label: 'Date', type: 'date', req: true },
    ...MEASURES.map(([k, n, u]) => ({ k, label: `${n} (${u})`, type: 'decimal', half: true, autofocus: k === 'weight' })),
    { k: 'notes', label: 'Notes', type: 'textarea' }],
  defaults: { date: today(), user_id: S.me },
  validate: (v) => (MEASURES.every(([k]) => v[k] == null) ? 'Enter at least one number.' : null),
});

// ================================================================== TASKS
VIEWS.tasks = () => {
  const td = today();
  const open = S.db.tasks.filter((t) => !t.done);
  const groups = [
    ['⏰ Overdue', open.filter((t) => t.due && t.due < td)],
    ['📌 Today', open.filter((t) => t.due === td)],
    ['🗓️ Coming up', open.filter((t) => t.due && t.due > td)],
    ['📝 Anytime', open.filter((t) => !t.due)],
  ];
  const done = S.db.tasks.filter((t) => t.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, 10);
  return `${header('Chores & to-dos', { back: '#/home', add: 'add-task' })}
    ${open.length ? groups.filter(([, l]) => l.length).map(([name, l]) => `<h3 class="sec">${name}</h3><ul class="card rows">${l.sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(taskRow).join('')}</ul>`).join('') : empty('🎉', 'Nothing to do. Enjoy!')}
    ${done.length ? `<h3 class="sec muted">Recently done</h3><ul class="card rows">${done.map(taskRow).join('')}</ul>` : ''}`;
};
function taskRow(t) {
  const td = today();
  const due = t.due ? (t.due === td ? 'Today' : t.due === addDays(td, 1) ? 'Tomorrow' : t.due < td ? `${diffDays(t.due, td)}d overdue` : fmtShort(t.due)) : '';
  return `<li class="task ${t.done ? 'done' : ''}"><button class="check" data-act="toggle-task" data-id="${t.id}" aria-label="done">${t.done ? '✓' : ''}</button>
    <button class="tb" data-act="edit-task" data-id="${t.id}"><b>${esc(t.title)}</b><small class="${t.due && t.due < td && !t.done ? 'neg' : ''}">${esc(due)}${t.repeat !== 'none' ? ` · 🔁 ${t.repeat}` : ''}</small></button>
    ${t.assignee ? avatar(profile(t.assignee), 24) : ''}</li>`;
}
const taskForm = (row = {}) => openForm({
  title: row.id ? 'Edit to-do' : 'New chore / to-do', table: 'tasks', row,
  fields: [{ k: 'title', label: 'What needs doing?', req: true, ph: 'e.g. Take out the bins' },
    { k: 'due', label: 'Due', type: 'date', half: true }, { k: 'repeat', label: 'Repeat', type: 'select', half: true, options: [['none', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] },
    { k: 'assignee', label: 'Who', type: 'seg', options: [['', 'Either'], ...people2().map((p) => [p.user_id, p.name])] },
    { k: 'notes', label: 'Notes', type: 'textarea' }],
  defaults: { repeat: 'none', assignee: '' },
});

// ================================================================== IDEAS
VIEWS.ideas = () => {
  const k = S.ideaTab;
  const list = S.db.ideas.filter((i) => i.kind === k);
  const open = list.filter((i) => !i.done), done = list.filter((i) => i.done).sort((a, b) => (b.done_on || '').localeCompare(a.done_on || ''));
  const row = (i) => `<li class="task ${i.done ? 'done' : ''}"><button class="check" data-act="toggle-idea" data-id="${i.id}">${i.done ? '✓' : ''}</button>
    <button class="tb" data-act="edit-idea" data-id="${i.id}"><b>${esc(i.title)}</b><small>${[i.cost, i.done_on ? 'Done ' + fmt(i.done_on, { day: 'numeric', month: 'short', year: 'numeric' }) : '', i.notes].filter(Boolean).map(esc).join(' · ')}</small></button></li>`;
  return `${header('Date nights & dreams', { back: '#/home', add: 'add-idea' })}
    <div class="segc wide"><button class="${k === 'date' ? 'on' : ''}" data-act="idea-tab" data-id="date">💕 Date nights</button><button class="${k === 'bucket' ? 'on' : ''}" data-act="idea-tab" data-id="bucket">🌍 Bucket list</button></div>
    ${k === 'date' && open.length ? `<button class="btn surprise wide" data-act="surprise">🎲 Surprise us!</button>` : ''}
    ${open.length ? `<ul class="card rows">${open.map(row).join('')}</ul>` : empty(k === 'date' ? '💕' : '🌍', 'Add your first idea with ＋')}
    ${done.length ? `<h3 class="sec muted">Done together (${done.length})</h3><ul class="card rows">${done.map(row).join('')}</ul>` : ''}`;
};
const ideaForm = (row = {}) => openForm({
  title: row.id ? 'Edit idea' : 'New idea', table: 'ideas', row,
  fields: [{ k: 'kind', label: '', type: 'seg', options: [['date', '💕 Date night'], ['bucket', '🌍 Bucket list']] },
    { k: 'title', label: 'Idea', req: true, ph: 'e.g. Picnic at Kirstenbosch' },
    { k: 'cost', label: 'Cost', type: 'seg', options: [['', '–'], ['Free', 'Free'], ['R', 'R'], ['RR', 'RR'], ['RRR', 'RRR']] },
    { k: 'notes', label: 'Notes', type: 'textarea' }],
  defaults: { kind: S.ideaTab, cost: '' },
});

// ================================================================== DATES & GIFTS
VIEWS.dates = () => {
  const list = S.db.people.map((p) => ({ p, d: nextOccurrence(p) })).sort((a, b) => a.d.localeCompare(b.d));
  return `${header('Dates & gifts', { back: '#/home', add: 'add-person' })}
    ${list.length ? `<div class="list">${list.map(({ p, d }) => { const days = diffDays(today(), d); const gifts = S.db.gifts.filter((g) => g.person_id === p.id);
      return `<a class="card lrow" href="#/person/${p.id}"><span class="tic big">${p.kind === 'birthday' ? '🎂' : p.kind === 'anniversary' ? '💍' : '⭐'}</span>
        <span class="txb"><b>${esc(personTitle(p, d))}</b><small>${esc(fmt(d, { day: 'numeric', month: 'long' }))} · ${days === 0 ? '<b>Today!</b>' : days === 1 ? 'Tomorrow' : `in ${days} days`}${gifts.length ? ` · 🎁 ${gifts.length}` : ''}</small></span><span class="chev">›</span></a>`; }).join('')}</div>`
      : empty('🎂', 'Add birthdays and anniversaries so you never forget.')}`;
};
VIEWS.person = (id) => {
  const p = S.db.people.find((x) => x.id === id);
  if (!p) return header('Not found', { back: '#/dates' });
  const d = nextOccurrence(p); const gifts = S.db.gifts.filter((g) => g.person_id === id);
  const st = { idea: '💡 Idea', bought: '🛍️ Bought', given: '🎁 Given' };
  return `${header(esc(p.name), { back: '#/dates' })}
    <section class="card"><p class="big2">${p.kind === 'birthday' ? '🎂' : p.kind === 'anniversary' ? '💍' : '⭐'} ${esc(personTitle(p, d))}</p>
      <p class="muted">${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · in ${diffDays(today(), d)} days</p>
      ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}<button class="link" data-act="edit-person" data-id="${id}">Edit</button></section>
    <div class="ch"><h3>🎁 Gift ideas</h3><button class="link" data-act="add-gift" data-id="${id}">＋ Add</button></div>
    ${gifts.length ? `<ul class="card rows">${gifts.map((g) => `<li class="task"><button class="tb" data-act="edit-gift" data-id="${g.id}"><b>${esc(g.idea)}</b><small>${g.price ? money(g.price) : ''}${g.link ? ' · link' : ''}</small></button>
      <button class="pill st-${g.status}" data-act="cycle-gift" data-id="${g.id}">${st[g.status]}</button></li>`).join('')}</ul>` : empty('💡', 'Jot down gift ideas whenever you think of them.')}`;
};
const personForm = (row = {}) => openForm({
  title: row.id ? 'Edit date' : 'New important date', table: 'people', row,
  fields: [{ k: 'kind', label: '', type: 'seg', options: [['birthday', '🎂 Birthday'], ['anniversary', '💍 Anniversary'], ['other', '⭐ Other']] },
    { k: 'name', label: 'Name', req: true, ph: 'e.g. Ma, or “Our wedding”' },
    { k: 'day', label: 'Day', type: 'number', req: true, third: true, min: 1, max: 31 },
    { k: 'month', label: 'Month', type: 'select', req: true, third: true, options: Array.from({ length: 12 }, (_, i) => [i + 1, fmt(`2024-${pad(i + 1)}-01`, { month: 'short' })]) },
    { k: 'year', label: 'Year (opt.)', type: 'number', third: true, min: 1900, max: 2100 },
    { k: 'notes', label: 'Notes', type: 'textarea', ph: 'Likes, sizes, favourite things…' }],
  defaults: { kind: 'birthday', month: 1 },
  after: (r) => !row.id && go(`#/person/${r.id}`),
});
const giftForm = (row = {}, personId) => openForm({
  title: row.id ? 'Edit gift' : 'Gift idea', table: 'gifts', row,
  fields: [{ k: 'idea', label: 'Idea', req: true, ph: 'e.g. Spa voucher' }, { k: 'price', label: 'Price (R)', type: 'money', half: true },
    { k: 'status', label: 'Status', type: 'select', half: true, options: [['idea', 'Idea'], ['bought', 'Bought'], ['given', 'Given']] }, { k: 'link', label: 'Link', ph: 'https://…' }],
  defaults: { person_id: personId, status: 'idea' },
});

// ================================================================== TRIPS
VIEWS.trips = () => {
  const list = [...S.db.trips].sort((a, b) => (a.start_date || '9').localeCompare(b.start_date || '9'));
  const td = today();
  return `${header('Trips', { back: '#/home', add: 'add-trip' })}
    ${list.length ? `<div class="list">${list.map((t) => { const spent = sum(S.db.trip_items.filter((i) => i.trip_id === t.id && i.kind === 'cost'), (i) => i.amount);
      const when = t.start_date ? (t.start_date > td ? `${diffDays(td, t.start_date)} days to go` : (t.end_date || t.start_date) >= td ? 'Happening now 🎉' : 'Done') : 'No dates yet';
      return `<a class="card lrow ${t.end_date && t.end_date < td ? 'past' : ''}" href="#/trip/${t.id}"><span class="tic big">✈️</span><span class="txb"><b>${esc(t.name)}</b>
        <small>${t.start_date ? esc(fmt(t.start_date, { day: 'numeric', month: 'short' })) + (t.end_date ? ' – ' + esc(fmt(t.end_date, { day: 'numeric', month: 'short' })) : '') + ' · ' : ''}${when}${t.budget ? ` · ${money(spent)} / ${money(t.budget)}` : ''}</small></span><span class="chev">›</span></a>`; }).join('')}</div>`
      : empty('🧳', 'Plan your next getaway with ＋')}`;
};
VIEWS.trip = (id) => {
  const t = S.db.trips.find((x) => x.id === id);
  if (!t) return header('Not found', { back: '#/trips' });
  const items = S.db.trip_items.filter((i) => i.trip_id === id);
  const sec = (kind, title, ph, withAmount) => {
    const L = items.filter((i) => i.kind === kind);
    return `<section class="card"><h3>${title}</h3>
      ${L.length ? `<ul class="rows">${L.map((i) => `<li class="task ${i.done ? 'done' : ''}"><button class="check" data-act="toggle-tripitem" data-id="${i.id}">${i.done ? '✓' : ''}</button>
        <span class="tb"><b>${esc(i.text)}</b>${withAmount && i.amount != null ? `<small>${money(i.amount)}${i.done ? ' · paid' : ''}</small>` : ''}</span><button class="x" data-act="del-tripitem" data-id="${i.id}">✕</button></li>`).join('')}</ul>` : ''}
      <form class="additem" data-form="tripitem" data-trip="${id}" data-kind="${kind}"><input name="text" placeholder="${ph}" data-keep autocomplete="off" maxlength="80">
        ${withAmount ? '<input name="amount" class="qty" inputmode="decimal" placeholder="R" data-keep>' : ''}<button class="btn pri">Add</button></form></section>`;
  };
  const spent = sum(items.filter((i) => i.kind === 'cost'), (i) => i.amount);
  const packed = items.filter((i) => i.kind === 'pack');
  return `${header(esc(t.name), { back: '#/trips' })}
    <section class="card"><p class="big2">✈️ ${esc(t.destination || t.name)}</p>
      <p class="muted">${t.start_date ? esc(fmt(t.start_date, { weekday: 'short', day: 'numeric', month: 'long' })) + (t.end_date ? ' → ' + esc(fmt(t.end_date, { weekday: 'short', day: 'numeric', month: 'long' })) : '') : 'No dates yet'}</p>
      ${t.budget ? `<div class="brow"><span>Spent ${money(spent)}</span><span class="muted">Budget ${money(t.budget)}</span></div>${bar(spent, t.budget)}` : spent ? `<p>Spent ${money(spent)}</p>` : ''}
      ${packed.length ? `<p class="muted">🧳 Packed ${packed.filter((i) => i.done).length} of ${packed.length}</p>` : ''}
      ${t.notes ? `<p class="notes">${esc(t.notes)}</p>` : ''}<button class="link" data-act="edit-trip" data-id="${id}">Edit trip</button></section>
    ${sec('pack', '🧳 Packing list', 'e.g. Sunscreen')}${sec('book', '🎫 Bookings & to-do', 'e.g. Airbnb – ref ABC123')}${sec('cost', '💸 Costs', 'e.g. Petrol', true)}`;
};
const tripForm = (row = {}) => openForm({
  title: row.id ? 'Edit trip' : 'New trip', table: 'trips', row,
  fields: [{ k: 'name', label: 'Trip name', req: true, ph: 'e.g. Plett for Christmas' }, { k: 'destination', label: 'Destination' },
    { k: 'start_date', label: 'From', type: 'date', half: true }, { k: 'end_date', label: 'To', type: 'date', half: true },
    { k: 'budget', label: 'Budget (R)', type: 'money' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  validate: (v) => (v.end_date && v.start_date && v.end_date < v.start_date ? 'End date is before the start date.' : null),
  after: (r) => !row.id && go(`#/trip/${r.id}`),
});

// ================================================================== SETTINGS
VIEWS.settings = () => {
  const p = me() || {};
  return `${header('Settings', { back: '#/home' })}
    <section class="card"><h3>👤 Me</h3>
      <form data-form="profile" class="form">
        <label class="fld"><span>Name</span><input name="name" value="${esc(p.name || '')}" required maxlength="30"></label>
        <label class="fld"><span>Colour</span></label><div class="colors">${COLORS.map((c) => `<label class="sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${p.color === c ? 'checked' : ''}><i></i></label>`).join('')}</div>
        <div class="two"><label class="fld"><span>Goal weight (kg)</span><input name="goal_weight" inputmode="decimal" value="${p.goal_weight ?? ''}"></label>
        <label class="fld"><span>Height (cm)</span><input name="height_cm" inputmode="decimal" value="${p.height_cm ?? ''}"></label></div>
        <button class="btn pri wide">Save</button></form></section>
    <section class="card"><h3>💑 Partner</h3>${partnerSection()}</section>
    <section class="card"><h3>🔔 Notifications</h3>${notifSection()}</section>
    <section class="card"><h3>🔒 Account</h3><p class="muted">${esc(S.email)}</p>
      <button class="btn ghost wide" data-act="change-pw">Change password</button>
      <button class="btn ghost wide" data-act="sign-out">Sign out</button>
      ${DEMO ? '<button class="btn ghost wide" data-act="reset-demo">↺ Reset demo data</button>' : ''}</section>
    <p class="muted center small">${esc(CONFIG.APP_NAME)} · made with ♥</p>`;
};

function partnerSection() {
  const list = S.allowed || [];
  const others = list.filter((e) => e.toLowerCase() !== S.email.toLowerCase());
  return `${others.length ? `<ul class="rows">${others.map((e) => `<li class="task"><span class="tb"><b>${esc(e)}</b><small>${S.db.profiles.length > 1 ? 'Joined ✓' : 'Invited – not signed up yet'}</small></span><button class="x" data-act="uninvite" data-email="${esc(e)}">Remove</button></li>`).join('')}</ul>` : ''}
    ${list.length < 2 ? `<p class="muted">Add your partner's email. They then open the app, tap “Create your account” and use that email.</p>
      <form class="additem" data-form="invite"><input name="email" type="email" placeholder="partner@email.com" required data-keep><button class="btn pri">Invite</button></form>` : ''}`;
}
function notifSection() {
  const st = pushStatus();
  if (st === 'install') return '<p class="note">📲 On iPhone, notifications only work once the app is on your Home Screen: open it in Safari → Share → <b>Add to Home Screen</b>, then open it from there. Needs iOS 16.4 or newer.</p>';
  if (st === 'denied') return '<p class="note">🔕 Notifications are blocked. Turn them on in iPhone Settings → Notifications → Ons Twee.</p>';
  if (st === 'unsupported') return '<p class="note">This browser can\'t show notifications.</p>';
  if (st === 'not-configured') return '<p class="note">Notifications aren\'t set up yet (no VAPID key in js/config.js).</p>';
  const pr = getPrefs();
  const sw = (k, label, on, sub) => `<label class="switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-push="${k}" ${on ? 'checked' : ''}><i></i></label>`;
  return `${sw('on', S.pushOn ? 'On for this phone' : 'Turn on notifications', S.pushOn)}
    ${S.pushOn ? `<div class="subsw">${sw('events', '⏰ Event reminders', pr.events, '1 hour before')}${sw('digest', '☀️ Morning summary', pr.digest, '07:00 – chores, birthdays, trips')}${sw('budget', '💸 Budget alerts', pr.budget, 'when a category goes over')}${sw('added', '🆕 New things added', pr.added, `when ${esc(partner()?.name || 'your partner')} adds an event, chore, list item and more`)}</div>
    <button class="btn ghost wide" data-act="push-test">Send a test notification</button>` : ''}`;
}

// ================================================================== generic form sheet
let FORM = null;
function openSheet(html) {
  closeSheet();
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-x" data-act="close-sheet" aria-label="Close">✕</button>${html}</div>`;
  document.body.appendChild(bg); document.body.classList.add('noscroll');
  requestAnimationFrame(() => bg.classList.add('show'));
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  setTimeout(() => bg.querySelector('[autofocus]')?.focus(), 250);
}
function closeSheet() {
  document.querySelectorAll('.sheet-bg').forEach((b) => b.remove());
  document.body.classList.remove('noscroll'); FORM = null;
  if (S.pending) render();
}
function openForm(cfg) {
  FORM = { ...cfg, values: { ...(cfg.defaults || {}), ...cfg.row } };
  drawForm();
}
function drawForm() {
  const f = FORM, v = f.values;
  const field = (fd) => {
    const val = v[fd.k] ?? '';
    const cls = `fld ${fd.half ? 'half' : ''} ${fd.third ? 'third' : ''}`;
    const lab = fd.label ? `<span>${esc(fd.label)}</span>` : '';
    const common = `name="${fd.k}" ${fd.req ? 'required' : ''} ${fd.autofocus && !f.row.id ? 'autofocus' : ''}`;
    switch (fd.type) {
      case 'textarea': return `<label class="${cls}">${lab}<textarea ${common} rows="${fd.rows || 2}" placeholder="${esc(fd.ph || '')}">${esc(val)}</textarea></label>`;
      case 'date': case 'time': return `<label class="${cls}">${lab}<input type="${fd.type}" ${common} value="${esc(val ? String(val).slice(0, fd.type === 'time' ? 5 : 10) : '')}"></label>`;
      case 'number': return `<label class="${cls}">${lab}<input type="number" inputmode="numeric" ${common} value="${esc(val)}" ${fd.min != null ? `min="${fd.min}"` : ''} ${fd.max != null ? `max="${fd.max}"` : ''}></label>`;
      case 'money': case 'decimal': return `<label class="${cls}">${lab}<input inputmode="decimal" ${common} value="${esc(val == null ? '' : typeof val === 'string' ? val : String(Number(val)))}" placeholder="${fd.type === 'money' ? 'R 0' : ''}"></label>`;
      case 'select': return `<label class="${cls}">${lab}<select ${common}>${fd.options.map(([o, n]) => `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
      case 'seg': return `<div class="${cls}">${lab}<div class="segc wide">${fd.options.map(([o, n]) => `<button type="button" class="${String(val ?? '') === String(o) ? 'on' : ''}" data-act="seg" data-k="${fd.k}" data-v="${esc(o)}" ${fd.rerender ? 'data-rr' : ''}>${esc(n)}</button>`).join('')}</div></div>`;
      case 'color': return `<div class="${cls}">${lab}<div class="evcolors">${fd.options.map(([c, n]) => `<button type="button" class="${String(val || fd.options[0][0]) === c ? 'on' : ''}" style="--c:${c}" data-act="seg" data-k="${fd.k}" data-v="${c}" aria-label="${n}"></button>`).join('')}</div></div>`;
      case 'emoji': return `<div class="${cls}">${lab}<div class="emojis">${fd.options.map((o) => `<button type="button" class="${val === o ? 'on' : ''}" data-act="seg" data-k="${fd.k}" data-v="${o}">${o}</button>`).join('')}</div></div>`;
      case 'cats': { const cats = v.type === 'income' ? INCOME_CATS : EXPENSE_CATS;
        return `<div class="${cls}">${lab}<div class="cats">${cats.map(([id, e, n]) => `<button type="button" class="${val === id ? 'on' : ''}" data-act="seg" data-k="${fd.k}" data-v="${id}"><span>${e}</span><small>${n}</small></button>`).join('')}</div></div>`; }
      default: return `<label class="${cls}">${lab}<input ${common} value="${esc(val)}" placeholder="${esc(fd.ph || '')}" autocomplete="off" maxlength="120"></label>`;
    }
  };
  const html = `<h2>${esc(f.title)}</h2><form data-form="generic" class="form grid2">${f.fields.map(field).join('')}
    <button class="btn pri wide full">Save</button>
    ${f.row.id ? `<button type="button" class="btn danger wide full" data-act="form-delete">Delete</button>` : ''}</form>`;
  const sheet = document.querySelector('.sheet-bg .sheet');
  if (sheet) { const top = sheet.scrollTop; sheet.innerHTML = `<button class="sheet-x" data-act="close-sheet" aria-label="Close">✕</button>${html}`; sheet.scrollTop = top; }
  else { const keep = FORM; openSheet(html); FORM = keep; }
}
function readFormValues() {
  const form = document.querySelector('form[data-form="generic"]'); if (!form) return;
  const fd = new FormData(form);
  FORM.fields.forEach((f) => { if (fd.has(f.k)) FORM.values[f.k] = fd.get(f.k); });
}
async function submitForm() {
  readFormValues();
  const f = FORM, v = { ...f.values };
  for (const fd of f.fields) {
    let x = v[fd.k];
    if (['money', 'decimal', 'number'].includes(fd.type)) { x = num(x); if (x != null && x < 0 && !fd.allowNeg) throw new Error(`${fd.label}: can't be negative.`); }
    else if (fd.type === 'select' && fd.k === 'month') x = Number(x);
    else if (typeof x === 'string') x = x.trim() === '' ? null : x.trim();
    if (fd.req && (x == null || x === '')) throw new Error(`Please fill in “${fd.label || fd.k}”.`);
    v[fd.k] = x;
  }
  const err = f.validate?.(v); if (err) throw new Error(err);
  if (f.table === 'tasks' && !v.assignee) v.assignee = null;
  const saved = await save(f.table, v);
  const after = f.after; closeSheet(); after?.(saved);
}

// ================================================================== actions
const find = (t, id) => S.db[t].find((x) => (x.id ?? x.user_id) === id);
const A = {
  'close-sheet': closeSheet,
  seg: (el) => { readFormValues(); FORM.values[el.dataset.k] = el.dataset.v; if (el.dataset.k === 'type') FORM.values.category = el.dataset.v === 'income' ? 'salary' : 'groceries'; drawForm(); },
  'form-delete': () => guard(async () => { if (!confirm('Delete this?')) return; const t = FORM.table, id = FORM.row.id; closeSheet(); await remove(t, id); if (['trips', 'people', 'lists'].includes(t)) history.back(); }),
  'pick-day': (el) => { const d = el.dataset.day; if (d.slice(0, 7) !== S.calMonth) S.calMonth = d.slice(0, 7); S.day = d; render(); document.getElementById('dayhead')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
  'cal-prev': () => { S.calMonth = addMonths(S.calMonth + '-01', -1).slice(0, 7); render(); },
  'cal-next': () => { S.calMonth = addMonths(S.calMonth + '-01', 1).slice(0, 7); render(); },
  'cal-today': () => { S.calMonth = today().slice(0, 7); S.day = today(); if (route().id) go('#/calendar'); else render(); },
  'add-event': (el) => eventForm(el.dataset.date ? { date: el.dataset.date } : {}),
  'edit-event': (el) => eventForm(find('events', el.dataset.id)),
  'm-prev': () => { S.month = addMonths(S.month + '-01', -1).slice(0, 7); render(); },
  'm-next': () => { S.month = addMonths(S.month + '-01', 1).slice(0, 7); render(); },
  'add-tx': () => txForm(),
  'edit-tx': (el) => txForm(find('transactions', el.dataset.id)),
  'edit-budgets': budgetForm,
  'add-goal': () => goalForm(), 'edit-goal': (el) => goalForm(find('goals', el.dataset.id)),
  'add-deposit': (el) => depositForm(el.dataset.id),
  'add-list': () => listForm(), 'edit-list': (el) => listForm(find('lists', el.dataset.id)),
  'toggle-item': (el) => guard(async () => { const i = find('list_items', el.dataset.id); i.done = !i.done; render(); await save('list_items', { id: i.id, done: i.done }); }),
  'del-item': (el) => guard(() => remove('list_items', el.dataset.id)),
  'clear-done': (el) => guard(async () => { for (const i of S.db.list_items.filter((x) => x.list_id === el.dataset.id && x.done)) await api.remove('list_items', i.id); await refresh('list_items'); }),
  'recipe-tab': (el) => { S.recipeTab = el.dataset.id; render(); },
  'add-recipe': () => recipeForm(), 'edit-recipe': (el) => recipeForm(find('recipes', el.dataset.id)),
  'recipe-status': (el) => guard(() => save('recipes', { id: el.dataset.id, status: el.dataset.v })),
  'recipe-to-groceries': (el) => guard(async () => {
    const r = find('recipes', el.dataset.id); const g = S.db.lists.find((l) => l.name === 'Groceries');
    if (!g) throw new Error('There is no “Groceries” list.');
    const have = new Set(S.db.list_items.filter((i) => i.list_id === g.id && !i.done).map((i) => i.text.toLowerCase()));
    const add = lines(r.ingredients).filter((x) => !have.has(x.toLowerCase()));
    if (!add.length) return toast('Already on the grocery list ✓');
    for (const text of add) await api.save('list_items', { list_id: g.id, text: text.slice(0, 80), qty: null, done: false });
    await refresh('list_items'); toast(`Added ${add.length} item${add.length > 1 ? 's' : ''} to Groceries 🛒`);
  }),
  'add-log': () => logForm(), 'edit-log': (el) => logForm(find('body_logs', el.dataset.id)),
  'add-task': () => taskForm(), 'edit-task': (el) => taskForm(find('tasks', el.dataset.id)),
  'toggle-task': (el) => guard(async () => {
    const t = find('tasks', el.dataset.id);
    if (!t.done && t.repeat !== 'none') {
      const base = t.due && t.due > today() ? t.due : today();
      const next = t.repeat === 'daily' ? addDays(base, 1) : t.repeat === 'weekly' ? addDays(t.due && t.due >= today() ? t.due : base, 7) : addMonths(base, 1);
      toast(`Done! Next: ${fmtShort(next)} 🔁`);
      await save('tasks', { id: t.id, due: next, done_at: new Date().toISOString() });
    } else await save('tasks', { id: t.id, done: !t.done, done_at: t.done ? null : new Date().toISOString() });
  }),
  'idea-tab': (el) => { S.ideaTab = el.dataset.id; render(); },
  'add-idea': () => ideaForm(), 'edit-idea': (el) => ideaForm(find('ideas', el.dataset.id)),
  'toggle-idea': (el) => guard(async () => { const i = find('ideas', el.dataset.id); await save('ideas', { id: i.id, done: !i.done, done_on: i.done ? null : today() }); }),
  surprise: () => {
    const open = S.db.ideas.filter((i) => i.kind === 'date' && !i.done);
    const pick = open[Math.floor(Math.random() * open.length)];
    openSheet(`<div class="surprise-card"><span>🎲</span><p class="muted">Tonight's plan:</p><h2>${esc(pick.title)}</h2>${pick.notes ? `<p>${esc(pick.notes)}</p>` : ''}
      <div class="btnrow center"><button class="btn ghost" data-act="surprise">Roll again</button><button class="btn pri" data-act="close-sheet">Let's do it! 💕</button></div></div>`);
  },
  'add-person': () => personForm(), 'edit-person': (el) => personForm(find('people', el.dataset.id)),
  'add-gift': (el) => giftForm({}, el.dataset.id), 'edit-gift': (el) => giftForm(find('gifts', el.dataset.id)),
  'cycle-gift': (el) => guard(async () => { const g = find('gifts', el.dataset.id); const n = { idea: 'bought', bought: 'given', given: 'idea' }[g.status]; await save('gifts', { id: g.id, status: n }); }),
  'add-trip': () => tripForm(), 'edit-trip': (el) => tripForm(find('trips', el.dataset.id)),
  'toggle-tripitem': (el) => guard(async () => { const i = find('trip_items', el.dataset.id); await save('trip_items', { id: i.id, done: !i.done }); }),
  'del-tripitem': (el) => guard(() => remove('trip_items', el.dataset.id)),
  'change-pw': () => guard(async () => { const pw = prompt('New password (at least 8 characters):'); if (!pw) return; if (pw.length < 8) throw new Error('Password too short.'); await api.changePassword(pw); toast('Password changed ✓'); }),
  'sign-out': () => guard(async () => { if (!confirm('Sign out on this device?')) return; await api.signOut(); localStorage.removeItem('onstwee-cache'); location.hash = ''; location.reload(); }),
  'reset-demo': () => resetDemo(),
  'auth-mode': (el) => signInScreen('', el.dataset.mode),
  'uninvite': (el) => guard(async () => { if (!confirm(`Remove ${el.dataset.email}? They will lose access.`)) return; await api.uninvite(el.dataset.email); S.allowed = await api.allowed(); render(); }),
  'push-test': () => guard(testNotification),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('submit', (e) => {
  const f = e.target; const kind = f.dataset.form; if (!kind) return; e.preventDefault();
  const fd = new FormData(f);
  if (kind === 'generic') return guard(submitForm);
  if (kind === 'item') return guard(async () => {
    const text = String(fd.get('text') || '').trim(); if (!text) return;
    f.reset(); f.querySelector('input').focus();
    await save('list_items', { list_id: f.dataset.list, text, qty: String(fd.get('qty') || '').trim() || null, done: false });
    document.querySelector('form[data-form="item"] input')?.focus();
  });
  if (kind === 'tripitem') return guard(async () => {
    const text = String(fd.get('text') || '').trim(); if (!text) return;
    const amount = num(fd.get('amount'));
    await save('trip_items', { trip_id: f.dataset.trip, kind: f.dataset.kind, text, amount, done: false });
  });
  if (kind === 'budgets') return guard(async () => {
    const cur = Object.fromEntries(S.db.budgets.map((b) => [b.category, b]));
    for (const [id] of EXPENSE_CATS) {
      const v = num(fd.get(id));
      if (v && v > 0) await api.save('budgets', { id: cur[id]?.id, category: id, amount: v });
      else if (cur[id]) await api.remove('budgets', cur[id].id);
    }
    closeSheet(); await refresh('budgets'); toast('Budgets saved ✓');
  });
  if (kind === 'invite') return guard(async () => {
    await api.invite(String(fd.get('email'))); S.allowed = await api.allowed(); toast('Invited 💌'); render();
  });
  if (kind === 'profile') return guard(async () => {
    await save('profiles', { user_id: S.me, name: String(fd.get('name')).trim(), color: fd.get('color') || COLORS[0], goal_weight: num(fd.get('goal_weight')), height_cm: num(fd.get('height_cm')) });
    toast('Saved ✓');
  });
  if (kind === 'signin') return guard(async () => {
    const up = f.dataset.mode === 'signup'; const btn = f.querySelector('button'); const label = btn.textContent;
    btn.disabled = true; btn.textContent = up ? 'Creating…' : 'Signing in…';
    try { await (up ? api.signUp : api.signIn).call(api, String(fd.get('email')), String(fd.get('password'))); await start(); } finally { btn.disabled = false; btn.textContent = label; }
  });
  if (kind === 'welcome') return guard(async () => {
    await api.save('profiles', { user_id: S.me, name: String(fd.get('name')).trim(), color: fd.get('color') || COLORS[0] });
    await start();
  });
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset?.push; if (!k) return;
  guard(async () => {
    if (k === 'on') {
      if (e.target.checked) { try { await enablePush(S.me); S.pushOn = true; toast('Notifications on 🔔'); } catch (err) { S.pushOn = false; if (err.message === 'denied') toast('Notifications were not allowed.'); else throw err; } }
      else { await disablePush(); S.pushOn = false; }
    } else { const p = getPrefs(); p[k] = e.target.checked; await savePrefs(p); }
    render();
  });
});
// re-render after typing finishes if updates arrived meanwhile
document.addEventListener('focusout', () => setTimeout(() => { if (S.pending && !document.querySelector('.sheet-bg') && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) render(); }, 50));

// ================================================================== boot
function signInScreen(msg = '', mode = 'signin') {
  const up = mode === 'signup';
  $app.innerHTML = `<main class="auth"><div class="logo">🏡💕</div><h1>${esc(CONFIG.APP_NAME)}</h1><p class="muted">Just the two of us.</p>
    ${msg ? `<p class="note">${esc(msg)}</p>` : ''}
    <form data-form="signin" data-mode="${mode}" class="form"><label class="fld"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
    <label class="fld"><span>Password${up ? ' (at least 8 characters)' : ''}</span><input name="password" type="password" minlength="${up ? 8 : 1}" autocomplete="${up ? 'new-password' : 'current-password'}" required></label>
    <button class="btn pri wide">${up ? 'Create account' : 'Sign in'}</button></form>
    <button class="link center" data-act="auth-mode" data-mode="${up ? 'signin' : 'signup'}">${up ? 'I already have an account – sign in' : 'First time here? Create your account'}</button></main>`;
}
function welcomeScreen() {
  $app.innerHTML = `<main class="auth"><div class="logo">👋</div><h1>Welcome!</h1><p class="muted">What should we call you?</p>
    <form data-form="welcome" class="form"><label class="fld"><span>Your name</span><input name="name" required maxlength="30" autofocus></label>
    <label class="fld"><span>Your colour</span></label><div class="colors">${COLORS.map((c, i) => `<label class="sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${i === (S.db.profiles.length ? 9 : 0) ? 'checked' : ''}><i></i></label>`).join('')}</div>
    <button class="btn pri wide">Let's go</button></form></main>`;
}
async function start() {
  const u = await api.user();
  if (!u) return signInScreen();
  S.me = u.id; S.email = u.email || '';
  if (!(await api.isAllowed())) { await api.signOut(); S.me = null; return signInScreen(`${S.email} is not on the list of allowed emails. Add it in Supabase (see README).`); }
  try { S.db = await api.loadAll(); cache(); }
  catch (e) { const c = localStorage.getItem('onstwee-cache'); if (c) { S.db = JSON.parse(c); toast('Offline – showing saved data'); } else throw e; }
  if (!me()) { const keepMe = S.me; S.me = null; welcomeScreen(); S.me = keepMe; return; }
  S.allowed = await api.allowed().catch(() => []);
  if (pushStatus() === 'ok') S.pushOn = DEMO ? Notification.permission === 'granted' : await syncPush(S.me).catch(async () => !!(await currentSub().catch(() => null)));
  render();
  if (!S.subscribed) { S.subscribed = true; api.subscribe((t) => api.load(t).then((rows) => { S.db[t] = rows; cache(); safeRender(); }).catch(() => {})); }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) api.loadAll().then((db) => { S.db = db; cache(); safeRender(); }).catch(() => {}); });
start().catch((e) => { console.error(e); $app.innerHTML = `<main class="auth"><h1>😕</h1><p>${esc(e.message)}</p><button class="btn pri" onclick="location.reload()">Try again</button></main>`; });
