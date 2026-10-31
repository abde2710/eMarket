import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);

export const prod = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET (32 caractères minimum) requis');
  return s;
}

/* ---------- Mots de passe : scrypt (OWASP : N=2^16, r=8, p=2) ---------- */
const R = 8, P = 2;
export async function hashPassword(pw, logN = +process.env.SCRYPT_LOG_N || 16) {
  const salt = crypto.randomBytes(16), N = 2 ** logN;
  const h = await scrypt(pw.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: 256 * N * R });
  return ['scrypt', logN, R, P, salt.toString('base64url'), h.toString('base64url')].join('$');
}
export async function verifyPassword(pw, stored) {
  try {
    const [t, l, r, p, s, h] = String(stored).split('$');
    if (t !== 'scrypt' || !(+l >= 10 && +l <= 20)) return false;
    const N = 2 ** +l, exp = Buffer.from(h, 'base64url');
    const got = await scrypt(pw.normalize('NFKC'), Buffer.from(s, 'base64url'), exp.length, { N, r: +r, p: +p, maxmem: 256 * N * +r });
    return crypto.timingSafeEqual(got, exp);
  } catch { return false; }
}
let dummy;
/** Égalise le temps de réponse quand le compte n'existe pas (anti-énumération). */
export async function fakeVerify(pw) { dummy ??= await hashPassword('dummy-password-0'); await verifyPassword(pw, dummy); }

/* ---------- Jetons de session signés (HMAC-SHA256, expiration, audience) ---------- */
const mac = d => crypto.createHmac('sha256', secret()).update(d).digest();
export function sign(claims, ttlSec) {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return body + '.' + mac(body).toString('base64url');
}
export function verify(tok, aud) {
  try {
    const [b, s] = String(tok).split('.');
    const exp = mac(b), got = Buffer.from(s, 'base64url');
    if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
    const c = JSON.parse(Buffer.from(b, 'base64url'));
    return c.aud === aud && c.exp > Date.now() / 1000 ? c : null;
  } catch { return null; }
}
export const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

/* ---------- Stockage : mémoire (dev/tests) ou Upstash Redis REST (production) ---------- */
export function memoryStore() {
  const m = new Map(), exp = new Map(), sets = new Map(), lists = new Map();
  const alive = k => { if (exp.has(k) && exp.get(k) < Date.now()) { m.delete(k); exp.delete(k); } return m.has(k); };
  const S = k => sets.get(k) ?? sets.set(k, new Set()).get(k);
  return {
    async get(k) { return alive(k) ? m.get(k) : null; },
    async set(k, v, o = {}) { if (o.nx && alive(k)) return false; m.set(k, String(v)); if (o.ex) exp.set(k, Date.now() + o.ex * 1000); return true; },
    async del(k) { m.delete(k); exp.delete(k); },
    async incr(k, n = 1) { const v = (alive(k) ? +m.get(k) : 0) + n; m.set(k, String(v)); return v; },
    async expire(k, s) { exp.set(k, Date.now() + s * 1000); },
    async sadd(k, v) { S(k).add(v); }, async srem(k, v) { S(k).delete(v); }, async smembers(k) { return [...S(k)]; },
    async rpush(k, v) { (lists.get(k) ?? lists.set(k, []).get(k)).push(v); },
    async lrange(k) { return [...(lists.get(k) ?? [])]; },
  };
}
export function upstashStore(url, token) {
  const c = async (...a) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(a) });
    const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
  };
  return {
    get: k => c('GET', k), del: k => c('DEL', k), incr: (k, n = 1) => c('INCRBY', k, n), expire: (k, s) => c('EXPIRE', k, s),
    set: async (k, v, o = {}) => { const a = ['SET', k, String(v)]; if (o.nx) a.push('NX'); if (o.ex) a.push('EX', o.ex); return (await c(...a)) === 'OK'; },
    sadd: (k, v) => c('SADD', k, v), srem: (k, v) => c('SREM', k, v), smembers: k => c('SMEMBERS', k),
    rpush: (k, v) => c('RPUSH', k, v), lrange: k => c('LRANGE', k, 0, -1),
  };
}
let store;
export const setStore = s => { store = s; };
export function getStore() {
  if (store) return store;
  const e = process.env, url = e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL, tok = e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN;
  if (url && tok) return (store = upstashStore(url, tok));
  if (prod()) throw new Error('Base Redis non configurée (UPSTASH_REDIS_REST_URL / _TOKEN)');
  return (store = memoryStore());
}
