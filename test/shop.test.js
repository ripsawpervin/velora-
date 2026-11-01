'use strict';
const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {createApp} = require('../server');
let app,db,server,base,dir,dbPath;
function client() {
 let cookie='';
 return async(url,method='GET',data,extra={})=>{
  const res=await fetch(base+'/api'+url,{method,headers:{Cookie:cookie,...(method!=='GET'?{'Content-Type':'application/json','X-Velora-Request':'1'}:{}),...extra},...(method!=='GET'?{body:JSON.stringify(data||{})}:{})});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,body:await res.json()};
 };
}
const delivery={name:'Test Customer',phone:'9876543210',address:'123 Test Road, Sector 5',city:'Chandigarh',pincode:'160001'};
let a,b,orderId;
before(async()=>{
 dir=mkdtempSync(path.join(tmpdir(),'velora-test-')); dbPath=path.join(dir,'test.db');
 ({app,db}=createApp(dbPath)); server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 a=client();b=client();
});
after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});});
test('catalogue contains 25 seeded products and database files are not served',async()=>{
 assert.equal((await a('/products')).body.products.length,25);
 assert.equal((await fetch(base+'/data/velora.db')).status,404);
 assert.equal((await fetch(base+'/server.js')).status,404);
});
test('guest cart is saved in SQLite and unauthenticated checkout is blocked',async()=>{
 assert.equal((await a('/cart/1','PUT',{quantity:2})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM cart_items').get().n,1);
 assert.equal((await a('/orders','POST',{...delivery,checkout_key:'guest-checkout'})).status,401);
});
test('registration hashes password, retains guest cart and rejects duplicate email',async()=>{
 assert.equal((await a('/auth/register','POST',{name:'Test Customer',email:'customer@example.com',password:'TestPass123!'})).status,201);
 assert.equal((await a('/cart')).body.items[0].quantity,2);
 const hash=db.prepare('SELECT password_hash FROM users').get().password_hash;
 assert.ok(!hash.includes('TestPass123!')); assert.equal(hash.split(':')[1].length,128);
 assert.equal((await b('/auth/register','POST',{name:'Other User',email:'CUSTOMER@example.com',password:'TestPass123!'})).status,409);
});
test('quantity, stock and request protection reject invalid input',async()=>{
 for(const quantity of [-1,1.5,100,'2'])assert.equal((await a('/cart/1','PUT',{quantity})).status,400);
 assert.equal((await a('/cart/1','PUT',{quantity:26})).status,409);
 assert.equal((await a('/cart/999','PUT',{quantity:1})).status,404);
 assert.equal((await a('/cart/1','PUT',{quantity:1},{'X-Velora-Request':'0'})).status,403);
});
test('invalid delivery data leaves cart and stock unchanged',async()=>{
 assert.equal((await a('/orders','POST',{...delivery,pincode:'wrong',checkout_key:'invalid-checkout'})).status,400);
 assert.equal((await a('/cart')).body.count,2); assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,25);
});
test('checkout uses server prices, snapshots items, reduces stock and empties cart',async()=>{
 const r=await a('/orders','POST',{...delivery,checkout_key:'first-checkout',total_paise:1});
 assert.equal(r.status,201); orderId=r.body.id;
 assert.equal(r.body.total_paise,599800); assert.equal(r.body.payment_status,'Unpaid'); assert.equal(r.body.items[0].quantity,2);
 assert.equal((await a('/cart')).body.count,0); assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,23);
 db.prepare('UPDATE products SET price_paise=399900 WHERE id=1').run();
 assert.equal((await a('/orders/'+orderId)).body.items[0].unit_price_paise,299900);
});
test('retrying checkout returns the same order without a second stock decrement',async()=>{
 const r=await a('/orders','POST',{...delivery,checkout_key:'first-checkout'});
 assert.equal(r.body.id,orderId);assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,1);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,23);
});
test('one account cannot view or cancel another account’s order',async()=>{
 await b('/auth/register','POST',{name:'Other Customer',email:'other@example.com',password:'OtherPass123!'});
 assert.equal((await b('/orders')).body.orders.length,0);
 assert.equal((await b('/orders/'+orderId)).status,404);
 assert.equal((await b('/orders/'+orderId+'/cancel','POST')).status,404);
});
test('cancelling restores stock exactly once and preserves history',async()=>{
 assert.equal((await a('/orders/'+orderId+'/cancel','POST')).body.status,'Cancelled');
 await a('/orders/'+orderId+'/cancel','POST');
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,25);
 assert.equal((await a('/orders')).body.orders.length,1);
});
test('two customers cannot oversell the last piece; failed checkout rolls back',async()=>{
 db.prepare('UPDATE products SET stock=1 WHERE id=2').run();
 await a('/cart/2','PUT',{quantity:1});await b('/cart/2','PUT',{quantity:1});
 const results=await Promise.all([a('/orders','POST',{...delivery,checkout_key:'last-stock-a'}),b('/orders','POST',{...delivery,checkout_key:'last-stock-b'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=2').get().stock,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,2);
 assert.equal(db.prepare('SELECT count(*) AS n FROM cart_items WHERE product_id=2').get().n,1);
});
test('logout invalidates session; login validates password and merges guest cart',async()=>{
 await a('/auth/logout','POST');assert.equal((await a('/orders')).status,401);
 await a('/cart/3','PUT',{quantity:1});
 assert.equal((await a('/auth/login','POST',{email:'customer@example.com',password:'Wrong'})).status,401);
 assert.equal((await a('/auth/login','POST',{email:'customer@example.com',password:'TestPass123!'})).status,200);
 assert.ok((await a('/cart')).body.items.some(p=>p.id===3));
});
test('contact messages persist and validation rejects incomplete messages',async()=>{
 assert.equal((await a('/contact','POST',{name:'Jane',email:'jane@example.com',subject:'Shipping question',message:'When will my order arrive?'})).status,201);
 assert.equal((await a('/contact','POST',{name:'J'})).status,400);
 assert.equal(db.prepare('SELECT count(*) AS n FROM contact_messages').get().n,1);
});
test('orders, sessions and cart survive closing and reopening the server/database',async()=>{
 await new Promise(r=>server.close(r));db.close();({app,db}=createApp(dbPath));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 assert.ok((await a('/orders')).body.orders.some(o=>o.id===orderId));
 assert.ok((await a('/cart')).body.items.some(p=>p.id===3));
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=2').get().stock,0);
});
