'use strict';
let products = [], me = null, cart = {}, ticket = null;
try { cart = JSON.parse(localStorage.getItem('emarket_cart') || '{}'); } catch { cart = {}; }
const saveCart = () => { try { localStorage.setItem('emarket_cart', JSON.stringify(cart)); } catch {} };
const daysTo = d => Math.ceil((new Date(d + 'T23:59:59') - new Date()) / 864e5);
const xml = s => String(s).replace(/[&<>"']/g, '');
const picture = p => p.image || 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><rect width="100%" height="100%" rx="28" fill="${p.bg}"/><text x="50%" y="58%" text-anchor="middle" font-size="145">${xml(p.emoji)}</text></svg>`);

async function loadProducts() {
  try { products = (await api('products')).products; } catch (e) { toast(e.message); }
  for (const id of Object.keys(cart)) { const p = products.find(x => x.id === id); if (!p) delete cart[id]; else cart[id] = Math.min(cart[id], p.stock); }
  saveCart(); render();
}
function render() {
  const q = $('#search').value.toLowerCase().trim(), list = products.filter(p => p.name.toLowerCase().includes(q));
  $('#countLabel').textContent = list.length + ' produit' + (list.length > 1 ? 's' : '');
  $('#catalog').replaceChildren(...(list.length ? list.map(card) : [h('div', { class: 'empty' }, 'Aucun produit ne correspond à votre recherche.')]));
  const n = Object.values(cart).reduce((a, b) => a + b, 0), total = Object.entries(cart).reduce((s, [id, q]) => s + q * (products.find(p => p.id === id)?.price || 0), 0);
  $('#cartCount').textContent = n ? `${n} article${n > 1 ? 's' : ''}` : 'Panier vide'; $('#cartTotal').textContent = n ? money(total) : '';
  $('#checkoutBtn').disabled = !n;
}
function card(p) {
  const qty = cart[p.id] || 0, d = daysTo(p.expiry), promo = p.old > p.price;
  return h('article', { class: 'card' },
    h('div', { class: 'photo' }, promo && h('div', { class: 'badge' }, '-' + Math.round((1 - p.price / p.old) * 100) + '%'), d < 7 && h('div', { class: 'soon' }, `⏰ ${d} j`), h('img', { src: picture(p), alt: p.name, loading: 'lazy' })),
    h('div', { class: 'body' }, h('div', { class: 'name' }, p.name), h('div', { class: 'stock' }, 'Stock : ' + p.stock),
      h('div', { class: 'prices' }, h('span', { class: 'price' }, money(p.price)), promo && h('span', { class: 'old' }, money(p.old))),
      h('div', { class: 'controls' }, h('button', { 'aria-label': 'Retirer un', onclick: () => qtyChange(p, -1) }, '−'), h('div', { class: 'qty', 'aria-live': 'polite' }, qty), h('button', { 'aria-label': 'Ajouter un', onclick: () => qtyChange(p, 1) }, '+'))));
}
function qtyChange(p, d) { const q = Math.max(0, Math.min(p.stock, (cart[p.id] || 0) + d)); if (q) cart[p.id] = q; else delete cart[p.id]; saveCart(); render(); }
$('#search').addEventListener('input', render);

/* ---- compte ---- */
async function refreshMe() { try { me = (await api('auth/me')).user; } catch { me = null; } $('#accountBtn').textContent = me ? '👤 ' + me.name.split(' ')[0] : 'Connexion'; }
function authDialog(mode = 'login', then) {
  const dlg = $('#authDlg'), err = h('div', { class: 'err', role: 'alert' }), reg = mode === 'register';
  $('#authTitle').textContent = reg ? 'Créer un compte' : 'Connexion';
  const f = { email: h('input', { id: 'aEmail', type: 'email', autocomplete: 'email', required: true, maxLength: 120 }), pw: h('input', { id: 'aPw', type: 'password', autocomplete: reg ? 'new-password' : 'current-password', required: true, minLength: reg ? 10 : 1, maxLength: 128 }),
    name: h('input', { id: 'aName', autocomplete: 'name', required: true, maxLength: 80 }), phone: h('input', { id: 'aPhone', type: 'tel', autocomplete: 'tel', required: true, maxLength: 20 }) };
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { const d = await api(reg ? 'auth/register' : 'auth/login', 'POST', reg ? { email: f.email.value, password: f.pw.value, name: f.name.value, phone: f.phone.value } : { email: f.email.value, password: f.pw.value });
      me = d.user; await refreshMe(); dlg.close(); toast('Bienvenue ' + me.name + ' !'); then?.(); } catch (x) { err.textContent = x.message; }
  } }, reg && field('Nom', f.name), reg && field('Téléphone', f.phone), field('E-mail', f.email), field(reg ? 'Mot de passe (10 caractères minimum)' : 'Mot de passe', f.pw), err,
    h('button', { class: 'btn block', type: 'submit' }, reg ? 'Créer mon compte' : 'Se connecter'),
    h('button', { class: 'btn ghost block', type: 'button', onclick: () => authDialog(reg ? 'login' : 'register', then) }, reg ? 'J’ai déjà un compte' : 'Créer un compte'));
  $('#authBody').replaceChildren(form); if (!dlg.open) dlg.showModal();
}

/* ---- commande ---- */
function openCheckout() {
  if (!Object.keys(cart).length) return toast('Votre panier est vide.');
  if (!me) { authDialog('login', openCheckout); return; }
  const items = Object.entries(cart).map(([id, q]) => ({ p: products.find(x => x.id === id), q })).filter(x => x.p), total = items.reduce((s, x) => s + x.q * x.p.price, 0);
  const err = h('div', { class: 'err', role: 'alert' }), addr = h('textarea', { id: 'cAddr', required: true, maxLength: 300, autocomplete: 'street-address' }), note = h('textarea', { id: 'cNote', maxLength: 1000, placeholder: 'Précisions pour le vendeur (horaire, repère…)' });
  addr.value = localStorage.getItem('emarket_addr') || '';
  const radio = (name, vals) => h('div', { class: 'choice' }, vals.map((v, i) => h('label', null, h('input', { type: 'radio', name, value: v, checked: i === 0 }), v)));
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { const d = await api('orders', 'POST', { items: items.map(x => ({ id: x.p.id, qty: x.q })), address: addr.value, note: note.value, receive: form.receive.value, pay: form.pay.value });
      try { localStorage.setItem('emarket_addr', addr.value); } catch {} cart = {}; saveCart(); $('#checkoutDlg').close(); await loadProducts(); toast('Commande ' + d.order.id + ' envoyée 🎉'); openOrders(d.order.id);
    } catch (x) { err.textContent = x.message; if (x.status === 409) loadProducts(); if (x.status === 401) { me = null; refreshMe(); } }
  } }, h('div', { class: 'summary' }, items.map(x => h('div', { class: 'sumrow' }, h('span', null, `${x.p.name} × ${x.q}`), h('b', null, money(x.q * x.p.price)))), h('div', { class: 'sumrow total' }, h('span', null, 'Total'), h('b', null, money(total)))),
    h('h3', null, 'Livraison'), field('Adresse', addr, true), h('h3', null, 'Mode de réception'), radio('receive', ['Livraison à domicile', 'Retrait sur place']),
    h('h3', null, 'Mode de paiement'), radio('pay', ['Espèces à la livraison', 'Apple Pay']), h('h3', null, 'Message au vendeur (optionnel)'), note, err,
    h('div', { class: 'notice' }, 'Après validation, un ticket est créé : vous pourrez discuter avec le vendeur pour confirmer la commande.'), h('button', { class: 'btn block', type: 'submit' }, '✓ Confirmer la commande'));
  $('#checkoutBody').replaceChildren(form); $('#checkoutDlg').showModal();
}

/* ---- mes commandes / tickets ---- */
async function openOrders(openId) {
  if (!me) return authDialog('login', () => openOrders());
  const dlg = $('#ordersDlg'), body = $('#ordersBody'); ticket?.stop();
  const showList = async () => {
    ticket?.stop(); $('#ordersTitle').textContent = 'Mes commandes';
    let orders = []; try { orders = (await api('orders')).orders; } catch (e) { toast(e.message); }
    body.replaceChildren(
      h('div', { class: 'olist' }, orders.length ? orders.map(o => h('button', { class: 'oitem', onclick: () => showTicket(o.id) }, h('span', null, h('strong', null, o.id), ' ', o.unread?.client && h('span', { class: 'dot', title: 'Nouveau message' }, '●'), h('br'), h('small', null, fmtDate(o.createdAt) + ' · ' + money(o.total))), h('span', { class: 'pill' }, o.status))) : [h('div', { class: 'empty' }, 'Aucune commande pour le moment.')]),
      h('button', { class: 'btn ghost block', onclick: async () => { await api('auth/logout', 'POST'); me = null; dlg.close(); refreshMe(); toast('Déconnecté.'); } }, 'Se déconnecter'));
  };
  const showTicket = id => {
    $('#ordersTitle').textContent = 'Ticket ' + id; const box = h('div');
    body.replaceChildren(h('button', { class: 'btn ghost sm', onclick: showList }, '← Mes commandes'), box,
      h('button', { class: 'btn danger sm block', onclick: async () => { if (!confirm('Annuler cette commande ?')) return; try { await api(`orders/${id}/cancel`, 'POST'); toast('Commande annulée.'); loadProducts(); showTicket(id); } catch (x) { toast(x.message); } } }, 'Annuler la commande'));
    ticket = ticketView(box, id, 'orders', 'client');
  };
  openId ? showTicket(openId) : await showList(); if (!dlg.open) dlg.showModal();
  dlg.addEventListener('close', () => ticket?.stop(), { once: true });
}
$('#accountBtn').addEventListener('click', () => (me ? openOrders() : authDialog()));
$('#checkoutBtn').addEventListener('click', openCheckout);
refreshMe(); loadProducts();
