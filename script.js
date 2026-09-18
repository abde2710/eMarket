const seedProducts = [
    { id: 1, name: "Nougat Robert en sachet", price: 1500, old: 1400, stock: 34, expiry: "2026-12-20", image: svg("🍬", "#d9f0e7") },
    { id: 2, name: "Café soluble Black 3en1 30g", price: 1235, old: 1300, stock: 18, expiry: "2027-03-10", image: svg("☕", "#171717") },
    { id: 3, name: "Eau de source 50cl", price: 1425, old: 1500, stock: 40, expiry: "2027-05-12", image: svg("💧", "#dff3ff") },
    { id: 4, name: "Kit 3 en 1 couvert en bois biodégradable", price: 1900, old: 2000, stock: 12, expiry: "2029-01-01", image: svg("🥢", "#efe2bd") },
    { id: 5, name: "Boîte en carton fenêtre pour sushis", price: 1900, old: 2000, stock: 9, expiry: "2029-01-01", image: svg("🍣", "#202020") },
    { id: 6, name: "Jus de fruits orange 20cl", price: 2090, old: 2200, stock: 23, expiry: "2026-08-20", image: svg("🍊", "#ffe9a7") },
    { id: 7, name: "Nectar multifruits 20cl", price: 2366, old: 2490, stock: 16, expiry: "2026-08-24", image: svg("🧃", "#fff0d2") },
    { id: 8, name: "Bougie d'anniversaire chiffre 5", price: 2375, old: 2500, stock: 7, expiry: "2029-01-01", image: svg("🎂", "#ffd1e0") },
    { id: 9, name: "Jus de pomme en brique 20cl", price: 2375, old: 2500, stock: 21, expiry: "2026-08-22", image: svg("🍏", "#e9f5dc") },
    { id: 10, name: "Allumettes salon", price: 2375, old: 2500, stock: 5, expiry: "2029-01-01", image: svg("🔥", "#dfe7f5") },
    { id: 11, name: "Biscuits chocolat", price: 1800, old: 2000, stock: 30, expiry: "2026-09-02", image: svg("🍪", "#ead4bd") },
    { id: 12, name: "Lait UHT 1L", price: 3200, old: 0, stock: 14, expiry: "2026-08-19", image: svg("🥛", "#f3f3f3") }
];
let products = JSON.parse(localStorage.getItem("emarket_products") || "null") || seedProducts;
let cart = JSON.parse(localStorage.getItem("emarket_cart") || "{}");
let orders = JSON.parse(localStorage.getItem("emarket_orders") || "[]");
let customer = JSON.parse(localStorage.getItem("emarket_customer") || "{}");
const money = n => new Intl.NumberFormat("fr-FR").format(n) + " Ar";
const today = new Date();
function svg(emoji, bg) { return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><rect width="100%" height="100%" rx="28" fill="${bg}"/><text x="50%" y="56%" text-anchor="middle" font-size="145">${emoji}</text></svg>`) }
function save() { localStorage.setItem("emarket_products", JSON.stringify(products)); localStorage.setItem("emarket_cart", JSON.stringify(cart)); localStorage.setItem("emarket_orders", JSON.stringify(orders)) }
function daysTo(date) { return Math.ceil((new Date(date + "T23:59:59") - new Date()) / 86400000) }
function activeProducts() { return products.filter(p => p.stock > 0 && daysTo(p.expiry) >= 0) }
function render() {
    const q = document.getElementById("search").value.toLowerCase().trim();
    const list = activeProducts().filter(p => p.name.toLowerCase().includes(q));
    document.getElementById("countLabel").textContent = list.length + " produit" + (list.length > 1 ? "s" : "");
    const el = document.getElementById("catalog");
    if (!list.length) { el.innerHTML = '<div class="empty">Aucun produit ne correspond à votre recherche.</div>'; return }
    el.innerHTML = list.map(p => {
        const qty = cart[p.id] || 0, d = daysTo(p.expiry), promo = p.old && p.old > p.price;
        return `<article class="card">
      <div class="photo">${promo ? '<div class="badge">-' + Math.round((1 - p.price / p.old) * 100) + '%</div>' : ''}${d < 7 ? `<div class="soon">⏰ Expire dans ${d} j</div>` : ''}<img src="${p.image}" alt="${esc(p.name)}"></div>
      <div class="body"><div class="name">${esc(p.name)}</div><div class="stock">Stock : ${p.stock}</div>
      <div class="prices"><span class="price">${money(p.price)}</span>${promo ? `<span class="old">${money(p.old)}</span>` : ""}</div>
      <div class="controls"><button onclick="changeQty(${p.id},-1)">−</button><div class="qty">${qty}</div><button onclick="changeQty(${p.id},1)">+</button></div>
      ${qty ? `<div class="lineTotal">Total : <b>${money(qty * p.price)}</b></div>` : ""}
      </div></article>`
    }).join("");
}
function esc(s) { return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) }
function changeQty(id, delta) { const p = products.find(x => x.id === id); let q = (cart[id] || 0) + delta; q = Math.max(0, Math.min(p.stock, q)); if (q) cart[id] = q; else delete cart[id]; save(); render() }
document.getElementById("search").addEventListener("input", render);
function openCheckout() {
    const items = Object.entries(cart).map(([id, q]) => ({ p: products.find(x => x.id == id), q })).filter(x => x.p);
    if (!items.length) { toast("Votre panier est vide."); return }
    let warning = "";
    items.forEach(x => { if (!x.p || x.p.stock < x.q || daysTo(x.p.expiry) < 0) { delete cart[x.p.id]; warning = "Certains produits ne sont plus disponibles et ont été retirés du panier." } })
    if (warning) { save(); render(); toast(warning); return }
    document.getElementById("checkoutNotice").innerHTML = "";
    document.getElementById("summary").innerHTML = summaryHtml(items);
    document.getElementById("cName").value = customer.name || "";
    document.getElementById("cPhone").value = customer.phone || "";
    document.getElementById("cAddress").value = customer.address || "";
    document.getElementById("checkoutModal").classList.add("open");
}
function summaryHtml(items) { let total = items.reduce((s, x) => s + x.q * x.p.price, 0); return items.map(x => `<div class="sumrow"><span>${esc(x.p.name)} × ${x.q}</span><b>${money(x.q * x.p.price)}</b></div>`).join("") + `<div class="sumrow total"><span>Total</span><b>${money(total)}</b></div>` }
function closeModal(id) { document.getElementById(id).classList.remove("open") }
function confirmOrder() {
    const items = Object.entries(cart).map(([id, q]) => ({ p: products.find(x => x.id == id), q })).filter(x => x.p);
    const invalid = items.filter(x => x.p.stock < x.q || daysTo(x.p.expiry) < 0);
    if (invalid.length) { invalid.forEach(x => delete cart[x.p.id]); save(); render(); document.getElementById("checkoutNotice").innerHTML = '<div class="notice">⚠ Un produit n’est plus disponible. Le panier a été mis à jour. Vérifiez le récapitulatif.</div>'; document.getElementById("summary").innerHTML = summaryHtml(items.filter(x => x.p.stock >= x.q)); return }
    const name = document.getElementById("cName").value.trim(), phone = document.getElementById("cPhone").value.trim(), address = document.getElementById("cAddress").value.trim();
    if (!name || !phone || !address) { toast("Veuillez remplir votre nom, téléphone et adresse."); return }
    customer = { name, phone, address }; localStorage.setItem("emarket_customer", JSON.stringify(customer));
    const total = items.reduce((s, x) => s + x.q * x.p.price, 0);
    items.forEach(x => x.p.stock -= x.q);
    const order = { id: "EM-" + Date.now().toString().slice(-7), date: new Date().toLocaleString("fr-FR"), customer: { ...customer }, items: items.map(x => ({ id: x.p.id, name: x.p.name, qty: x.q, unit: x.p.price })), total, payment: document.querySelector('input[name="pay"]:checked').value, receive: document.querySelector('input[name="receive"]:checked').value, status: "En attente" };
    orders.unshift(order); cart = {}; save(); render(); closeModal("checkoutModal"); toast("Commande " + order.id + " confirmée 🎉");
}
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 3000) }
function openAdmin() { document.getElementById("customerView").style.display = "none"; document.getElementById("adminView").style.display = "block"; window.scrollTo(0, 0) }
function closeAdmin() { document.getElementById("adminView").style.display = "none"; document.getElementById("customerView").style.display = "block"; render() }
function loginAdmin() {
    if (document.getElementById("loginUser").value === "admin" && document.getElementById("loginPass").value === "emarket2026") { document.getElementById("loginBox").style.display = "none"; document.getElementById("adminPanel").style.display = "block"; renderAdmin() } else toast("Identifiant ou mot de passe incorrect.")
}
function renderAdmin() {
    const exp = activeProducts().filter(p => daysTo(p.expiry) < 7).length, out = products.filter(p => p.stock <= 0).length, revenue = orders.reduce((s, o) => s + o.total, 0);
    document.getElementById("stats").innerHTML = [["Produits", products.length], ["Commandes", orders.length], ["Rupture", out], ["Bientôt périmés", exp], ["Chiffre d'affaires", money(revenue)]].map(x => `<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
    document.getElementById("productTable").innerHTML = products.map(p => `<tr><td>${esc(p.name)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td>${p.expiry}</td><td>${p.old && p.old > p.price ? "Oui" : "Non"}</td><td><button class="mini" onclick="editProduct(${p.id})">Modifier</button> <button class="mini danger" onclick="deleteProduct(${p.id})">Supprimer</button></td></tr>`).join("");
    document.getElementById("orderTable").innerHTML = orders.map(o => `<tr><td>${esc(o.customer.name)}<br><small>${esc(o.customer.phone)}</small></td><td>${money(o.total)}</td><td>${o.payment}</td><td>${o.receive}</td><td><select onchange="setStatus('${o.id}',this.value)">${["En attente", "En préparation", "Livrée"].map(s => `<option ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td></tr>`).join("") || '<tr><td colspan="5">Aucune commande.</td></tr>';
}
function adminTab(tab, btn) { document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("active")); btn.classList.add("active"); document.getElementById("productsTab").style.display = tab === "products" ? "block" : "none"; document.getElementById("ordersTab").style.display = tab === "orders" ? "block" : "none" }
function newProduct() { document.getElementById("productModalTitle").textContent = "Ajouter un produit";["pId", "pName", "pPrice", "pStock", "pOld", "pExpiry", "pImage"].forEach(x => document.getElementById(x).value = ""); document.getElementById("pImageFile").value = ""; document.getElementById("pImagePreview").style.display = "none"; document.getElementById("productModal").classList.add("open") }
function editProduct(id) { const p = products.find(x => x.id === id); document.getElementById("productModalTitle").textContent = "Modifier le produit"; document.getElementById("pId").value = p.id; document.getElementById("pName").value = p.name; document.getElementById("pPrice").value = p.price; document.getElementById("pStock").value = p.stock; document.getElementById("pOld").value = p.old || ""; document.getElementById("pExpiry").value = p.expiry; document.getElementById("pImage").value = p.image; document.getElementById("pImageFile").value = ""; const preview = document.getElementById("pImagePreview"); preview.src = p.image; preview.style.display = "block"; document.getElementById("productModal").classList.add("open") }
document.getElementById("pImageFile").addEventListener("change", function () {
    const file = this.files && this.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Veuillez choisir une image."); this.value = ""; return }
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById("pImage").value = e.target.result;
        const preview = document.getElementById("pImagePreview");
        preview.src = e.target.result;
        preview.style.display = "block";
    };
    reader.readAsDataURL(file);
});

function saveProduct() {
    const id = document.getElementById("pId").value, obj = { name: document.getElementById("pName").value.trim(), price: +document.getElementById("pPrice").value, stock: +document.getElementById("pStock").value, old: +document.getElementById("pOld").value || 0, expiry: document.getElementById("pExpiry").value, image: document.getElementById("pImage").value.trim() || (id ? products.find(x => x.id == id).image : svg("🛒", "#edf0ff")) };
    if (!obj.name || !obj.price || !obj.expiry) { toast("Nom, prix et date sont obligatoires."); return }
    if (id) { Object.assign(products.find(x => x.id == id), obj) } else { obj.id = Date.now(); products.push(obj) }
    save(); closeModal("productModal"); renderAdmin(); render(); toast("Produit enregistré.")
}
function deleteProduct(id) { if (confirm("Supprimer ce produit ?")) { products = products.filter(p => p.id !== id); delete cart[id]; save(); renderAdmin(); render(); } }
function setStatus(id, status) { const o = orders.find(x => x.id === id); if (o) { o.status = status; save(); renderAdmin(); } }
render();