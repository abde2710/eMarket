import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pages = ['public/index.html', 'public/admin.html'];

test('CSP stricte : aucun script/style/handler inline dans les pages', () => {
  for (const p of pages) {
    const html = read(p);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), p + ' : script inline');
    assert.ok(!/<style/i.test(html), p + ' : style inline');
    assert.ok(!/\son[a-z]+\s*=/i.test(html), p + ' : handler on*= inline');
    assert.ok(!/\sstyle\s*=/i.test(html), p + ' : attribut style inline');
    assert.match(html, /name="viewport"/);
  }
});
test('le JS client n’utilise jamais innerHTML / eval / document.write', () => {
  for (const f of ['common.js', 'shop.js', 'admin.js']) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|document\.write/.test(read('public/js/' + f)), f);
});
test('vercel.json : en-têtes de sécurité', () => {
  const v = JSON.parse(read('vercel.json')); const h = Object.fromEntries(v.headers.flatMap(x => x.headers).map(x => [x.key, x.value]));
  assert.match(h['Content-Security-Policy'], /default-src 'self'/); assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(h['Content-Security-Policy'], /script-src 'self'(;|$)/);
  for (const k of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(h[k], k);
});
test('aucun secret en dur dans le dépôt', () => {
  for (const f of [...pages, 'public/js/shop.js', 'public/js/admin.js']) assert.ok(!/emarket2026/.test(read(f)), f); // ancien mot de passe en dur
  for (const f of ['api/[...slug].js', 'lib/core.js', 'server.js']) assert.ok(!/scrypt\$\d+\$/.test(read(f)), f + ' : hash en dur');
});
