import crypto from 'node:crypto';
import { getStore, prod, hashPassword, verifyPassword, fakeVerify, sign, verify, safeEq } from '../lib/core.js';

const COOKIE = { customer: prod() ? '__Host-cs' : 'cs', admin: prod() ? '__Host-as' : 'as' };
const TTL = { customer: 7 * 86400, admin: 2 * 3600 };
const STATUTS = ['En attente', 'En préparation', 'Livrée', 'Annulée'];
const RECEPTIONS = ['Livraison à domicile', 'Retrait sur place'];
const PAIEMENTS = ['Espèces à la livraison', 'Apple Pay'];
const COMMON_PW = ['password123', '1234567890', 'azertyuiop', 'motdepasse1', 'emarket2026', 'qwertyuiop', 'madagascar1'];
let S;
const gj = async k => { const v = await S.get(k); return v ? JSON.parse(v) : null; };
const sj = (k, v, o) => S.set(k, JSON.stringify(v), o);
const fail = (status, error, extra) => Object.assign(new Error(error), { status, extra });
const today = () => new Date().toISOString().slice(0, 10);
const expired = p => p.expiry < today();

/* ---------- utilitaires HTTP ---------- */
function send(res, status, obj, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) { // pré-analysé par Vercel
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    if (JSON.stringify(b).length > 300_000) throw fail(413, 'Requête trop volumineuse.');
    return b;
  }
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > 300_000) throw fail(413, 'Requête trop volumineuse.'); chunks.push(c); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { throw fail(400, 'JSON invalide.'); }
}
const clientIp = req => req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';
function cookie(aud, tok) {
  return `${COOKIE[aud]}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${tok ? TTL[aud] : 0}${prod() ? '; Secure' : ''}`;
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
async function hit(key, limit, windowSec) { // limiteur à fenêtre fixe
  const n = await S.incr('rl:' + key, 1); if (n === 1) await S.expire('rl:' + key, windowSec); return n <= limit;
}
const tooMany = () => fail(429, 'Trop de tentatives. Réessayez dans quelques minutes.');

/* ---------- validation ---------- */
const str = (v, min, max, label) => { if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw fail(400, `${label} invalide (${min}–${max} caractères).`); return v.trim(); };
const int = (v, min, max, label) => { if (!Number.isInteger(v) || v < min || v > max) throw fail(400, `${label} invalide.`); return v; };
const normEmail = v => String(v ?? '').trim().toLowerCase();
function checkPassword(pw, email) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) throw fail(400, 'Le mot de passe doit contenir 10 à 128 caractères.');
  if (COMMON_PW.includes(pw.toLowerCase()) || pw.toLowerCase() === email) throw fail(400, 'Mot de passe trop courant.');
}
function checkProduct(b) {
  const p = {
    name: str(b.name, 1, 80, 'Nom'), price: int(b.price, 1, 10_000_000, 'Prix'), old: int(b.old ?? 0, 0, 10_000_000, 'Ancien prix'),
    stock: int(b.stock, 0, 100_000, 'Stock'), expiry: String(b.expiry ?? ''), emoji: String(b.emoji ?? '🛒').slice(0, 8), bg: String(b.bg ?? '#edf0ff'),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.expiry) || isNaN(Date.parse(p.expiry))) throw fail(400, 'Date de péremption invalide.');
  if (!/^#[0-9a-fA-F]{6}$/.test(p.bg)) throw fail(400, 'Couleur invalide.');
  if (b.image) {
    if (typeof b.image !== 'string' || b.image.length > 200_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image)) throw fail(400, 'Image invalide (PNG/JPEG/WebP, 150 Ko max).');
    p.image = b.image;
  }
  return p;
}

