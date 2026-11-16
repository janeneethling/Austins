// Data layer: Supabase (shared, real-time) or Demo (this device only).
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.SUPABASE_URL;
export const TABLES = ['profiles', 'events', 'transactions', 'budgets', 'goals', 'goal_deposits', 'body_logs',
  'lists', 'list_items', 'tasks', 'ideas', 'people', 'gifts', 'trips', 'trip_items'];
const KEY_OF = (table) => (table === 'profiles' ? 'user_id' : 'id');

let sb = null;
async function supa() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm');
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'onstwee-auth' } });
  }
  return sb;
}
const unwrap = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---------------------------------------------------------------- Supabase
const remote = {
  async user() { const c = await supa(); return (await c.auth.getSession()).data.session?.user || null; },
  async signIn(email, password) {
    const c = await supa();
    const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    return data.user;
  },
  async signOut() { await (await supa()).auth.signOut(); },
  async changePassword(pw) { const c = await supa(); unwrap(await c.auth.updateUser({ password: pw })); },
  async isAllowed() { return unwrap(await (await supa()).rpc('is_partner')); },
  async loadAll() {
    const c = await supa();
    const res = await Promise.all(TABLES.map((t) => c.from(t).select('*')));
    return Object.fromEntries(TABLES.map((t, i) => [t, unwrap(res[i]) || []]));
  },
  async load(table) { return unwrap(await (await supa()).from(table).select('*')); },
  async save(table, row) {
    const c = await supa();
    const r = { ...row }; delete r.created_at;
    const key = KEY_OF(table);
    if (r[key] && table !== 'profiles') return unwrap(await c.from(table).update(r).eq(key, r[key]).select().single());
    if (table !== 'profiles') delete r.id;
    return unwrap(await c.from(table).upsert(r).select().single());
  },
  async remove(table, id) { unwrap(await (await supa()).from(table).delete().eq(KEY_OF(table), id)); },
  async removeWhere(table, col, val) { unwrap(await (await supa()).from(table).delete().eq(col, val)); },
  subscribe(onTable) {
    supa().then((c) => {
      let ch = c.channel('onstwee');
      TABLES.forEach((t) => { ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onTable(t)); });
      ch.subscribe();
    });
  },
};

