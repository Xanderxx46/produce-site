import JsBarcode from 'jsbarcode';
import '../public/js/search.js';
import { native, mobileBrowser, request, me, login } from './api';
import { mountEditor } from './editor';
const $ = s => document.querySelector(s);
const page = document.body.dataset.page;
const labels = { fruit: 'Fruit', veg: 'Vegetables', dry: 'Pantry' };
function showError(el, text) { el.textContent = text; el.classList.add('bad'); }

if (page === 'login') {
  const form = $('#login-form');
  form.onsubmit = async e => {
    e.preventDefault(); const button = form.querySelector('button'); button.disabled = true; $('#login-error').textContent = '';
    try { await login(form.elements.username.value.trim(), form.elements.password.value); form.elements.password.value = ''; location.href = '/edit'; }
    catch (err) { showError($('#login-error'), err.message); } finally { button.disabled = false; }
  };
} else if (page === 'admin') {
  me().then(x => { if (!x.authenticated) location.href = '/login.html'; else mountEditor($('#desktop-editor')); }).catch(() => { location.href = '/login.html'; });
} else {
  let items = [], category = 'all', favoritesOnly = false, lastSync = null;
  let favorites;
  try { favorites = new Set(JSON.parse(localStorage.getItem('plu:favorites:v2') || '[]')); } catch { favorites = new Set(); }
  const safeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  $('#desktop-admin').hidden = native || mobileBrowser; $('#android-download').hidden = native;
  $('#app-editor-button').hidden = !native;
  $('#native-nav').hidden = !native;
  const editorRoot = $('#native-editor'); let editor;
  function barcode(svg, plu, large = false) {
    try { JsBarcode(svg, '000000' + String(plu).padStart(5, '0'), { format: 'upc', width: large ? 2.2 : 1.35, height: large ? 85 : 42, fontSize: large ? 20 : 11, margin: 8, background: '#fff', lineColor: '#132922', displayValue: true }); }
    catch { svg.replaceWith(document.createTextNode(`PLU ${plu}`)); }
  }
  function freshness(offline = false) {
    $('#sync-status').textContent = offline ? `Offline copy${lastSync ? ' · '+new Date(lastSync).toLocaleString() : ''}` : `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    $('#sync-status').classList.toggle('offline', offline);
  }
  function render() {
    const query = $('#search').value.trim().toLowerCase();
    const filtered = window.PLUSearch.searchItems(items, query, category).filter(i => !favoritesOnly || favorites.has(i.id));
    $('#count').textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;
    const grid = $('#grid'); grid.replaceChildren(); $('#empty').hidden = filtered.length > 0;
    for (const item of filtered) {
      const card = document.createElement('article'); card.className = 'produce-card';
      const top = document.createElement('div'); top.className = 'card-top';
      const chip = document.createElement('span'); chip.className = `category-chip ${item.cat}`; chip.textContent = labels[item.cat] || item.cat;
      const favorite = document.createElement('button'); favorite.className = 'favorite'; favorite.textContent = favorites.has(item.id) ? '★' : '☆'; favorite.setAttribute('aria-label', `${favorites.has(item.id) ? 'Unfavorite' : 'Favorite'} ${item.name}`); favorite.setAttribute('aria-pressed', String(favorites.has(item.id)));
      favorite.onclick = () => { if (favorites.has(item.id)) favorites.delete(item.id); else favorites.add(item.id); safeStore('plu:favorites:v2', [...favorites]); render(); };
      top.append(chip, favorite);
      const name = document.createElement('h2'); name.textContent = item.name;
      const plu = document.createElement('p'); plu.className = 'plu-number'; plu.textContent = item.plu;
      const open = document.createElement('button'); open.className = 'barcode-button'; open.setAttribute('aria-label', `Show larger barcode for ${item.name}`);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); open.append(svg); barcode(svg, item.plu);
      open.onclick = () => {
        $('#detail-name').textContent = item.name; $('#detail-plu').textContent = item.plu;
        const target = $('#detail-barcode'); target.replaceChildren(); const big = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); target.append(big); barcode(big, item.plu, true); $('#detail-dialog').showModal();
      };
      card.append(top, name, plu, open); grid.append(card);
    }
  }
  async function refresh() {
    try { const data = await request('/api/items'); if (!Array.isArray(data)) throw new Error('Invalid catalog'); items = data; lastSync = Date.now(); safeStore('plu:catalog:v2', { items, lastSync }); $('#empty').textContent = 'No matching produce. Try a name or a four/five-digit code.'; freshness(); render(); }
    catch {
      if (!items.length) { try { const cached = JSON.parse(localStorage.getItem('plu:catalog:v2') || '{}'); items = Array.isArray(cached.items) ? cached.items : []; lastSync = cached.lastSync; } catch {} }
      freshness(true); render(); if (!items.length) $('#empty').textContent = 'Could not load the catalog. Check your connection and try Refresh.';
    }
  }
  $('#close-detail').onclick = () => $('#detail-dialog').close();
  $('#refresh').onclick = refresh; $('#search').oninput = render;
  $('#clear-search').onclick = () => { $('#search').value = ''; $('#search').focus(); render(); };
  for (const btn of document.querySelectorAll('[data-cat]')) btn.onclick = () => { category = btn.dataset.cat; for (const b of document.querySelectorAll('[data-cat]')) b.setAttribute('aria-pressed', String(b === btn)); render(); };
  function browse(favs = false) { favoritesOnly = favs; $('#reader').hidden = false; editorRoot.hidden = true; $('#favorites-toggle').setAttribute('aria-pressed', String(favs)); render(); }
  $('#favorites-toggle').onclick = () => browse(!favoritesOnly);
  $('#nav-browse').onclick = () => browse(); $('#nav-favorites').onclick = () => browse(true);
  async function openEditor() {
    if (!native) return;
    let user; try { user = await me(); } catch { user = { authenticated: false }; }
    if (!user.authenticated) { $('#native-login-error').textContent = ''; $('#native-login').showModal(); return; }
    $('#reader').hidden = true; editorRoot.hidden = false;
    if (!editor) editor = mountEditor(editorRoot, { onChange: refresh, onLogout: () => { editor = null; editorRoot.replaceChildren(); browse(); } });
    else editor.refresh();
  }
  $('#app-editor-button').onclick = openEditor; $('#nav-edit').onclick = openEditor;
  $('#close-native-login').onclick = () => $('#native-login').close();
  $('#native-login-form').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const submit = f.querySelector('[type=submit]'); submit.disabled = true;
    try { await login(f.elements.username.value.trim(), f.elements.password.value); f.elements.password.value = ''; $('#native-login').close(); await openEditor(); }
    catch (err) { showError($('#native-login-error'), err.message); } finally { submit.disabled = false; }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  if (!native && typeof EventSource !== 'undefined') {
    const events = new EventSource('/api/events'); let timer;
    events.addEventListener('catalog', () => { clearTimeout(timer); timer = setTimeout(refresh, 150); });
    window.addEventListener('pagehide', () => events.close(), { once: true });
  }
  try { const cached = JSON.parse(localStorage.getItem('plu:catalog:v2') || '{}'); if (Array.isArray(cached.items)) { items = cached.items; lastSync = cached.lastSync; render(); $('#sync-status').textContent = 'Saved catalog · checking for updates'; } } catch {}
  refresh();
}
