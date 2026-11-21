const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');
const { createStore } = require('./db');

const MOBILE = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Windows Phone|Opera Mini|webOS|Silk|Kindle/i;
function createApp(options = {}) {
  const store = options.store || createStore();
  const user = options.user ?? (process.env.AUTH_USER || 'xander');
  const password = options.password ?? process.env.AUTH_PASSWORD;
  if (!password) throw new Error('AUTH_PASSWORD must be configured');
  const secret = options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
  const secureCookie = options.production === undefined ? 'auto' : options.production;
  const app = express(); const clients = new Set(); const attempts = new Map();
  app.disable('x-powered-by'); app.set('trust proxy', 1); app.set('query parser', 'simple');
  app.use(express.json({ limit: '64kb' })); app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' }); next();
  });
  app.use(session({ name: 'pluhub.sid', secret, resave: false, rolling: true, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 3 * 24 * 60 * 60 * 1000 } }));
  const hash = token => crypto.createHash('sha256').update(token).digest('hex');
  const equal = (a, b) => {
    const x = crypto.createHash('sha256').update(String(a || '')).digest();
    const y = crypto.createHash('sha256').update(String(b || '')).digest(); return crypto.timingSafeEqual(x, y);
  };
  function desktop(req, res, next) {
    res.set('Vary', 'User-Agent');
    if (!MOBILE.test(req.get('user-agent') || '')) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Use the Android app to edit on your phone. Web administration is for desktop browsers.' });
    return res.status(403).type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>Desktop admin only</title><main style="font:18px system-ui;max-width:38rem;margin:15vh auto;padding:2rem"><h1>Web admin is desktop-only</h1><p>You can still browse the catalog on your phone, or edit using the PLU Hub Android app.</p><a href="/">Back to the catalog</a></main>');
  }
  function webAuth(req, res, next) {
    if (req.session?.user === user) { req.actor = 'web-admin'; return next(); }
    if (!req.path.startsWith('/api/')) return res.redirect('/login.html?next=/edit');
    res.status(401).json({ error: 'Sign in to edit the catalog.' });
  }
  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-site request rejected' });
    next();
  }
  function csrf(req, res, next) {
    if (!req.session.csrf || !equal(req.get('x-csrf-token'), req.session.csrf)) return res.status(403).json({ error: 'Refresh the page and try again.' });
    next();
  }
  function throttle(req, res, next) {
    const key = req.ip; const now = Date.now();
    for (const [k, v] of attempts) if (now - v.start > 15 * 60 * 1000) attempts.delete(k);
    const v = attempts.get(key) || { start: now, count: 0 }; v.count++; attempts.set(key, v);
    if (v.count > 15) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    next();
  }
  function validLogin(req) { return typeof req.body.username === 'string' && typeof req.body.password === 'string' && equal(req.body.username, user) && equal(req.body.password, password); }
  function appAuth(req, res, next) {
    const token = (req.get('authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in to edit the catalog.' });
    const row = store.db.prepare('SELECT expires_at FROM app_sessions WHERE token_hash=?').get(hash(token));
    if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    req.actor = 'android-app'; req.tokenHash = hash(token); next();
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true, items: store.countItems() }));
  app.get('/api/me', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ authenticated: req.session?.user === user,
    user: req.session?.user === user ? user : null, csrf: req.session?.user === user ? req.session.csrf : null }); });
  app.post('/api/login', desktop, sameOrigin, throttle, (req, res, next) => {
    if (!validLogin(req)) return res.status(401).json({ error: 'Incorrect username or password.' });
    req.session.regenerate(err => { if (err) return next(err); req.session.user = user; req.session.csrf = crypto.randomBytes(24).toString('hex');
      res.set('Cache-Control', 'no-store').json({ ok: true, user, csrf: req.session.csrf }); });
  });
  app.post('/api/logout', sameOrigin, (req, res) => req.session.destroy(() => { res.clearCookie('pluhub.sid'); res.json({ ok: true }); }));
  app.post('/api/app/login', throttle, (req, res) => {
    if (!validLogin(req)) return res.status(401).json({ error: 'Incorrect username or password.' });
    store.db.prepare('DELETE FROM app_sessions WHERE expires_at<?').run(Date.now());
    const token = crypto.randomBytes(32).toString('base64url'); const expiresAt = Date.now() + 3 * 24 * 60 * 60 * 1000;
    store.db.prepare('INSERT INTO app_sessions VALUES(?,?)').run(hash(token), expiresAt);
    res.set('Cache-Control', 'no-store').json({ ok: true, token, expiresAt, user });
  });
  app.get('/api/app/me', appAuth, (_req, res) => res.set('Cache-Control', 'no-store').json({ authenticated: true, user }));
  app.post('/api/app/logout', appAuth, (req, res) => { store.db.prepare('DELETE FROM app_sessions WHERE token_hash=?').run(req.tokenHash); res.json({ ok: true }); });
  app.get('/api/items', (_req, res) => {
    res.set({ 'Cache-Control': 'no-cache', ETag: `W/"catalog-${store.revision()}"`, 'X-Catalog-Revision': String(store.revision()) }); res.json(store.listItems());
  });
  app.get('/api/events', (req, res) => {
    if (clients.size >= 100) return res.sendStatus(503);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders(); res.write(`event: catalog\ndata: ${store.revision()}\n\n`); clients.add(res);
    const timer = setInterval(() => res.write(': keepalive\n\n'), 20000);
    req.on('close', () => { clearInterval(timer); clients.delete(res); });
  });
  function changed() { for (const client of clients) client.write(`event: catalog\ndata: ${store.revision()}\n\n`); }
  function parsed(body) {
    const name = String(body.name || '').trim(); const plu = String(body.plu || '').trim(); const cat = String(body.cat || '').toLowerCase();
    if (!name || name.length > 120) return { error: 'Enter a name of 1 to 120 characters.' };
    if (!/^\d{4,5}$/.test(plu)) return { error: 'PLU must contain 4 or 5 digits.' };
    if (!['fruit','veg','dry'].includes(cat)) return { error: 'Choose Fruit, Vegetables or Pantry.' };
    return { name, plu, cat };
  }
  function revision(req, res, next) {
    if (req.body.revision !== undefined && (!Number.isInteger(req.body.revision) || req.body.revision < 1)) return res.status(400).json({ error: 'Invalid item revision.' });
    next();
  }
  function errorResult(result, res) {
    if (result.error === 'not_found') { res.status(404).json({ error: 'Item not found.' }); return true; }
    if (result.error === 'conflict') { res.status(409).json({ error: 'This item changed. Refresh before trying again.', current: result.current }); return true; }
    return false;
  }
  function routes(prefix, guards) {
    app.post(prefix, ...guards, (req, res, next) => {
      const item = parsed(req.body); if (item.error) return res.status(400).json(item);
      if (store.getItemByPlu(item.plu)) return res.status(409).json({ error: 'That PLU already exists.' });
      try { const created = store.createItem(item, req.actor); changed(); res.status(201).json(created); } catch (e) { next(e); }
    });
    app.patch(prefix+'/:id', ...guards, revision, (req, res, next) => {
      const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid item ID.' });
      const item = parsed(req.body); if (item.error) return res.status(400).json(item);
      const duplicate = store.getItemByPlu(item.plu); if (duplicate && duplicate.id !== id) return res.status(409).json({ error: 'That PLU already exists.' });
      try { const r = store.updateItem(id, item, req.body.revision, req.actor); if (errorResult(r, res)) return; changed(); res.json(r.item); } catch (e) { next(e); }
    });
    app.delete(prefix+'/:id', ...guards, revision, (req, res, next) => {
      const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid item ID.' });
      try { const r = store.deleteItem(id, req.body.revision, req.actor); if (errorResult(r, res)) return; changed(); res.json({ ok: true, id }); } catch (e) { next(e); }
    });
  }
  routes('/api/items', [desktop, webAuth, sameOrigin, csrf]);
  routes('/api/app/items', [appAuth]);
  function auditRoutes(prefix, guards) {
    app.get(prefix, ...guards, (_req, res) => res.set('Cache-Control','no-store').json(store.listAudit()));
    app.post(prefix+'/:id/restore', ...guards, (req, res, next) => {
      try { const r = store.restoreItem(Number(req.params.id), req.actor); if (errorResult(r, res)) return; changed(); res.json(r.item); } catch (e) { next(e); }
    });
  }
  auditRoutes('/api/audit', [desktop, webAuth, sameOrigin, csrf]);
  auditRoutes('/api/app/audit', [appAuth]);
  const publicDir = path.join(__dirname, '..', 'public');
  app.use((req, res, next) => {
    let route; try { route = decodeURIComponent(req.path).toLowerCase().replace(/\/+$/, ''); } catch { return res.sendStatus(400); }
    if (!['/edit','/edit.html','/login.html'].includes(route)) return next();
    desktop(req, res, () => {
      if (route === '/login.html') return res.sendFile(path.join(publicDir, 'login.html'));
      webAuth(req, res, () => res.sendFile(path.join(publicDir, 'edit.html')));
    });
  });
  app.use(express.static(publicDir, { etag: true, maxAge: 0 }));
  app.use((err, _req, res, _next) => { console.error('PLU request failed:', err.code || err.name); const status = [400,413].includes(err.status) ? err.status : 500; res.status(status).json({ error: status === 500 ? 'Could not complete this request.' : 'Invalid or oversized request body.' }); });
  app.locals.store = store; app.locals.closeStreams = () => { for (const c of clients) c.end(); clients.clear(); };
  return app;
}
if (require.main === module) {
  const app = createApp(); const server = app.listen(Number(process.env.PORT)||3000, '0.0.0.0', () => console.log('PLU Hub ready'));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { app.locals.closeStreams(); server.close(() => { app.locals.store.close(); process.exit(0); }); });
}
module.exports = { createApp, MOBILE };