/* ---------- produits ---------- */
const SEED = [
  ['Nougat Robert en sachet', 523, 550, 34, '🍬', '#d9f0e7', 120], ['Café soluble Black 3en1 30g', 1235, 1300, 18, '☕', '#d8d8d8', 300],
  ['Eau de source 50cl', 1425, 1500, 40, '💧', '#dff3ff', 400], ['Kit 3 en 1 couvert en bois', 1900, 2000, 12, '🥢', '#efe2bd', 900],
  ['Boîte carton fenêtre sushis', 1900, 2000, 9, '🍣', '#e8e8e8', 900], ['Jus d’orange 20cl', 2090, 2200, 23, '🍊', '#ffe9a7', 60],
  ['Nectar multifruits 20cl', 2366, 2490, 16, '🧃', '#fff0d2', 45], ['Bougie d’anniversaire chiffre 5', 2375, 2500, 7, '🎂', '#ffd1e0', 900],
  ['Jus de pomme en brique 20cl', 2375, 2500, 21, '🍏', '#e9f5dc', 50], ['Allumettes salon', 2375, 2500, 5, '🔥', '#dfe7f5', 900],
  ['Biscuits chocolat', 1800, 2000, 30, '🍪', '#ead4bd', 90], ['Lait UHT 1L', 3200, 0, 14, '🥛', '#f3f3f3', 120],
];
async function seed() {
  if (!(await S.set('seeded', '1', { nx: true }))) return;
  for (const [name, price, old, stock, emoji, bg, days] of SEED) {
    const id = String(await S.incr('seq:product')), expiry = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    await sj('product:' + id, { id, name, price, old, expiry, emoji, bg }); await S.set('stock:' + id, stock); await S.sadd('products', id);
  }
}
async function loadProducts() {
  const out = [];
  for (const id of await S.smembers('products')) { const p = await gj('product:' + id); if (p) out.push({ ...p, stock: +(await S.get('stock:' + id)) || 0 }); }
  return out.sort((a, b) => +a.id - +b.id);
}

/* ---------- tickets (1 commande = 1 ticket) ---------- */
async function addMessage(orderId, role, text) {
  await S.rpush('msgs:' + orderId, JSON.stringify({ role, text, at: new Date().toISOString() }));
  const meta = (await gj('tmeta:' + orderId)) || { unread: {} };
  meta.last = new Date().toISOString(); meta.by = role;
  if (role === 'client') meta.unread.admin = true; else meta.unread.client = true;
  await sj('tmeta:' + orderId, meta);
}
async function readThread(orderId, viewer) {
  const messages = (await S.lrange('msgs:' + orderId)).map(JSON.parse);
  const meta = (await gj('tmeta:' + orderId)) || { unread: {} };
  if (meta.unread[viewer]) { meta.unread[viewer] = false; await sj('tmeta:' + orderId, meta); }
  return messages;
}
const pub = async o => { const { userId, ...rest } = o; const m = (await gj('tmeta:' + o.id)) || { unread: {} }; return { ...rest, last: m.last, unread: m.unread }; };
async function restock(order) { for (const it of order.items) await S.incr('stock:' + it.id, it.qty); }

