import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, user, adminCreds } from './helpers.js';

let t, A, B, ADM; const order = { receive: 'Retrait sur place', pay: 'Espèces à la livraison', address: 'Lot 12 Antananarivo' };
before(async () => {
  t = await start();
  A = t.mk(); B = t.mk(); ADM = t.mk();
  await A.post('/api/auth/register', user(1)); await B.post('/api/auth/register', user(2));
  await ADM.call('POST', '/api/admin/login', adminCreds, { 'x-real-ip': '10.1.1.1' });
});
after(() => t.close());

const fresh = async n => { const c = t.mk(); await c.post('/api/auth/register', user(n)); return c; }; // limite de commandes par compte
const firstProduct = async () => (await A.get('/api/products')).data.products[0];

test('catalogue public : produits périmés ou en rupture masqués', async () => {
  const { products } = (await t.mk().get('/api/products')).data;
  assert.ok(products.length > 0); assert.ok(products.every(p => p.stock > 0 && p.expiry >= new Date().toISOString().slice(0, 10)));
});
test('commande : exige une connexion, prix recalculés côté serveur', async () => {
  const p = await firstProduct();
  assert.equal((await t.mk().post('/api/orders', { ...order, items: [{ id: p.id, qty: 1 }] })).status, 401);
  const r = await A.post('/api/orders', { ...order, items: [{ id: p.id, qty: 2, price: 1, unit: 1 }], total: 1 });
  assert.equal(r.status, 201); assert.equal(r.data.order.total, 2 * p.price); assert.equal(r.data.order.userId, undefined);
});
test('commande : quantités/modes invalides refusés', async () => {
  const p = await firstProduct();
  for (const items of [[{ id: p.id, qty: 0 }], [{ id: p.id, qty: -3 }], [{ id: p.id, qty: 1.5 }], [{ id: p.id, qty: 1000 }], [], [{ id: 'zzz', qty: 1 }]])
    assert.ok([400, 409].includes((await A.post('/api/orders', { ...order, items })).status));
  assert.equal((await A.post('/api/orders', { ...order, receive: 'Drone', items: [{ id: p.id, qty: 1 }] })).status, 400);
});
test('stock : jamais de survente (2 clients, dernière unité)', async () => {
  const id = (await ADM.post('/api/admin/products', { name: 'Rare', price: 1000, stock: 1, expiry: '2030-01-01' })).data.product.id;
  const [r1, r2] = await Promise.all([A, B].map(c => c.post('/api/orders', { ...order, items: [{ id, qty: 1 }] })));
  assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
  assert.equal((await ADM.get('/api/admin/products')).data.products.find(p => p.id === id).stock, 0);
});
test('produit périmé : commande refusée', async () => {
  const id = (await ADM.post('/api/admin/products', { name: 'Périmé', price: 500, stock: 5, expiry: '2020-01-01' })).data.product.id;
  assert.equal((await A.post('/api/orders', { ...order, items: [{ id, qty: 1 }] })).status, 409);
});
test('tickets : un client ne lit/écrit/annule QUE ses propres commandes (IDOR)', async () => {
  const p = await firstProduct(), A = await fresh(10);
  const id = (await A.post('/api/orders', { ...order, note: 'Bonjour, livraison avant 17h ?', items: [{ id: p.id, qty: 1 }] })).data.order.id;
  assert.equal((await B.get('/api/orders/' + id)).status, 404);
  assert.equal((await B.post(`/api/orders/${id}/messages`, { text: 'intrus' })).status, 404);
  assert.equal((await B.post(`/api/orders/${id}/cancel`)).status, 404);
  assert.ok(!(await B.get('/api/orders')).data.orders.some(o => o.id === id));
  const th = (await A.get('/api/orders/' + id)).data; assert.ok(th.messages.some(m => m.role === 'client' && m.text.includes('17h')));
});
test('tickets : échange client ↔ vendeur, non-lus, XSS stocké comme texte brut', async () => {
  const p = await firstProduct(), A = await fresh(11);
  const id = (await A.post('/api/orders', { ...order, items: [{ id: p.id, qty: 1 }] })).data.order.id;
  assert.equal((await ADM.post(`/api/admin/orders/${id}/messages`, { text: 'Oui, c’est possible.' })).status, 201);
  assert.equal((await A.get('/api/orders')).data.orders.find(o => o.id === id).unread.client, true);
  const xss = '<img src=x onerror=alert(1)>'; await A.post(`/api/orders/${id}/messages`, { text: xss });
  const msgs = (await ADM.get('/api/admin/orders/' + id)).data.messages;
  assert.equal(msgs.at(-1).text, xss); assert.equal(msgs.at(-1).role, 'client', 'le rôle vient de la session, pas du client');
  assert.equal((await A.post(`/api/orders/${id}/messages`, { text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await A.post(`/api/orders/${id}/messages`, { text: '   ', role: 'vendeur' })).status, 400);
});
test('statut : réservé à l’admin ; annulation remet le stock ; pas de réouverture', async () => {
  const A = await fresh(12);
  const id = (await ADM.post('/api/admin/products', { name: 'Stock test', price: 700, stock: 3, expiry: '2030-01-01' })).data.product.id;
  const oid = (await A.post('/api/orders', { ...order, items: [{ id, qty: 2 }] })).data.order.id;
  assert.equal((await A.put(`/api/admin/orders/${oid}/status`, { status: 'Livrée' })).status, 401);
  assert.equal((await ADM.put(`/api/admin/orders/${oid}/status`, { status: 'Hack' })).status, 400);
  assert.equal((await A.post(`/api/orders/${oid}/cancel`)).status, 200);
  assert.equal((await ADM.get('/api/admin/products')).data.products.find(p => p.id === id).stock, 3);
  assert.equal((await ADM.put(`/api/admin/orders/${oid}/status`, { status: 'En attente' })).status, 409);
  assert.equal((await A.post(`/api/orders/${oid}/messages`, { text: 'encore ?' })).status, 409, 'ticket clos');
});
test('produits : validation côté serveur (prix négatif, image SVG, couleur, date)', async () => {
  const base = { name: 'P', price: 100, stock: 1, expiry: '2030-01-01' };
  for (const bad of [{ price: -5 }, { price: 1.5 }, { stock: -1 }, { name: '' }, { expiry: 'demain' }, { bg: 'red;x' }, { image: 'data:image/svg+xml;base64,PHN2Zz4=' }, { image: 'javascript:alert(1)' }])
    assert.equal((await ADM.post('/api/admin/products', { ...base, ...bad })).status, 400, JSON.stringify(bad));
  assert.equal((await ADM.post('/api/admin/products', { ...base, image: 'data:image/png;base64,iVBORw0KGgo=' })).status, 201);
  assert.equal((await A.post('/api/admin/products', base)).status, 401);
  assert.equal((await A.del('/api/admin/products/1')).status, 401);
});
