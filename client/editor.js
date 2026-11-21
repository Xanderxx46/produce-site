import { request, adminPath, auditPath, logout, native } from './api';
export function mountEditor(root, { onChange = () => {}, onLogout = () => {} } = {}) {
  let items = [], editing = null;
  root.innerHTML = `<div class="editor-top"><div><p class="eyebrow">YOUR CATALOG</p><h1>Make a little change.</h1><p class="muted">One catalog. Changes show on the website and app.</p></div><button class="btn quiet" id="signout">Sign out</button></div>
  <div class="editor-tools"><label class="search compact"><span>⌕</span><input id="admin-search" type="search" placeholder="Find a name or PLU…" aria-label="Search catalog"></label><button class="btn" id="new-item">＋ Add item</button><button class="btn quiet" id="history">Activity</button><button class="btn quiet" id="refresh-admin">Refresh</button></div>
  <p id="editor-status" role="status" class="message"></p><div class="table-wrap"><table><thead><tr><th>Produce</th><th>PLU</th><th>Category</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="admin-rows"></tbody></table></div>
  <dialog id="item-dialog"><form id="item-form"><div class="dialog-head"><h2 id="form-title">Add produce</h2><button type="button" class="icon-btn" id="close-item" aria-label="Close">×</button></div>
  <label>Name<input name="name" required maxlength="120" autocomplete="off" placeholder="e.g. Bananas, Yellow"></label><div class="form-pair"><label>PLU<input name="plu" required inputmode="numeric" pattern="[0-9]{4,5}" maxlength="5" autocomplete="off" placeholder="4011"></label><label>Category<select name="cat"><option value="fruit">Fruit</option><option value="veg">Vegetables</option><option value="dry">Pantry</option></select></label></div>
  <p class="muted small">Keep size/variety in the name. Only add codes you can verify for your store.</p><p class="message" id="form-error" role="alert"></p><button class="btn wide" type="submit" id="save-item">Save item</button></form></dialog>
  <dialog id="history-dialog"><div class="dialog-head"><h2>Recent activity</h2><button class="icon-btn" id="close-history" aria-label="Close">×</button></div><div id="audit-list"></div></dialog>`;
  const $ = s => root.querySelector(s);
  const status = (text, bad = false) => { $('#editor-status').textContent = text; $('#editor-status').classList.toggle('bad', bad); };
  const labels = { fruit: 'Fruit', veg: 'Vegetables', dry: 'Pantry' };
  async function refresh() {
    items = await request('/api/items'); render();
  }
  function render() {
    const query = $('#admin-search').value.toLowerCase(); const rows = $('#admin-rows'); rows.replaceChildren();
    for (const item of window.PLUSearch.searchItems(items, query, 'all')) {
      const tr = document.createElement('tr');
      for (const text of [item.name, item.plu, labels[item.cat] || item.cat]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      const td = document.createElement('td'); td.className = 'row-actions';
      const edit = document.createElement('button'); edit.className = 'btn tiny quiet'; edit.textContent = 'Edit'; edit.onclick = () => open(item);
      const del = document.createElement('button'); del.className = 'btn tiny danger'; del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm(`Delete ${item.name} (${item.plu})? You can restore it from Activity.`)) return;
        del.disabled = true;
        try { await request(`${adminPath}/${item.id}`, { method: 'DELETE', data: { revision: item.revision } }); await refresh(); onChange(); status('Item removed. Restore it from Activity if needed.'); }
        catch (e) { status(e.message, true); await refresh().catch(() => {}); } finally { del.disabled = false; }
      };
      td.append(edit, del); tr.append(td); rows.append(tr);
    }
    if (!rows.children.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 4; td.textContent = 'No matching items.'; tr.append(td); rows.append(tr); }
  }
  function open(item) {
    editing = item || null; const form = $('#item-form'); form.reset(); $('#form-error').textContent = ''; $('#form-title').textContent = item ? 'Edit produce' : 'Add produce';
    if (item) for (const key of ['name','plu','cat']) form.elements[key].value = item[key];
    $('#item-dialog').showModal();
  }
  $('#new-item').onclick = () => open(); $('#close-item').onclick = () => $('#item-dialog').close();
  $('#close-history').onclick = () => $('#history-dialog').close(); $('#admin-search').oninput = render; $('#refresh-admin').onclick = () => refresh().then(() => status('Catalog refreshed.')).catch(e => status(e.message, true));
  $('#signout').onclick = async () => { await logout().catch(() => {}); if (native) onLogout(); else location.href = '/'; };
  $('#item-form').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const data = { name: f.get('name'), plu: f.get('plu'), cat: f.get('cat') };
    if (editing) data.revision = editing.revision;
    $('#save-item').disabled = true; $('#form-error').textContent = '';
    try {
      await request(editing ? `${adminPath}/${editing.id}` : adminPath, { method: editing ? 'PATCH' : 'POST', data });
      $('#item-dialog').close(); await refresh(); onChange(); status(editing ? 'Changes saved.' : 'Item added.');
    } catch (err) { $('#form-error').textContent = err.message; }
    finally { $('#save-item').disabled = false; }
  };
  $('#history').onclick = async () => {
    try {
      const entries = await request(auditPath); const list = $('#audit-list'); list.replaceChildren();
      if (!entries.length) list.textContent = 'No activity yet.';
      for (const entry of entries) {
        const row = document.createElement('article'); row.className = 'audit-entry';
        const before = entry.before_json ? JSON.parse(entry.before_json) : null; const after = entry.after_json ? JSON.parse(entry.after_json) : null;
        const title = document.createElement('strong'); title.textContent = `${entry.action} · ${(after || before)?.name || 'Item'}`;
        const meta = document.createElement('small'); meta.textContent = `${entry.created_at} UTC · ${entry.actor}`; row.append(title, meta);
        if (entry.action === 'delete') {
          const btn = document.createElement('button'); btn.className = 'btn tiny quiet'; btn.textContent = 'Restore';
          btn.onclick = async () => { btn.disabled = true; try { await request(`${auditPath}/${entry.id}/restore`, { method: 'POST', data: {} }); await refresh(); onChange(); btn.textContent = 'Restored'; } catch (e) { btn.disabled = false; status(e.message, true); } };
          row.append(btn);
        }
        list.append(row);
      }
      $('#history-dialog').showModal();
    } catch (e) { status(e.message, true); }
  };
  const ready = refresh().catch(e => status(e.message, true));
  return { ready, refresh };
}
