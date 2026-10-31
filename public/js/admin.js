'use strict';
const root = $('#root'); let products = [], orders = [], ticket = null;
const STATUTS = ['En attente', 'En préparation', 'Livrée', 'Annulée'];

function loginView(msg) {
  const err = h('div', { class: 'err', role: 'alert' }, msg || ''), u = h('input', { id: 'u', autocomplete: 'username', required: true }), p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true });
  root.replaceChildren(h('form', { class: 'login', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { await api('admin/login', 'POST', { username: u.value, password: p.value }); start(); } catch (x) { err.textContent = x.message; p.value = ''; }
  } }, h('h2', null, '🔐 Espace administrateur'), field('Identifiant', u), field('Mot de passe', p), err, h('button', { class: 'btn block', type: 'submit' }, 'Se connecter')));
  $('#logoutBtn').hidden = true;
}
async function start() {
  try { await api('admin/me'); } catch { return loginView(); }
  $('#logoutBtn').hidden = false; await refresh(); panel('orders');
}
async function refresh() { try { [products, orders] = [(await api('admin/products')).products, (await api('admin/orders')).orders]; } catch (e) { if (e.status === 401) return loginView('Session expirée.'); toast(e.message); } }
function panel(tab) {
  const soon = products.filter(p => p.stock > 0 && daysTo(p.expiry) >= 0 && daysTo(p.expiry) < 7).length, revenue = orders.filter(o => o.status !== 'Annulée').reduce((s, o) => s + o.total, 0);
  const stats = [['Produits', products.length], ['Commandes', orders.length], ['Rupture', products.filter(p => p.stock <= 0).length], ['Bientôt périmés', soon], ['Chiffre d’affaires', money(revenue)]];
  const tabBtn = (id, label) => h('button', { role: 'tab', 'aria-selected': tab === id, onclick: () => panel(id) }, label, id === 'orders' && orders.some(o => o.unread?.admin) && h('span', { class: 'dot' }, ' ●'));
  root.replaceChildren(h('div', { class: 'stats' }, stats.map(([l, v]) => h('div', { class: 'stat' }, h('small', null, l), h('strong', null, v)))),
    h('div', { class: 'tabs', role: 'tablist' }, tabBtn('orders', 'Commandes & tickets'), tabBtn('products', 'Produits')), tab === 'orders' ? ordersPanel() : productsPanel());
}
const daysTo = d => Math.ceil((new Date(d + 'T23:59:59') - new Date()) / 864e5);
const td = (label, ...c) => h('td', { 'data-label': label }, ...c);

function ordersPanel() {
  const rows = orders.map(o => h('tr', null, td('Commande', h('strong', null, o.id), o.unread?.admin && h('span', { class: 'dot', title: 'Nouveau message' }, ' ●')), td('Client', `${o.customer.name} · ${o.customer.phone}`), td('Montant', money(o.total)), td('Réception', o.receive),
    td('Statut', h('select', { 'aria-label': 'Statut ' + o.id, disabled: o.status === 'Annulée', onchange: async e => { try { await api(`admin/orders/${o.id}/status`, 'PUT', { status: e.target.value }); await refresh(); panel('orders'); } catch (x) { toast(x.message); e.target.value = o.status; } } }, STATUTS.map(s => h('option', { selected: s === o.status }, s)))),
    h('td', { class: 'act' }, h('button', { class: 'btn sm', onclick: () => openTicket(o) }, '💬 Ticket'))));
  return h('div', { class: 'panel' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Commande', 'Client', 'Montant', 'Réception', 'Statut', ''].map(x => h('th', null, x)))), h('tbody', null, rows.length ? rows : h('tr', null, h('td', null, 'Aucune commande.')))));
}
function openTicket(o) {
  ticket?.stop(); $('#dlgTitle').textContent = `Ticket ${o.id} — ${o.customer.name}`; const box = h('div');
  $('#dlgBody').replaceChildren(h('small', null, `${o.customer.phone} · ${o.customer.address} · ${o.payment}`), box);
  ticket = ticketView(box, o.id, 'admin/orders', 'vendeur'); const d = $('#dlg'); d.showModal();
  d.addEventListener('close', async () => { ticket?.stop(); await refresh(); panel('orders'); }, { once: true });
}
function productsPanel() {
  const rows = products.map(p => h('tr', null, td('Produit', p.name), td('Prix', money(p.price)), td('Stock', p.stock), td('Péremption', p.expiry), td('Promo', p.old > p.price ? 'Oui' : 'Non'),
    h('td', { class: 'act' }, h('button', { class: 'btn ghost sm', onclick: () => productForm(p) }, 'Modifier'), ' ', h('button', { class: 'btn danger sm', onclick: async () => { if (!confirm('Supprimer ce produit ?')) return; try { await api('admin/products/' + p.id, 'DELETE'); await refresh(); panel('products'); } catch (x) { toast(x.message); } } }, 'Supprimer'))));
  return h('div', { class: 'panel' }, h('button', { class: 'btn', onclick: () => productForm() }, '＋ Ajouter un produit'), h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Produit', 'Prix', 'Stock', 'Péremption', 'Promo', ''].map(x => h('th', null, x)))), h('tbody', null, rows)));
}
function productForm(p) {
  const i = (id, type, v, extra) => h('input', { id, type, value: v ?? '', ...extra }), err = h('div', { class: 'err', role: 'alert' });
  const f = { name: i('fN', 'text', p?.name, { maxLength: 80, required: true }), price: i('fP', 'number', p?.price, { min: 1, step: 1, required: true }), stock: i('fS', 'number', p?.stock ?? 0, { min: 0, step: 1, required: true }), old: i('fO', 'number', p?.old || '', { min: 0, step: 1 }),
    expiry: i('fE', 'date', p?.expiry, { required: true }), emoji: i('fM', 'text', p?.emoji ?? '🛒', { maxLength: 8 }), file: i('fF', 'file', '', { accept: 'image/png,image/jpeg,image/webp' }) };
  let image = p?.image || '';
  f.file.addEventListener('change', () => { const file = f.file.files[0]; if (!file) return; if (file.size > 110_000) { toast('Image trop lourde (110 Ko max).'); f.file.value = ''; return; } const r = new FileReader(); r.onload = () => { image = r.result; }; r.readAsDataURL(file); });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { await api('admin/products' + (p ? '/' + p.id : ''), p ? 'PUT' : 'POST', { name: f.name.value, price: +f.price.value, stock: +f.stock.value, old: +f.old.value || 0, expiry: f.expiry.value, emoji: f.emoji.value, bg: p?.bg || '#edf0ff', image });
      $('#dlg').close(); await refresh(); panel('products'); toast('Produit enregistré.'); } catch (x) { err.textContent = x.message; }
  } }, h('div', { class: 'formgrid' }, field('Nom du produit', f.name, true), field('Prix (Ar)', f.price), field('Stock', f.stock), field('Ancien prix (promo)', f.old), field('Péremption', f.expiry), field('Emoji (sans photo)', f.emoji), field('Photo (PNG/JPEG/WebP, 110 Ko max)', f.file, true)), err, h('button', { class: 'btn block', type: 'submit' }, 'Enregistrer'));
  $('#dlgTitle').textContent = p ? 'Modifier le produit' : 'Ajouter un produit'; $('#dlgBody').replaceChildren(form); $('#dlg').showModal();
}
$('#logoutBtn').addEventListener('click', async () => { await api('admin/logout', 'POST').catch(() => {}); loginView('Déconnecté.'); });
start();
