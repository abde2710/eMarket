import http from 'node:http';
import { setStore, memoryStore, hashPassword } from '../lib/core.js';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.SCRYPT_LOG_N = '10'; // rapide pour les tests
process.env.ADMIN_USERNAME = 'boss';
process.env.ADMIN_PASSWORD_HASH = await hashPassword('Admin-Secret-2026!', 10);
const { default: handler } = await import('../api/[...slug].js');

export async function start() {
  setStore(memoryStore());
  const srv = http.createServer(handler); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const mk = () => { // client HTTP avec cookie jar
    const jar = {};
    const call = async (method, path, body, headers = {}) => {
      const h = { 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...headers };
      if (headers['content-type'] === null) delete h['content-type'];
      const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const c of r.headers.getSetCookie()) { const [kv, ...attrs] = c.split('; '); const [k, v] = kv.split('='); if (/Max-Age=0/.test(attrs.join(';'))) delete jar[k]; else jar[k] = v; r.setCookie = c; }
      let data = null; try { data = await r.json(); } catch {}
      return { status: r.status, data, res: r, jar };
    };
    return { call, jar, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
  };
  return { mk, close: () => srv.close() };
}
export const user = (n = 1) => ({ email: `client${n}@example.mg`, password: 'Mot-de-passe-solide-' + n, name: 'Client ' + n, phone: '034 12 345 6' + n });
export const adminCreds = { username: 'boss', password: 'Admin-Secret-2026!' };
