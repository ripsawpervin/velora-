'use strict';
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const deriveKey = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
function text(value, label, min = 1, max = 200) {
 if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label} must contain ${min}–${max} characters.`);
 return value.trim();
}
function email(value) {
 value = text(value, 'Email', 3, 254).toLowerCase();
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, 'Enter a valid email address.');
 return value;
}
function createApp(dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'velora.db')) {
 if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
 const db = new DatabaseSync(dbPath);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
 const run = (sql, ...args) => db.prepare(sql).run(...args);
 const one = (sql, ...args) => db.prepare(sql).get(...args);
 const all = (sql, ...args) => db.prepare(sql).all(...args);
 function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
 }
 transaction(() => {
  for (const p of require('./products.json')) run('INSERT OR IGNORE INTO products VALUES (?, ?, ?, ?, ?, ?)', p.id, p.name, p.category, p.price_paise, p.image, p.stock);
 });
 const app = express();
 app.disable('x-powered-by');
 app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
 });
 app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET','HEAD'].includes(req.method)) {
   if (req.get('X-Velora-Request') !== '1' || !req.is('application/json')) return res.status(403).json({error: 'Invalid request. Reload the website and try again.'});
   if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({error: 'Cross-site request rejected.'});
  }
  next();
 });
 app.use(express.json({limit: '16kb'}));
 const attempts = new Map();
 app.use('/api', (req, res, next) => {
  // Bound unauthenticated writes and password attempts per IP in a 15-minute window.
  if (req.method === 'POST' && ['/auth/login','/auth/register','/contact'].includes(req.path)) {
   const key = req.ip + req.path, now = Date.now();
   for (const [k,v] of attempts) if (v.until < now) attempts.delete(k);
   const a = attempts.get(key) || {count:0, until:now+900000};
   attempts.set(key, a);
   if (++a.count > 30) return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
  }
  next();
 });
 function setSession(res, token) {
  res.cookie('velora_session', token, {httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV === 'production', maxAge:7*86400000, path:'/'});
 }
 app.use('/api', (req, res, next) => {
  try {
   const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('velora_session='));
   let token = cookie ? cookie.slice('velora_session='.length) : '';
   let session = token && one('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', digest(token), Date.now());
   if (!session) {
    // Remove expired guest carts together with their sessions.
    run("DELETE FROM cart_items WHERE owner IN (SELECT 'g:' || token_hash FROM sessions WHERE expires_at <= ?)", Date.now());
    run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    token = randomBytes(32).toString('hex');
    session = {token_hash:digest(token), user_id:null, expires_at:Date.now()+7*86400000};
    run('INSERT INTO sessions VALUES (?, ?, ?)', session.token_hash, null, session.expires_at);
    setSession(res, token);
   }
   req.session = session;
   req.user = session.user_id ? one('SELECT id, name, email FROM users WHERE id = ?', session.user_id) : null;
   req.owner = req.user ? `u:${req.user.id}` : `g:${session.token_hash}`;
   next();
  } catch (e) { next(e); }
 });
 function requireUser(req, res, next) { if (!req.user) return res.status(401).json({error:'Please sign in to continue.'}); next(); }
 function signIn(req, res, userId) {
  const token = randomBytes(32).toString('hex');
  transaction(() => {
   if (!req.user) {
    for (const item of all('SELECT * FROM cart_items WHERE owner = ?', req.owner)) {
     const stock = one('SELECT stock FROM products WHERE id = ?', item.product_id).stock;
     const old = one('SELECT quantity FROM cart_items WHERE owner = ? AND product_id = ?', `u:${userId}`, item.product_id);
     const qty = Math.min(99, stock, item.quantity + (old?.quantity || 0));
     if (qty > 0) run('INSERT INTO cart_items VALUES (?, ?, ?) ON CONFLICT(owner, product_id) DO UPDATE SET quantity = excluded.quantity', `u:${userId}`, item.product_id, qty);
    }
    run('DELETE FROM cart_items WHERE owner = ?', req.owner);
   }
   run('DELETE FROM sessions WHERE token_hash = ?', req.session.token_hash);
   run('INSERT INTO sessions VALUES (?, ?, ?)', digest(token), userId, Date.now()+7*86400000);
  });
  setSession(res, token);
  return one('SELECT id, name, email FROM users WHERE id = ?', userId);
 }
 app.get('/api/me', (req,res)=>res.json({user:req.user}));
 app.post('/api/auth/register', async(req,res)=>{
  const name = text(req.body.name,'Name',2,80), mail = email(req.body.email);
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail(400,'Password must contain 8–128 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = (await deriveKey(password, salt, 64)).toString('hex');
  let result;
  try { result = run('INSERT INTO users(name,email,password_hash) VALUES (?,?,?)', name, mail, `${salt}:${hash}`); }
  catch(e) { if (one('SELECT id FROM users WHERE email = ?', mail)) fail(409,'An account with this email already exists.'); throw e; }
  res.status(201).json({user:signIn(req,res,Number(result.lastInsertRowid))});
 });
 app.post('/api/auth/login', async(req,res)=>{
  const mail = email(req.body.email), password = req.body.password;
  if (typeof password !== 'string' || password.length > 128) fail(400,'Enter a valid password.');
  const user = one('SELECT * FROM users WHERE email = ?',mail);
  const [salt, hash] = (user?.password_hash || '00000000000000000000000000000000:'+'0'.repeat(128)).split(':');
  const actual = await deriveKey(password,salt,64);
  if (!user || !timingSafeEqual(actual, Buffer.from(hash,'hex'))) fail(401,'Email or password is incorrect.');
  res.json({user:signIn(req,res,user.id)});
 });
 app.post('/api/auth/logout',(req,res)=>{
  run('DELETE FROM sessions WHERE token_hash = ?',req.session.token_hash);
  res.clearCookie('velora_session',{path:'/'}); res.json({ok:true});
 });
 app.get('/api/products',(req,res)=>res.json({products:all('SELECT * FROM products ORDER BY id')}));
 function cart(owner) {
  const items = all('SELECT p.*, c.quantity FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.owner = ? ORDER BY p.id',owner);
  const subtotal_paise = items.reduce((n,p)=>n+p.price_paise*p.quantity,0);
  return {items,subtotal_paise,shipping_paise:0,total_paise:subtotal_paise,count:items.reduce((n,p)=>n+p.quantity,0)};
 }
 app.get('/api/cart',(req,res)=>res.json(cart(req.owner)));
 app.put('/api/cart/:id',(req,res)=>{
  const id = Number(req.params.id), quantity = req.body.quantity;
  if (!Number.isSafeInteger(id) || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) fail(400,'Quantity must be an integer from 0 to 99.');
  const p = one('SELECT * FROM products WHERE id = ?',id);
  if (!p) fail(404,'Product not found.');
  if (quantity > p.stock) fail(409,`Only ${p.stock} of ${p.name} available.`);
  if (!quantity) run('DELETE FROM cart_items WHERE owner = ? AND product_id = ?',req.owner,id);
  else run('INSERT INTO cart_items VALUES (?, ?, ?) ON CONFLICT(owner, product_id) DO UPDATE SET quantity = excluded.quantity',req.owner,id,quantity);
  res.json(cart(req.owner));
 });
 app.get('/api/orders',requireUser,(req,res)=>res.json({orders:all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC',req.user.id)}));
 function order(id,userId) {
  const o = one('SELECT * FROM orders WHERE id = ? AND user_id = ?',id,userId);
  if (!o) fail(404,'Order not found.');
  return {...o,items:all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id',id)};
 }
 app.get('/api/orders/:id',requireUser,(req,res)=>res.json(order(req.params.id,req.user.id)));
 app.post('/api/orders',requireUser,(req,res)=>{
  const key = text(req.body.checkout_key,'Checkout reference',10,100);
  const result = transaction(()=>{
   const existing = one('SELECT id FROM orders WHERE user_id = ? AND checkout_key = ?',req.user.id,key);
   if (existing) return order(existing.id,req.user.id);
   const name = text(req.body.name,'Full name',2,80), phone = text(req.body.phone,'Phone',10,15);
   if (!/^\+?[\d -]{10,15}$/.test(phone) || phone.replace(/\D/g,'').length < 10) fail(400,'Enter a valid phone number.');
   const address = text(req.body.address,'Address',10,500), city = text(req.body.city,'City',2,80), pin = text(req.body.pincode,'PIN code',6,6);
   if (!/^\d{6}$/.test(pin)) fail(400,'Enter a six-digit Indian PIN code.');
   const c = cart(req.owner);
   if (!c.items.length) fail(400,'Your cart is empty.');
   for (const p of c.items) if (p.quantity > p.stock) fail(409,`${p.name} has only ${p.stock} remaining. Update your cart.`);
   const id = `VL-${randomUUID()}`;
   run('INSERT INTO orders(id,user_id,checkout_key,customer_name,email,phone,address,city,pincode,subtotal_paise,total_paise) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,req.user.id,key,name,req.user.email,phone,address,city,pin,c.subtotal_paise,c.total_paise);
   for (const p of c.items) {
    run('INSERT INTO order_items(order_id,product_id,name,category,image,unit_price_paise,quantity) VALUES (?,?,?,?,?,?,?)',id,p.id,p.name,p.category,p.image,p.price_paise,p.quantity);
    run('UPDATE products SET stock = stock - ? WHERE id = ?',p.quantity,p.id);
   }
   run('DELETE FROM cart_items WHERE owner = ?',req.owner);
   return order(id,req.user.id);
  });
  res.status(201).json(result);
 });
 app.post('/api/orders/:id/cancel',requireUser,(req,res)=>{
  const result = transaction(()=>{
   const o = order(req.params.id,req.user.id);
   if (o.status === 'Cancelled') return o;
   if (o.status !== 'Placed') fail(409,'This order can no longer be cancelled.');
   for (const p of o.items) run('UPDATE products SET stock = stock + ? WHERE id = ?',p.quantity,p.product_id);
   run("UPDATE orders SET status = 'Cancelled' WHERE id = ?",o.id);
   return order(o.id,req.user.id);
  });
  res.json(result);
 });
 app.post('/api/contact',(req,res)=>{
  const name = text(req.body.name,'Name',2,80), mail = email(req.body.email), subject = text(req.body.subject,'Subject',3,150), message = text(req.body.message,'Message',10,3000);
  run('INSERT INTO contact_messages(name,email,subject,message) VALUES (?,?,?,?)',name,mail,subject,message);
  res.status(201).json({message:'Your message has been saved. Thank you for contacting Velora.'});
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
 app.use(express.static(path.join(__dirname,'public')));
 app.use((err,req,res,next)=>{
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({error:err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again.'});
 });
 return {app,db};
}
if (require.main === module) {
 const {app,db} = createApp();
 const port = Number(process.env.PORT || 3000);
 const server = app.listen(port, process.env.HOST || '127.0.0.1',()=>console.log(`Velora is ready at http://localhost:${port}`));
 server.on('error',e=>{console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Stop the other server or change PORT.` : e.message); db.close(); process.exitCode=1;});
 for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
module.exports = {createApp};
