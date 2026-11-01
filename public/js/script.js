'use strict';
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR'}).format(value / 100);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel = value => new Date(value.replace(' ','T')+'Z').toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
let currentUser = null, currentCart = {items:[],count:0}, products = [], toastTimer;
async function api(url, method = 'GET', data) {
 const res = await fetch('/api'+url,{method, headers: method === 'GET' ? {} : {'Content-Type':'application/json','X-Velora-Request':'1'}, ...(method !== 'GET' ? {body:JSON.stringify(data || {})} : {})});
 let result;
 try { result = await res.json(); } catch { throw new Error('Cannot reach the server. Open this website through http://localhost:3000.'); }
 if (!res.ok) { const err = new Error(result.error || 'Request failed.'); err.status = res.status; throw err; }
 return result;
}
function toast(message) {
 let el = $('#toast');
 if (!el) { el = document.createElement('div'); el.id='toast'; el.className='toast'; el.setAttribute('role','status'); document.body.append(el); }
 el.textContent=message; el.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.hidden=true,4500);
}
function updateCart(c) { currentCart=c; $('#cart-count').textContent=c.count; }
function empty(title,description,href='jewellery.html',label='Explore Jewellery') {
 return `<div class="empty-state"><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p><a href="${href}" class="gold-btn">${label}</a></div>`;
}
function signInLink(next) { return 'login.html?next='+encodeURIComponent(next); }
function requireSignIn(target, next) {
 if (currentUser) return true;
 target.innerHTML=empty('Sign in to continue','Your orders and receipts are private to your account.',signInLink(next),'Sign In'); return false;
}
function safeNext() {
 const next=new URLSearchParams(location.search).get('next');
 return ['cart.html','checkout.html','orders.html','index.html'].includes(next) || /^receipt\.html\?id=VL-[a-f0-9-]{36}$/.test(next || '') ? next : 'index.html';
}
function bindForm(id, handler) {
 const form=$(id); if(!form)return;
 form.addEventListener('submit',async e=>{
  e.preventDefault(); const button=form.querySelector('[type=submit]'), status=form.querySelector('.form-status');
  if(button.disabled)return;
  button.disabled=true; status.textContent='Please wait…'; status.classList.remove('success');
  try { await handler(Object.fromEntries(new FormData(form)),form,status); }
  catch(err) { status.textContent=err.message; }
  finally { button.disabled=false; }
 });
}
async function renderProducts() {
 const grid=$('.product-container'); if(!grid)return;
 products=(await api('/products')).products;
 const catalogue=location.pathname.endsWith('jewellery.html');
 let category='all';
 function draw() {
  let list=catalogue ? [...products] : products.filter(p=>[1,7,16,21].includes(p.id));
  const q=($('#product-search')?.value || '').trim().toLowerCase();
  list=list.filter(p=>(category==='all' || p.category.toLowerCase()===category) && (p.name+' '+p.category).toLowerCase().includes(q));
  const sort=$('#product-sort')?.value;
  if(sort==='low')list.sort((a,b)=>a.price_paise-b.price_paise);
  if(sort==='high')list.sort((a,b)=>b.price_paise-a.price_paise);
  if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name));
  if($('#product-count'))$('#product-count').textContent=`${list.length} pieces`;
  grid.innerHTML=list.map(p=>`<div class="product-card"><div class="product-image"><img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" loading="lazy"></div><div class="product-info"><h3>${escapeHTML(p.name)}</h3><p class="product-category">${escapeHTML(p.category)}</p><p class="price">${money(p.price_paise)}</p><p class="stock-label">${p.stock ? `${p.stock} available` : 'Out of stock'}</p><button class="product-btn" data-add="${p.id}" ${p.stock ? '' : 'disabled'}>Add to Cart</button></div></div>`).join('') || empty('No pieces found','Try another search or category.');
 }
 document.querySelectorAll('.category-filter a').forEach(link=>link.addEventListener('click',e=>{
  e.preventDefault(); document.querySelectorAll('.category-filter a').forEach(a=>a.classList.remove('active-filter')); link.classList.add('active-filter');
  category=({all:'all',necklaces:'necklace',earrings:'earrings',rings:'ring',pendants:'pendant'})[link.textContent.trim().toLowerCase()] || 'all';
  // Catalogue category labels may be singular or plural; use the seed's exact label.
  if(category==='earrings') category=products.find(p=>p.category.toLowerCase().startsWith('earring'))?.category.toLowerCase() || 'earring';
  draw();
 }));
 $('#product-search')?.addEventListener('input',draw); $('#product-sort')?.addEventListener('change',draw);
 grid.addEventListener('click',async e=>{
  const button=e.target.closest('[data-add]'); if(!button || button.disabled)return;
  button.disabled=true;
  try {
   const id=Number(button.dataset.add); const fresh=await api('/cart'); const existing=fresh.items.find(p=>p.id===id);
   updateCart(await api('/cart/'+id,'PUT',{quantity:(existing?.quantity || 0)+1})); toast('Added to your cart.');
  }catch(err){toast(err.message);}finally{button.disabled=false;}
 });
 draw();
}
function drawCart() {
 const container=$('.cart-items'); if(!container)return;
 container.innerHTML=currentCart.items.length ? currentCart.items.map(p=>`<div class="cart-item"><img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}"><div class="cart-item-info"><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.category)}</p><p class="price">${money(p.price_paise)}</p><small>${p.stock < p.quantity ? `Only ${p.stock} available. Please reduce quantity.` : `Line total: ${money(p.price_paise*p.quantity)}`}</small></div><div class="quantity"><button class="qty-btn" data-id="${p.id}" data-quantity="${p.quantity-1}" aria-label="Decrease quantity of ${escapeHTML(p.name)}">−</button><span>${p.quantity}</span><button class="qty-btn" data-id="${p.id}" data-quantity="${p.quantity+1}" aria-label="Increase quantity of ${escapeHTML(p.name)}" ${p.quantity>=Math.min(99,p.stock)?'disabled':''}>+</button></div><button class="remove-btn" data-id="${p.id}" data-quantity="0">Remove</button></div>`).join('') : empty('Your cart is empty','Discover a piece you will love for years.');
 $('#subtotal').textContent=money(currentCart.subtotal_paise); $('#total').textContent=money(currentCart.total_paise);
 $('#checkout-button').disabled=!currentCart.items.length || currentCart.items.some(p=>p.quantity>p.stock);
}
function summaryHTML(c) {
 return `<h2>Your order</h2>${c.items.map(p=>`<div class="checkout-line"><span>${escapeHTML(p.name)} × ${p.quantity}</span><span>${money(p.price_paise*p.quantity)}</span></div>`).join('')}<div class="summary-row"><span>Shipping</span><span>Free</span></div><div class="summary-total"><span>Total</span><span>${money(c.total_paise)}</span></div><p class="muted">Cash on delivery · Payment due on delivery</p><a href="cart.html" class="subtle-link">Edit cart</a>`;
}
async function loadOrders() {
 const list=$('#orders-list'); if(!list || !requireSignIn(list,'orders.html'))return;
 const {orders}=await api('/orders');
 list.innerHTML=orders.length ? orders.map(o=>`<article class="panel order-card"><div class="order-top"><div><p class="order-ref">${escapeHTML(o.id)}</p><h2>${dateLabel(o.created_at)}</h2><p>${escapeHTML(o.customer_name)} · ${escapeHTML(o.city)}</p></div><span class="badge ${o.status==='Cancelled'?'cancelled':''}">${escapeHTML(o.status)}</span></div><div class="order-bottom"><div><strong>${money(o.total_paise)}</strong><p class="muted">Cash on delivery · ${escapeHTML(o.payment_status)}</p></div><a class="gold-btn" href="receipt.html?id=${encodeURIComponent(o.id)}">View Receipt</a>${o.status==='Placed'?`<button class="text-button" data-cancel="${escapeHTML(o.id)}">Cancel Order</button>`:''}</div></article>`).join('') : empty('No orders yet','Your purchases will appear here after checkout.');
}
async function loadReceipt() {
 const el=$('#receipt-content'); if(!el || !requireSignIn(el,'receipt.html'+location.search))return;
 const id=new URLSearchParams(location.search).get('id');
 if(!id){el.innerHTML=empty('No order selected','Choose an order to view its receipt.','orders.html','View Orders');return;}
 const o=await api('/orders/'+encodeURIComponent(id));
 el.innerHTML=`<div class="receipt-top"><div><p class="logo">VELORA<span>✦</span></p><h1>Order Receipt</h1><p class="muted">${o.status==='Cancelled'?'Cancelled order · No payment collected':'Cash on delivery · Payment pending'}</p></div><span class="badge ${o.status==='Cancelled'?'cancelled':''}">${escapeHTML(o.status)}</span></div><div class="receipt-details"><div><h3>Deliver to</h3><p>${escapeHTML(o.customer_name)}<br>${escapeHTML(o.address)}<br>${escapeHTML(o.city)} — ${escapeHTML(o.pincode)}<br>${escapeHTML(o.phone)}<br>${escapeHTML(o.email)}</p></div><div><h3>Order details</h3><p class="order-ref">${escapeHTML(o.id)}</p><p>${dateLabel(o.created_at)}<br>Payment method: ${escapeHTML(o.payment_method)}<br>Payment status: ${escapeHTML(o.payment_status)}</p></div></div><div class="table-scroll"><table><thead><tr><th scope="col">Item</th><th scope="col" class="amount">Unit price</th><th scope="col" class="amount">Qty</th><th scope="col" class="amount">Amount</th></tr></thead><tbody>${o.items.map(p=>`<tr><td>${escapeHTML(p.name)}</td><td class="amount">${money(p.unit_price_paise)}</td><td class="amount">${p.quantity}</td><td class="amount">${money(p.unit_price_paise*p.quantity)}</td></tr>`).join('')}</tbody></table></div><div class="receipt-totals"><div class="summary-row"><span>Subtotal</span><span>${money(o.subtotal_paise)}</span></div><div class="summary-row"><span>Shipping</span><span>${money(o.shipping_paise)}</span></div><div class="summary-total"><span>Order total</span><span>${money(o.total_paise)}</span></div><p class="muted">${o.status==='Cancelled'?'Amount due: ₹0.00 (cancelled)':'Amount due on delivery: '+money(o.total_paise)}</p></div><p class="receipt-note">Thank you for choosing Velora.<br>This is an order confirmation, not a payment receipt or GST tax invoice.</p>`;
 $('#print-receipt').disabled=false;
}
document.addEventListener('DOMContentLoaded',async()=>{
 $('.menu-toggle')?.addEventListener('click',()=>{
  $('.nav-links').classList.toggle('active'); $('.nav-buttons').classList.toggle('active'); $('.menu-toggle').setAttribute('aria-expanded',String($('.nav-links').classList.contains('active')));
 });
 document.querySelectorAll('.nav-links a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')===(location.pathname.split('/').pop() || 'index.html')));
 $('#logout')?.addEventListener('click',async()=>{try{await api('/auth/logout','POST');location.href='index.html';}catch(err){toast(err.message);}});
 $('#print-receipt')?.addEventListener('click',()=>window.print());
 bindForm('#login-form',async(data)=>{await api('/auth/login','POST',data);location.href=safeNext();});
 bindForm('#register-form',async(data)=>{if(data.password!==data.confirm)throw new Error('Passwords do not match.');await api('/auth/register','POST',data);location.href=safeNext();});
 if($('#register-link'))$('#register-link').href='register.html?next='+encodeURIComponent(safeNext());
 if($('#signin-link'))$('#signin-link').href='login.html?next='+encodeURIComponent(safeNext());
 bindForm('#contact-form',async(data,form,status)=>{const result=await api('/contact','POST',data);form.reset();status.textContent=result.message;status.classList.add('success');});
 try {
  if(location.protocol==='file:')throw new Error('Start the Node.js server with npm start, then open http://localhost:3000.');
  currentUser=(await api('/me')).user;
  if(currentUser){$('#account-link').textContent=currentUser.name.split(' ')[0];$('#account-link').href='orders.html';$('#logout').hidden=false;}
  updateCart(await api('/cart'));
  await renderProducts();
  if($('.cart-items')) {
   drawCart();
   $('.cart-items').addEventListener('click',async e=>{
    const button=e.target.closest('[data-quantity]');if(!button || button.disabled)return;
    const controls=[...$('.cart-items').querySelectorAll('button')];controls.forEach(b=>b.disabled=true);
    try {updateCart(await api('/cart/'+button.dataset.id,'PUT',{quantity:Number(button.dataset.quantity)}));drawCart();}
    catch(err){toast(err.message);drawCart();}
   });
   $('#checkout-button').addEventListener('click',()=>location.href=currentUser?'checkout.html':signInLink('checkout.html'));
  }
  if($('#checkout-content') && requireSignIn($('#checkout-content'),'checkout.html')) {
   if(!currentCart.items.length)$('#checkout-content').innerHTML=empty('Your cart is empty','Add jewellery before checking out.');
   else {
    $('#name').value=currentUser.name; $('#checkout-summary').innerHTML=summaryHTML(currentCart);
    $('#checkout-form [type=submit]').disabled=false;
    const storageKey='velora_checkout_'+currentUser.id;
    bindForm('#checkout-form',async(data)=>{
     let key=sessionStorage.getItem(storageKey);if(!key){key=crypto.randomUUID();sessionStorage.setItem(storageKey,key);}
     const o=await api('/orders','POST',{...data,checkout_key:key});sessionStorage.removeItem(storageKey);location.href='receipt.html?id='+encodeURIComponent(o.id);
    });
   }
  }
  await loadOrders();
  $('#orders-list')?.addEventListener('click',async e=>{
   const button=e.target.closest('[data-cancel]'); if(!button || button.disabled || !confirm('Cancel this order? Its items will be returned to stock.'))return;
   button.disabled=true;
   try {await api('/orders/'+encodeURIComponent(button.dataset.cancel)+'/cancel','POST');await loadOrders();toast('Order cancelled.');}
   catch(err){toast(err.message);button.disabled=false;}
  });
  await loadReceipt();
 } catch(err) {
  toast(err.message);
  const region=$('#receipt-content') || $('#orders-list') || $('.cart-items') || $('#checkout-summary');
  if(region){region.textContent=err.message;}
 }
});
