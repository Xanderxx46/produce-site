const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createStore } = require('../src/db');
const { createApp } = require('../src/server');
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0';
const PHONE = 'Mozilla/5.0 (Linux; Android 15) Mobile';
async function fixture(t) {
  const store = createStore(':memory:');
  store.seedItems([{ name: 'Bananas, Yellow', plu: '4011', cat: 'fruit', es: 'Plátano' }]);
  const app = createApp({ store, user: 'fixture-user', password: 'fixture-password', sessionSecret: 'fixture-only-not-a-deployed-secret', production: false });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { app.locals.closeStreams(); server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); });
  let cookie, csrf;
  const call = async (url, method = 'GET', body, extra = {}) => {
    const headers = { 'User-Agent': DESKTOP, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  };
  const signIn = async () => {
    const r = await call('/api/login', 'POST', { username: 'fixture-user', password: 'fixture-password' }); assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie').split(';')[0]; csrf = (await r.json()).csrf;
  };
  const appLogin = async () => {
    const r = await call('/api/app/login', 'POST', { username: 'fixture-user', password: 'fixture-password' }, { 'User-Agent': PHONE }); assert.equal(r.status, 200); return (await r.json()).token;
  };
  return { call, signIn, appLogin, store, base };
}

test('mobile public reader works; mobile admin/login pages and web writes are blocked', async t => {
  const f = await fixture(t);
  for (const url of ['/', '/api/items', '/api/health']) assert.equal((await f.call(url,'GET',undefined,{'User-Agent':PHONE})).status,200);
  for (const url of ['/edit','/edit.html','/login.html','/%65dit.html','/LOGIN.HTML']) assert.equal((await f.call(url,'GET',undefined,{'User-Agent':PHONE})).status,403);
  assert.equal((await f.call('/api/login','POST',{username:'fixture-user',password:'fixture-password'},{'User-Agent':PHONE})).status,403);
  assert.equal((await f.call('/api/items','POST',{name:'Test',plu:'9999',cat:'fruit'},{'User-Agent':PHONE})).status,403);
});
test('desktop protected by unchanged credential values; old password still works', async t => {
  const f = await fixture(t); assert.equal((await f.call('/edit')).status,302);
  assert.equal((await f.call('/api/login','POST',{username:'fixture-user',password:'wrong'})).status,401);
  await f.signIn(); assert.equal((await f.call('/edit')).status,200); assert.equal((await f.call('/api/me')).status,200);
});
test('anonymous mutation and cross-site login are refused', async t => {
  const f = await fixture(t); assert.equal((await f.call('/api/items','POST',{name:'Test',plu:'9999',cat:'fruit'})).status,401);
  assert.equal((await f.call('/api/login','POST',{username:'fixture-user',password:'fixture-password'},{Origin:'https://not-this-site.invalid'})).status,403);
});
test('web writes require CSRF even when authenticated', async t => {
  const f = await fixture(t); await f.signIn();
  assert.equal((await f.call('/api/items','POST',{name:'Test',plu:'9999',cat:'fruit'},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.call('/api/items','POST',{name:'Test',plu:'9999',cat:'fruit'})).status,201);
});
test('native app token allows phone editing and updates the shared public catalog', async t => {
  const f = await fixture(t), token = await f.appLogin(); const headers = {Authorization:'Bearer '+token,'User-Agent':PHONE};
  const r = await f.call('/api/app/items','POST',{name:'Test Produce',plu:'9999',cat:'veg'},headers); assert.equal(r.status,201); const item=await r.json();
  const publicItems=await (await f.call('/api/items')).json(); assert.ok(publicItems.some(x=>x.id===item.id));
  assert.equal((await f.call('/api/app/items/'+item.id,'PATCH',{name:'Renamed',plu:'9999',cat:'veg',revision:item.revision},headers)).status,200);
  const updated=await (await f.call('/api/items')).json();assert.equal(updated.find(x=>x.id===item.id).name,'Renamed');
  assert.equal(f.store.db.prepare('SELECT token_hash FROM app_sessions').get().token_hash===token,false);
});
test('app install/header alone grants no editing permission; logout revokes token', async t => {
  const f = await fixture(t); const item={name:'Test',plu:'9999',cat:'fruit'};
  assert.equal((await f.call('/api/app/items','POST',item,{'X-App':'PLUHub'})).status,401);
  const token=await f.appLogin(), h={Authorization:'Bearer '+token};
  assert.equal((await f.call('/api/app/logout','POST',{},h)).status,200);
  assert.equal((await f.call('/api/app/items','POST',item,h)).status,401);
});
test('real updates use revisions and reject stale edits', async t => {
  const f=await fixture(t);await f.signIn();const item=f.store.listItems()[0];
  const body={name:'Updated Banana',plu:'4011',cat:'fruit',revision:item.revision};assert.equal((await f.call('/api/items/'+item.id,'PATCH',body)).status,200);
  assert.equal((await f.call('/api/items/'+item.id,'PATCH',body)).status,409);
});
test('PLU uniqueness/input validation enforced server side', async t => {
  const f=await fixture(t);await f.signIn();
  assert.equal((await f.call('/api/items','POST',{name:'Duplicate',plu:'4011',cat:'fruit'})).status,409);
  for (const body of [{name:'Bad',plu:'12',cat:'fruit'},{name:'Bad',plu:'9999',cat:'nope'},{name:'',plu:'9999',cat:'fruit'}]) assert.equal((await f.call('/api/items','POST',body)).status,400);
});
test('delete is audited and recoverable; duplicate restore fails safely', async t => {
  const f=await fixture(t);await f.signIn();const item=f.store.listItems()[0];
  assert.equal((await f.call('/api/items/'+item.id,'DELETE',{revision:item.revision})).status,200); assert.equal(f.store.countItems(),0);
  const entries=await (await f.call('/api/audit')).json();const del=entries.find(x=>x.action==='delete');assert.ok(del);
  assert.equal((await f.call('/api/audit/'+del.id+'/restore','POST',{})).status,200);assert.equal(f.store.getItemById(item.id).plu,'4011');assert.equal(f.store.getItemById(item.id).es,'Plátano');
  assert.equal((await f.call('/api/audit/'+del.id+'/restore','POST',{})).status,409);
});
test('catalog ETag/revision changes after mutation and SSE emits catalog events', async t => {
  const f=await fixture(t);await f.signIn(); const before=await f.call('/api/items');
  const controller=new AbortController();const stream=await fetch(f.base+'/api/events',{signal:controller.signal});assert.match(stream.headers.get('content-type'),/^text\/event-stream/);
  const reader=stream.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: catalog/);
  await f.call('/api/items','POST',{name:'Test',plu:'9999',cat:'fruit'});
  const next=new TextDecoder().decode((await reader.read()).value);assert.match(next,/event: catalog/);controller.abort();
  assert.notEqual((await f.call('/api/items')).headers.get('etag'),before.headers.get('etag'));
});
test('login attempts are bounded', async t => {
  const f=await fixture(t);let r;for(let i=0;i<16;i++)r=await f.call('/api/login','POST',{username:'fixture-user',password:'wrong'});assert.equal(r.status,429);
});
test('old schema migration preserves existing catalog values', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plu-migrate-'));const filename=path.join(dir,'test.db');
  try {
    const old=new Database(filename);old.exec("CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,es TEXT NOT NULL DEFAULT '',plu TEXT NOT NULL UNIQUE,cat TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));INSERT INTO items(name,plu,cat) VALUES('Fixture','4011','fruit')");old.close();
    const store=createStore(filename);assert.equal(store.countItems(),1);assert.equal(store.listItems()[0].name,'Fixture');assert.equal(store.listItems()[0].revision,1);store.close();
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
