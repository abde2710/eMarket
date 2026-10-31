import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, user, adminCreds } from './helpers.js';
import { hashPassword, verifyPassword, sign, verify } from '../lib/core.js';

let t; before(async () => { t = await start(); }); after(() => t.close());

test('hachage : round-trip, sel unique, mauvais mot de passe et hash corrompu rejetés', async () => {
  const h1 = await hashPassword('abcdefghij1', 10), h2 = await hashPassword('abcdefghij1', 10);
  assert.notEqual(h1, h2);
  assert.ok(await verifyPassword('abcdefghij1', h1));
  assert.ok(!(await verifyPassword('abcdefghij2', h1)));
  assert.ok(!(await verifyPassword('abcdefghij1', 'scrypt$10$8$2$AAAA$BBBB')));
  assert.ok(!(await verifyPassword('x', 'n’importe quoi')));
});
test('jetons : signature, altération, expiration, audience', () => {
  const tok = sign({ sub: 'u1', aud: 'customer', ver: 0 }, 60);
  assert.equal(verify(tok, 'customer').sub, 'u1');
  assert.equal(verify(tok, 'admin'), null, 'audience différente');
  const [b, s] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'u1', aud: 'customer', ver: 0, exp: 9e9, role: 'admin' })).toString('base64url');
  assert.equal(verify(forged + '.' + s, 'customer'), null, 'payload modifié');
  assert.equal(verify(b + '.', 'customer'), null);
  assert.equal(verify('abc', 'customer'), null);
  assert.equal(verify(sign({ sub: 'u1', aud: 'customer' }, -10), 'customer'), null, 'expiré');
});

test('inscription : validations, doublon, pas de mass-assignment', async () => {
  const c = t.mk();
  assert.equal((await c.post('/api/auth/register', { ...user(1), email: 'pas-un-email' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...user(1), password: 'court' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...user(1), password: 'motdepasse1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...user(1), phone: '<script>' })).status, 400);
  const ok = await c.post('/api/auth/register', { ...user(1), role: 'admin', ver: 99, hash: 'x' });
  assert.equal(ok.status, 201); assert.equal(ok.data.user.role, undefined); assert.equal(ok.data.user.hash, undefined);
  assert.equal((await t.mk().post('/api/auth/register', { ...user(1), email: 'CLIENT1@example.mg' })).status, 409, 'doublon insensible à la casse');
});
test('cookie de session : HttpOnly + SameSite=Strict, /me fonctionne', async () => {
  const c = t.mk(); await c.post('/api/auth/login', { email: user(1).email, password: user(1).password });
  const sc = (await c.get('/api/auth/me')).res; assert.equal(sc.status, 200);
  const r = await c.post('/api/auth/login', { email: user(1).email, password: user(1).password });
  assert.match(r.res.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict/);
  assert.equal((await c.get('/api/auth/me')).data.user.email, user(1).email);
  assert.equal((await t.mk().get('/api/auth/me')).status, 401);
});
test('connexion : message identique compte inconnu / mauvais mot de passe', async () => {
  const a = await t.mk().post('/api/auth/login', { email: 'inconnu@example.mg', password: 'whatever-long-pw' });
  const b = await t.mk().post('/api/auth/login', { email: user(1).email, password: 'mauvais-mot-de-passe' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.deepEqual(a.data, b.data);
});
test('déconnexion révoque le jeton (rejeu d’un ancien cookie refusé)', async () => {
  const c = t.mk(); await c.post('/api/auth/login', { email: user(1).email, password: user(1).password });
  const stolen = { ...c.jar };
  await c.post('/api/auth/logout');
  const replay = await t.mk().call('GET', '/api/auth/me', undefined, { cookie: `cs=${stolen.cs}` });
  assert.equal(replay.status, 401);
});
test('anti brute-force : 429 après 5 essais', async () => {
  const c = t.mk(); let last;
  for (let i = 0; i < 7; i++) last = await c.post('/api/auth/login', { email: 'victime@example.mg', password: 'essai-numero-' + i + 'xxxx' });
  assert.equal(last.status, 429); assert.ok(last.res.headers.get('retry-after'));
});
test('CSRF : origine étrangère refusée, Content-Type non JSON refusé', async () => {
  const c = t.mk();
  assert.equal((await c.call('POST', '/api/auth/login', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.call('POST', '/api/auth/login', {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await c.call('POST', '/api/auth/logout', undefined, { 'content-type': null })).status, 415);
});

test('admin : mauvais identifiants, bon identifiant, cookie séparé du client', async () => {
  const a = t.mk();
  assert.equal((await a.post('/api/admin/login', { username: 'boss', password: 'faux-mot-de-passe' })).status, 401);
  assert.equal((await a.post('/api/admin/login', { username: 'admin', password: 'emarket2026' })).status, 401, 'ancien mot de passe en dur inactif');
  assert.equal((await a.get('/api/admin/products')).status, 401);
  const ok = await a.post('/api/admin/login', adminCreds); assert.equal(ok.status, 200);
  assert.equal((await a.get('/api/admin/products')).status, 200);
  assert.equal((await a.get('/api/auth/me')).status, 401, 'cookie admin ≠ session client');
});
test('admin : un client connecté ou un jeton client réutilisé n’accède pas aux routes admin', async () => {
  const c = t.mk(); await c.post('/api/auth/login', { email: user(1).email, password: user(1).password });
  assert.equal((await c.get('/api/admin/products')).status, 401);
  assert.equal((await c.get('/api/admin/orders')).status, 401);
  assert.equal((await c.post('/api/admin/products', { name: 'x', price: 1, stock: 1, expiry: '2030-01-01' })).status, 401);
  const swapped = await t.mk().call('GET', '/api/admin/orders', undefined, { cookie: `as=${c.jar.cs}` });
  assert.equal(swapped.status, 401, 'jeton client rejoué comme cookie admin');
});
test('admin : brute-force limité, déconnexion révoque la session', async () => {
  const a = t.mk(); let last;
  for (let i = 0; i < 7; i++) last = await a.post('/api/admin/login', { username: 'boss', password: 'mauvais-' + i + '-motdepasse' });
  assert.equal(last.status, 429);
  const b = t.mk(); // autre IP simulée impossible en local : on vérifie la révocation avec un nouveau jeu de limites
  const h = { 'x-real-ip': '10.0.0.9' };
  assert.equal((await b.call('POST', '/api/admin/login', adminCreds, h)).status, 200);
  const stolen = b.jar.as; await b.post('/api/admin/logout');
  assert.equal((await t.mk().call('GET', '/api/admin/orders', undefined, { cookie: `as=${stolen}` })).status, 401);
});

test('routage Vercel : /api/index?path=… équivaut à /api/…', async () => {
  const a = await t.mk().get('/api/index?path=products');
  assert.equal(a.status, 200); assert.ok(a.data.products.length > 0);
  assert.equal((await t.mk().post('/api/index?path=auth/register', { ...user(7), password: 'court' })).status, 400);
  assert.equal((await t.mk().get('/api/index?path=admin/orders')).status, 401, 'les contrôles d’accès s’appliquent aussi');
});
