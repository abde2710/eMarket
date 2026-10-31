'use strict';
/* Aucune injection HTML : tout le contenu dynamique passe par textContent (anti-XSS). */
const money = n => new Intl.NumberFormat('fr-FR').format(n) + ' Ar';
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k in el && k !== 'list') el[k] = v; else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const clear = el => { el.replaceChildren(); return el; };
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
async function api(path, method = 'GET', body) {
  let r; try { r = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }); }
  catch { throw new Error('Réseau indisponible.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Erreur.'), { status: r.status });
  return d;
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) e.target.closest('dialog').close(); });
document.addEventListener('click', e => { if (e.target.tagName === 'DIALOG') e.target.close(); });
const fmtDate = s => new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const field = (label, input, full) => h('div', { class: 'field' + (full ? ' full' : '') }, h('label', { htmlFor: input.id }, label), input);

/* Ticket client ↔ vendeur (partagé boutique/admin). base = 'orders' ou 'admin/orders', me = 'client' | 'vendeur' */
function ticketView(box, id, base, me) {
  let timer; const list = h('div', { class: 'thread', tabIndex: 0, 'aria-live': 'polite' }); const err = h('div', { class: 'err' });
  const input = h('input', { id: 'msgText', maxLength: 1000, placeholder: 'Votre message…', autocomplete: 'off', 'aria-label': 'Message' });
  const form = h('form', { class: 'msgform', onsubmit: async e => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return; err.textContent = '';
    try { await api(`${base}/${id}/messages`, 'POST', { text }); input.value = ''; await load(); } catch (x) { err.textContent = x.message; }
  } }, input, h('button', { class: 'btn', type: 'submit' }, 'Envoyer'));
  const head = h('div');
  async function load() {
    const d = await api(`${base}/${id}`);
    head.replaceChildren(h('div', { class: 'row' }, h('strong', null, d.order.id), h('span', { class: 'pill' }, d.order.status), h('span', null, money(d.order.total))),
      h('small', null, d.order.items.map(i => `${i.name} × ${i.qty}`).join(' · ')));
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.replaceChildren(...d.messages.map(m => h('div', { class: 'msg ' + (m.role === 'système' ? 'sys' : m.role === me ? 'me' : '') }, m.role === 'système' ? null : h('small', null, (m.role === 'client' ? 'Client' : 'Vendeur') + ' · ' + fmtDate(m.at)), m.text)));
    if (atBottom || !list.dataset.init) list.scrollTop = list.scrollHeight; list.dataset.init = 1;
    form.hidden = d.order.status === 'Annulée';
    return d;
  }
  box.replaceChildren(head, list, err, form);
  load().catch(x => { err.textContent = x.message; });
  timer = setInterval(() => { if (!document.hidden && box.isConnected) load().catch(() => {}); else if (!box.isConnected) clearInterval(timer); }, 8000);
  return { reload: load, stop: () => clearInterval(timer) };
}