/* ---------- handlers : auth client ---------- */
async function register({ b, ip, res }) {
  if (!(await hit('reg:' + ip, 10, 3600))) throw tooMany();
  const email = normEmail(b.email);
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) throw fail(400, 'Adresse e-mail invalide.');
  checkPassword(b.password, email);
  const name = str(b.name, 2, 80, 'Nom'), phone = String(b.phone ?? '').trim();
  if (!/^[+0-9 ().-]{6,20}$/.test(phone)) throw fail(400, 'Téléphone invalide.');
  const id = crypto.randomUUID();
  if (!(await S.set('email:' + email, id, { nx: true }))) throw fail(409, 'Un compte existe déjà avec cet e-mail.');
  const user = { id, email, name, phone, hash: await hashPassword(b.password), ver: 0, createdAt: new Date().toISOString() };
  await sj('user:' + id, user);
  send(res, 201, { user: { id, email, name, phone } }, { 'Set-Cookie': cookie('customer', sign({ sub: id, aud: 'customer', ver: 0 }, TTL.customer)) });
}
async function login({ b, ip, res }) {
  const email = normEmail(b.email), pw = typeof b.password === 'string' ? b.password : '';
  if (!(await hit('li:' + ip + ':' + email, 5, 900)) || !(await hit('lip:' + ip, 30, 900)) || !(await hit('lid:' + email, 20, 900))) throw tooMany();
  const id = await S.get('email:' + email), u = id && (await gj('user:' + id));
  const ok = u ? await verifyPassword(pw, u.hash) : (await fakeVerify(pw), false);
  if (!ok) throw fail(401, 'Identifiants incorrects.');
  await S.del('rl:li:' + ip + ':' + email);
  send(res, 200, { user: { id: u.id, email: u.email, name: u.name, phone: u.phone } }, { 'Set-Cookie': cookie('customer', sign({ sub: u.id, aud: 'customer', ver: u.ver }, TTL.customer)) });
}
async function logout({ res, aud, user }) {
  if (user) { // révoque toutes les sessions de ce compte
    if (aud === 'customer') { user.ver++; await sj('user:' + user.id, user); } else await S.incr('adminver');
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': cookie(aud, '') });
}

/* ---------- handlers : auth admin ---------- */
async function adminLogin({ b, ip, res }) {
  const { ADMIN_USERNAME: au, ADMIN_PASSWORD_HASH: ah } = process.env;
  if (!au || !ah) throw fail(503, 'Administration non configurée.');
  const name = String(b.username ?? '').trim(), pw = typeof b.password === 'string' ? b.password : '';
  if (!(await hit('ali:' + ip, 5, 900)) || !(await hit('alg', 30, 900))) throw tooMany();
  const ok = safeEq(name, au) ? await verifyPassword(pw, ah) : (await fakeVerify(pw), false);
  if (!ok) throw fail(401, 'Identifiants incorrects.');
  await S.del('rl:ali:' + ip);
  const ver = +(await S.get('adminver')) || 0;
  send(res, 200, { admin: true }, { 'Set-Cookie': cookie('admin', sign({ sub: 'admin', aud: 'admin', ver }, TTL.admin)) });
}

/* ---------- handlers : catalogue ---------- */
const catalog = async ({ res }) => send(res, 200, { products: (await loadProducts()).filter(p => p.stock > 0 && !expired(p)) });
const adminProducts = async ({ res }) => send(res, 200, { products: await loadProducts() });
async function saveProduct({ b, m, res }) {
  const p = checkProduct(b);
  let id = m[1];
  if (id) { if (!(await gj('product:' + id))) throw fail(404, 'Produit introuvable.'); }
  else { id = String(await S.incr('seq:product')); await S.sadd('products', id); }
  const { stock, ...doc } = p;
  await sj('product:' + id, { ...doc, id }); await S.set('stock:' + id, stock);
  send(res, id === m[1] ? 200 : 201, { product: { ...doc, id, stock } });
}
async function deleteProduct({ m, res }) { await S.del('product:' + m[1]); await S.del('stock:' + m[1]); await S.srem('products', m[1]); send(res, 200, { ok: true }); }

/* ---------- handlers : commandes / tickets ---------- */
async function createOrder({ b, user, res }) {
  if (!(await hit('ord:' + user.id, 10, 3600))) throw tooMany();
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw fail(400, 'Panier invalide.');
  const want = new Map();
  for (const it of b.items) { const id = String(it?.id), q = int(it?.qty, 1, 99, 'Quantité'); want.set(id, (want.get(id) || 0) + q); }
  const receive = RECEPTIONS.includes(b.receive) ? b.receive : (() => { throw fail(400, 'Mode de réception invalide.'); })();
  const pay = PAIEMENTS.includes(b.pay) ? b.pay : (() => { throw fail(400, 'Mode de paiement invalide.'); })();
  const address = str(b.address ?? user.address ?? '', 3, 300, 'Adresse'), note = b.note ? str(b.note, 1, 1000, 'Message') : '';
  const items = [], reserved = []; let total = 0;
  const rollback = async () => { for (const r of reserved) await S.incr('stock:' + r.id, r.qty); };
  for (const [id, qty] of want) {
    const p = await gj('product:' + id);
    if (!p || expired(p)) { await rollback(); throw fail(409, 'Un produit n’est plus disponible.'); }
    if ((await S.incr('stock:' + id, -qty)) < 0) { await S.incr('stock:' + id, qty); await rollback(); throw fail(409, `Stock insuffisant pour « ${p.name} ».`); }
    reserved.push({ id, qty }); items.push({ id, name: p.name, qty, unit: p.price }); total += qty * p.price; // le prix vient TOUJOURS du serveur
  }
  const id = 'EM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const order = { id, userId: user.id, customer: { name: user.name, phone: user.phone, address }, items, total, payment: pay, receive, status: 'En attente', createdAt: new Date().toISOString() };
  await sj('order:' + id, order); await S.sadd('orders', id); await S.sadd('uorders:' + user.id, id);
  await addMessage(id, 'système', 'Commande reçue. Le vendeur va vous répondre ici.');
  if (note) await addMessage(id, 'client', note);
  send(res, 201, { order: await pub(order) });
}
async function myOrders({ user, res }) {
  const list = [];
  for (const id of await S.smembers('uorders:' + user.id)) { const o = await gj('order:' + id); if (o) list.push(await pub(o)); }
  send(res, 200, { orders: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
}
async function ownOrder(id, user) { // IDOR : un client ne voit que ses commandes (404 sinon)
  const o = await gj('order:' + id);
  if (!o || (user && o.userId !== user.id)) throw fail(404, 'Commande introuvable.');
  return o;
}
async function getThread({ m, user, aud, res }) {
  const o = await ownOrder(m[1], aud === 'customer' ? user : null);
  send(res, 200, { order: await pub(o), messages: await readThread(o.id, aud === 'admin' ? 'admin' : 'client') });
}
async function postMessage({ m, b, user, aud, res }) {
  const o = await ownOrder(m[1], aud === 'customer' ? user : null);
  if (o.status === 'Annulée') throw fail(409, 'Ce ticket est clos (commande annulée).');
  if (!(await hit('msg:' + (user?.id || 'admin'), 40, 300))) throw tooMany();
  await addMessage(o.id, aud === 'admin' ? 'vendeur' : 'client', str(b.text, 1, 1000, 'Message'));
  send(res, 201, { ok: true });
}
async function cancelOrder({ m, user, res }) {
  const o = await ownOrder(m[1], user);
  if (o.status !== 'En attente') throw fail(409, 'Cette commande ne peut plus être annulée ici : écrivez au vendeur.');
  o.status = 'Annulée'; await sj('order:' + o.id, o); await restock(o); await addMessage(o.id, 'système', 'Commande annulée par le client.');
  send(res, 200, { order: await pub(o) });
}
async function adminOrders({ res }) {
  const list = [];
  for (const id of await S.smembers('orders')) { const o = await gj('order:' + id); if (o) list.push(await pub(o)); }
  send(res, 200, { orders: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200) });
}
async function setStatus({ m, b, res }) {
  const o = await ownOrder(m[1], null);
  if (!STATUTS.includes(b.status)) throw fail(400, 'Statut invalide.');
  if (o.status === 'Annulée') throw fail(409, 'Une commande annulée ne peut pas être rouverte.');
  if (b.status === 'Annulée') await restock(o);
  o.status = b.status; await sj('order:' + o.id, o); await addMessage(o.id, 'système', `Statut : ${o.status}.`);
  send(res, 200, { order: await pub(o) });
}

/* ---------- routeur ---------- */
const ME = async ({ user, res }) => send(res, 200, { user: user && { id: user.id, email: user.email, name: user.name, phone: user.phone }, admin: !user?.id });
const routes = [
  ['POST', /^auth\/register$/, register], ['POST', /^auth\/login$/, login], ['POST', /^auth\/logout$/, logout, 'customer?'], ['GET', /^auth\/me$/, ME, 'customer'],
  ['GET', /^products$/, catalog], ['POST', /^orders$/, createOrder, 'customer'], ['GET', /^orders$/, myOrders, 'customer'],
  ['GET', /^orders\/([\w-]+)$/, getThread, 'customer'], ['POST', /^orders\/([\w-]+)\/messages$/, postMessage, 'customer'], ['POST', /^orders\/([\w-]+)\/cancel$/, cancelOrder, 'customer'],
  ['POST', /^admin\/login$/, adminLogin], ['POST', /^admin\/logout$/, logout, 'admin?'], ['GET', /^admin\/me$/, ME, 'admin'],
  ['GET', /^admin\/products$/, adminProducts, 'admin'], ['POST', /^admin\/products()$/, saveProduct, 'admin'], ['PUT', /^admin\/products\/(\d+)$/, saveProduct, 'admin'], ['DELETE', /^admin\/products\/(\d+)$/, deleteProduct, 'admin'],
  ['GET', /^admin\/orders$/, adminOrders, 'admin'], ['GET', /^admin\/orders\/([\w-]+)$/, getThread, 'admin'], ['POST', /^admin\/orders\/([\w-]+)\/messages$/, postMessage, 'admin'], ['PUT', /^admin\/orders\/([\w-]+)\/status$/, setStatus, 'admin'],
];
async function session(req, aud) {
  const c = verify(readCookie(req, COOKIE[aud]), aud); if (!c) return null;
  if (aud === 'admin') return c.ver === (+(await S.get('adminver')) || 0) ? { id: null } : null;
  const u = await gj('user:' + c.sub); return u && u.ver === c.ver ? u : null; // ver : révocation à la déconnexion
}
export default async function handler(req, res) {
  try {
    S = getStore();
    const path = new URL(req.url, 'http://x').pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
    const route = routes.map(r => [r, r[1].exec(path)]).find(([r, mm]) => mm && r[0] === req.method);
    if (!route) throw fail(routes.some(r => r[1].test(path)) ? 405 : 404, 'Introuvable.');
    const [[, , fn, need], m] = route;
    if (req.method !== 'GET') { // anti-CSRF : Origin identique + JSON obligatoire (+ cookies SameSite=Strict)
      const o = req.headers.origin;
      if (o && new URL(o).host !== req.headers.host) throw fail(403, 'Origine refusée.');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'Content-Type JSON requis.');
    }
    const aud = need?.replace('?', '') || null;
    const user = aud ? await session(req, aud) : null;
    if (aud && !user && !need.endsWith('?')) throw fail(401, 'Connexion requise.');
    await seed();
    await fn({ req, res, m, b: req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req), ip: clientIp(req), user, aud });
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Erreur serveur.' }, e.status === 429 ? { 'Retry-After': '900' } : {});
  }
}
