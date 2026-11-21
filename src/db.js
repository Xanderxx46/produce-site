const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

function createStore(filename = process.env.PLU_DB_PATH || path.join(__dirname, '..', 'data', 'plu.db')) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, es TEXT NOT NULL DEFAULT '',
    plu TEXT NOT NULL UNIQUE, cat TEXT NOT NULL CHECK(cat IN ('fruit','veg','dry')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const columns = new Set(db.prepare('PRAGMA table_info(items)').all().map(x => x.name));
  if (!columns.has('revision')) db.exec('ALTER TABLE items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
  if (!columns.has('updated_at')) db.exec("ALTER TABLE items ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_cat ON items(cat);
    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
    CREATE TABLE IF NOT EXISTS catalog_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO catalog_meta VALUES(1,1);
    CREATE TABLE IF NOT EXISTS item_audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, item_id INTEGER NOT NULL,
      actor TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  `);
  const fields = "id,name,plu,cat,revision,COALESCE(NULLIF(updated_at,''),created_at) AS updated_at";
  const getItemById = id => db.prepare(`SELECT *, COALESCE(NULLIF(updated_at,''),created_at) AS updated_at FROM items WHERE id=?`).get(id);
  const getItemByPlu = plu => db.prepare(`SELECT ${fields} FROM items WHERE plu=?`).get(plu);
  function audit(action, id, actor, before, after) {
    db.prepare('INSERT INTO item_audit(action,item_id,actor,before_json,after_json) VALUES(?,?,?,?,?)')
      .run(action, id, actor, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
    db.prepare('UPDATE catalog_meta SET revision=revision+1 WHERE id=1').run();
  }
  const createItem = db.transaction((item, actor = 'web-admin') => {
    const info = db.prepare('INSERT INTO items(name,es,plu,cat,updated_at) VALUES(?,?,?,?,datetime(\'now\'))')
      .run(item.name, item.es || '', item.plu, item.cat);
    const after = getItemById(info.lastInsertRowid); audit('create', after.id, actor, null, after); return after;
  });
  const updateItem = db.transaction((id, item, expectedRevision, actor = 'web-admin') => {
    const before = getItemById(id);
    if (!before) return { error: 'not_found' };
    if (expectedRevision !== undefined && expectedRevision !== before.revision) return { error: 'conflict', current: before };
    db.prepare("UPDATE items SET name=?,plu=?,cat=?,revision=revision+1,updated_at=datetime('now') WHERE id=?")
      .run(item.name, item.plu, item.cat, id);
    const after = getItemById(id); audit('update', id, actor, before, after); return { item: after };
  });
  const deleteItem = db.transaction((id, expectedRevision, actor = 'web-admin') => {
    const before = getItemById(id);
    if (!before) return { error: 'not_found' };
    if (expectedRevision !== undefined && before.revision !== expectedRevision) return { error: 'conflict', current: before };
    db.prepare('DELETE FROM items WHERE id=?').run(id); audit('delete', id, actor, before, null); return { item: before };
  });
  const restoreItem = db.transaction((auditId, actor = 'web-admin') => {
    const row = db.prepare("SELECT * FROM item_audit WHERE id=? AND action='delete'").get(auditId);
    if (!row) return { error: 'not_found' };
    const before = JSON.parse(row.before_json);
    if (getItemById(before.id) || getItemByPlu(before.plu)) return { error: 'conflict' };
    db.prepare("INSERT INTO items(id,name,es,plu,cat,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'))")
      .run(before.id, before.name, before.es || '', before.plu, before.cat, before.revision + 1, before.created_at || new Date().toISOString());
    const after = getItemById(before.id); audit('restore', after.id, actor, null, after); return { item: after };
  });
  const seedItems = db.transaction(rows => {
    const insert = db.prepare('INSERT OR IGNORE INTO items(name,es,plu,cat) VALUES(?,?,?,?)');
    for (const i of rows) insert.run(i.name, i.es || '', String(i.plu), i.cat);
    return db.prepare('SELECT count(*) n FROM items').get().n;
  });
  return {
    db, createItem, updateItem, deleteItem, restoreItem, seedItems, getItemById, getItemByPlu,
    listItems: () => db.prepare(`SELECT ${fields} FROM items ORDER BY name COLLATE NOCASE`).all(),
    countItems: () => db.prepare('SELECT count(*) n FROM items').get().n,
    revision: () => db.prepare('SELECT revision FROM catalog_meta WHERE id=1').get().revision,
    listAudit: () => db.prepare('SELECT * FROM item_audit ORDER BY id DESC LIMIT 40').all(),
    close: () => db.close()
  };
}
// Lazy compatibility for seed.js, without opening a production database on import in tests.
let defaultStore;
module.exports = { createStore };
for (const key of ['db','seedItems','getItemById','getItemByPlu','createItem','deleteItem','countItems','listItems']) {
  Object.defineProperty(module.exports, key, { get() { defaultStore ||= createStore(); return defaultStore[key]; } });
}