// ---------------------------------------------------------------- Demo
const KEY = 'onstwee-demo-v1';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const listeners = new Set();
function seed() {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  const A = 'u-a', B = 'u-b';
  const db = Object.fromEntries(TABLES.map((t) => [t, []]));
  db.profiles = [
    { user_id: A, name: 'Jané', color: '#d6336c', goal_weight: 62, height_cm: 168 },
    { user_id: B, name: 'Ruan', color: '#1c9bd6', goal_weight: 85, height_cm: 184 },
  ];
  const ym = iso(today).slice(0, 8);
  const tx = (d, amount, category, note, by, type = 'expense') => ({ id: uuid(), date: ym + String(d).padStart(2, '0'), amount, category, note, paid_by: by, type });
  db.transactions = [
    tx(1, 42000, 'salary', 'Salary', A, 'income'), tx(1, 38000, 'salary', 'Salary', B, 'income'),
    tx(1, 14500, 'home', 'Rent', B), tx(2, 1850, 'groceries', 'Woolies', A), tx(3, 640, 'eating_out', 'Sushi date', B),
    tx(4, 950, 'transport', 'Petrol', B), tx(5, 1320, 'utilities', 'Electricity', A), tx(6, 2200, 'groceries', 'Checkers', B),
    tx(7, 389, 'health', 'Dis-Chem', A), tx(8, 199, 'entertainment', 'Netflix', A), tx(9, 780, 'shopping', 'Takkies', B),
  ].filter((t) => t.date <= iso(today));
  db.budgets = [['groceries', 6000], ['eating_out', 1500], ['transport', 2500], ['home', 15000], ['utilities', 2000], ['entertainment', 800], ['shopping', 1500]]
    .map(([category, amount]) => ({ id: uuid(), category, amount }));
  const g1 = uuid(), g2 = uuid();
  db.goals = [{ id: g1, name: 'Bali trip', emoji: '🌴', target: 40000, target_date: day(240) }, { id: g2, name: 'Emergency fund', emoji: '🛟', target: 60000 }];
  db.goal_deposits = [{ id: uuid(), goal_id: g1, date: day(-40), amount: 8000, user_id: A }, { id: uuid(), goal_id: g1, date: day(-10), amount: 6500, user_id: B },
    { id: uuid(), goal_id: g2, date: day(-30), amount: 21000, user_id: A }];
  const logs = [];
  for (let i = 0; i < 10; i++) {
    logs.push({ id: uuid(), user_id: A, date: day(-7 * (9 - i)), weight: +(68.4 - i * 0.45 + (i % 3) * 0.2).toFixed(1), waist: +(78 - i * 0.4).toFixed(1), hips: +(99 - i * 0.3).toFixed(1) });
    logs.push({ id: uuid(), user_id: B, date: day(-7 * (9 - i) - 1), weight: +(92.1 - i * 0.6 + (i % 2) * 0.3).toFixed(1), waist: +(96 - i * 0.5).toFixed(1), chest: 108 });
  }
  db.body_logs = logs;
  const gl = uuid(), ph = uuid();
  db.lists = [{ id: gl, name: 'Groceries', emoji: '🛒', sort: 1 }, { id: ph, name: 'Pharmacy', emoji: '💊', sort: 2 }];
  db.list_items = [['Milk', '2L'], ['Eggs', '18'], ['Avocados', ''], ['Boerewors', '1kg'], ['Rooibos', ''], ['Bread', '']]
    .map(([text, qty], i) => ({ id: uuid(), list_id: gl, text, qty, done: i === 5 }))
    .concat([{ id: uuid(), list_id: ph, text: 'Sunscreen SPF50', qty: '', done: false }, { id: uuid(), list_id: ph, text: 'Allergy tablets', qty: '', done: false }]);
  db.tasks = [
    { id: uuid(), title: 'Take out the bins', due: day(1), repeat: 'weekly', assignee: B, done: false },
    { id: uuid(), title: 'Water the plants', due: day(0), repeat: 'weekly', assignee: A, done: false },
    { id: uuid(), title: 'Renew car licence', due: day(12), repeat: 'none', assignee: null, done: false },
    { id: uuid(), title: 'Book dentist', due: day(-1), repeat: 'none', assignee: A, done: false },
  ];
  db.ideas = [
    { id: uuid(), kind: 'date', title: 'Picnic at Kirstenbosch', cost: 'R', done: false },
    { id: uuid(), kind: 'date', title: 'Cooking class together', cost: 'RR', done: false },
    { id: uuid(), kind: 'date', title: 'Sunset at Signal Hill', cost: 'R', done: true, done_on: day(-20) },
    { id: uuid(), kind: 'bucket', title: 'See the Northern Lights', cost: 'RRR', done: false },
    { id: uuid(), kind: 'bucket', title: 'Hike the Otter Trail', cost: 'RR', done: false },
  ];
  const md = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return { month: d.getMonth() + 1, day: d.getDate() }; };
  const p1 = uuid(), p2 = uuid();
  db.people = [
    { id: p1, name: 'Ma', kind: 'birthday', ...md(9), year: 1966 },
    { id: p2, name: 'Our anniversary', kind: 'anniversary', ...md(45), year: 2019 },
    { id: uuid(), name: 'Ruan', kind: 'birthday', ...md(120), year: 1993 },
  ];
  db.gifts = [{ id: uuid(), person_id: p1, idea: 'Spa voucher', price: 900, status: 'idea' }, { id: uuid(), person_id: p1, idea: 'Photo book', price: 450, status: 'bought' }];
  const tr = uuid();
  db.trips = [{ id: tr, name: 'Plett for Christmas', destination: 'Plettenberg Bay', start_date: day(30), end_date: day(36), budget: 12000 }];
  db.trip_items = [
    { id: uuid(), trip_id: tr, kind: 'pack', text: 'Swimsuits', done: true }, { id: uuid(), trip_id: tr, kind: 'pack', text: 'Beach towels', done: false },
    { id: uuid(), trip_id: tr, kind: 'book', text: 'Airbnb – ref HM2X9', done: true }, { id: uuid(), trip_id: tr, kind: 'cost', text: 'Airbnb', amount: 7200, done: true },
    { id: uuid(), trip_id: tr, kind: 'cost', text: 'Petrol', amount: 1400, done: false },
  ];
  db.events = [
    { id: uuid(), title: 'Dinner with the Smiths', date: day(2), start_time: '19:00', location: 'Our place', who: 'both' },
    { id: uuid(), title: 'Gym class', date: day(1), start_time: '06:00', who: A },
    { id: uuid(), title: 'Plett for Christmas', date: day(30), end_date: day(36), start_time: '09:00', who: 'both' },
  ];
  db._me = A;
  return db;
}
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch { /* */ } const s = seed(); persist(s); return s; }
function persist(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } }
const demo = {
  async user() { const s = load(); return s._me ? { id: s._me, email: 'demo@example.com' } : null; },
  async signIn() { const s = load(); s._me = 'u-a'; persist(s); return { id: 'u-a', email: 'demo@example.com' }; },
  async signOut() { const s = load(); s._me = null; persist(s); },
  async changePassword() {},
  async isAllowed() { return true; },
  async loadAll() { const s = load(); return Object.fromEntries(TABLES.map((t) => [t, s[t] || []])); },
  async load(table) { return load()[table] || []; },
  async save(table, row) {
    const s = load(); const key = KEY_OF(table); const list = s[table] ||= [];
    let r;
    if (row[key] && list.some((x) => x[key] === row[key])) { r = list.find((x) => x[key] === row[key]); Object.assign(r, row); }
    else { r = { created_at: new Date().toISOString(), created_by: s._me, ...row, [key]: row[key] || uuid() }; list.push(r); }
    persist(s); listeners.forEach((f) => f(table)); return { ...r };
  },
  async remove(table, id) {
    const s = load(); const key = KEY_OF(table);
    s[table] = (s[table] || []).filter((x) => x[key] !== id);
    const children = { goals: ['goal_deposits', 'goal_id'], lists: ['list_items', 'list_id'], people: ['gifts', 'person_id'], trips: ['trip_items', 'trip_id'] }[table];
    if (children) s[children[0]] = s[children[0]].filter((x) => x[children[1]] !== id);
    persist(s); listeners.forEach((f) => f(table));
  },
  async removeWhere(table, col, val) { const s = load(); s[table] = (s[table] || []).filter((x) => x[col] !== val); persist(s); listeners.forEach((f) => f(table)); },
  subscribe(fn) { listeners.add(fn); },
};

export const api = DEMO ? demo : remote;
export function resetDemo() { localStorage.removeItem(KEY); location.reload(); }
