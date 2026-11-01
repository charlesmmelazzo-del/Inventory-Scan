// Read-only mirror of the live CG Bible's Back Bar.
//
// Uses the SAME mechanism CG Bible's own test site uses (server/staging/sync.js in that repo):
//   GET <CGBIBLE_URL>/api/content-export   header X-Export-Key: <CONTENT_EXPORT_KEY>
// The live site returns a gzipped SQLite copy of its business content only (no people data).
// The export key is read-only on the live site, so nothing here can ever change live data.
//
// Env: CONTENT_EXPORT_KEY (same value as the live CG Bible project), optional CGBIBLE_URL.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_URL = 'https://common-good-cocktail-bible-production.up.railway.app';
const RESYNC_MS = 6 * 3600 * 1000;

const dataDir = () => process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = () => path.join(dataDir(), 'cgbible-mirror.db');

let db = null;
let state = { configured: !!process.env.CONTENT_EXPORT_KEY, last_sync: null, ok: null, error: null, products: 0 };
let running = null;

function open(file) {
  const Database = require('better-sqlite3');
  if (db) db.close();
  db = new Database(file, { readonly: true, fileMustExist: true });
  state.products = tableExists('bb_products') ? db.prepare('SELECT count(*) AS n FROM bb_products').get().n : 0;
}

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columns(table) {
  return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name));
}

/** Load a gzipped export (Buffer) into the mirror. Exposed for tests. */
function loadExport(gz) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = dbFile() + '.tmp';
  fs.writeFileSync(tmp, zlib.gunzipSync(gz));
  if (db) { db.close(); db = null; }
  fs.renameSync(tmp, dbFile());
  open(dbFile());
}

function sync(reason = 'manual') {
  if (running) return running;
  running = (async () => {
    const key = process.env.CONTENT_EXPORT_KEY;
    state.configured = !!key;
    try {
      if (!key) throw new Error('CONTENT_EXPORT_KEY is not set');
      const url = `${(process.env.CGBIBLE_URL || DEFAULT_URL).replace(/\/$/, '')}/api/content-export`;
      const res = await fetch(url, { headers: { 'X-Export-Key': key } });
      if (!res.ok) throw new Error(`Live export failed: HTTP ${res.status}`);
      loadExport(Buffer.from(await res.arrayBuffer()));
      Object.assign(state, { ok: true, error: null });
      console.log(`[cgbible] synced (${reason}): ${state.products} Back Bar products`);
    } catch (e) {
      Object.assign(state, { ok: false, error: e.message });
      console.error(`[cgbible] sync failed (${reason}): ${e.message}`);
    }
    state.last_sync = new Date().toISOString();
    return status();
  })().finally(() => { running = null; });
  return running;
}

function start() {
  if (fs.existsSync(dbFile())) { try { open(dbFile()); } catch (e) { console.error('[cgbible] could not open mirror', e.message); } }
  if (!process.env.CONTENT_EXPORT_KEY) {
    console.log('[cgbible] CONTENT_EXPORT_KEY not set – Back Bar mirror is off');
    return;
  }
  sync('startup');
  setInterval(() => sync('scheduled'), RESYNC_MS).unref();
}

function status() {
  return { ...state, loaded: !!db, running: !!running };
}

/**
 * Back Bar catalog: one row per product with its sizes, current pricing, section,
 * linked ingredient, and Learn About a Bottle link.
 */
function catalog() {
  if (!db || !tableExists('bb_products')) return [];
  const has = (t) => tableExists(t);
  const pc = columns('bb_products');
  const products = db.prepare(`
    SELECT p.id, p.name, p.producer, p.category, p.subcategory, p.status, p.par_level, p.allocated_rare,
           ${pc.has('spirit_library_entry_id') ? 'p.spirit_library_entry_id' : 'NULL'} AS library_entry_id,
           ${has('bb_sections') ? 's.name' : 'NULL'} AS section
      FROM bb_products p
      ${has('bb_sections') ? 'LEFT JOIN bb_sections s ON s.id = p.primary_section_id' : ''}
     ORDER BY p.category, p.name`).all();

  const variants = has('bb_size_variants')
    ? db.prepare('SELECT id, product_id, volume_ml, wholesale_cost, on_hand_count, last_counted_at FROM bb_size_variants').all()
    : [];
  const pricing = has('bb_pricing')
    ? db.prepare('SELECT product_id, cost_per_oz, price_1oz, price_highball, price_2oz, is_manual_override FROM bb_pricing').all()
    : [];
  const ingredients = has('ingredients') && columns('ingredients').has('bb_product_id')
    ? db.prepare('SELECT id, name, bb_product_id FROM ingredients WHERE bb_product_id IS NOT NULL').all()
    : [];

  const byProduct = (rows, key = 'product_id') => rows.reduce((m, r) => ((m[r[key]] = m[r[key]] || []).push(r), m), {});
  const v = byProduct(variants);
  const p = Object.fromEntries(pricing.map((r) => [r.product_id, r]));
  const ing = byProduct(ingredients, 'bb_product_id');

  return products.map((row) => ({
    ...row,
    allocated_rare: !!row.allocated_rare,
    sizes: (v[row.id] || []).map(({ product_id, ...rest }) => rest),
    pricing: p[row.id] ? (({ product_id, ...rest }) => rest)(p[row.id]) : null,
    ingredients: (ing[row.id] || []).map((i) => ({ id: i.id, name: i.name })),
  }));
}

module.exports = { start, sync, status, catalog, loadExport };
