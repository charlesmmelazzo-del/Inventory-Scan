const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { pricePours, roundUp, cleanSettings, markupFor } = require('../src/pricing');

test('rounds up to the step without float noise', () => {
  assert.equal(roundUp(6.0000001, 1), 6);
  assert.equal(roundUp(6.01, 1), 7);
  assert.equal(roundUp(6.31, 0.25), 6.5);
  assert.equal(roundUp(6.31, 0), 6.31);
});

test('prices 1 / 1.5 / 2 oz pours from cost with a decimal multiplier', () => {
  // $32 750 ml → 25.36 oz → $1.26/oz
  const q = pricePours({ bottle_cost: 32, volume_ml: 750 }, { multiplier: 4.5, rounding: 0.25, min_1oz: 0 });
  assert.equal(q.cost_per_oz, 1.26);
  assert.equal(q.multiplier, 4.5);
  assert.deepEqual(q.pours.map((p) => p.price), [5.75, 8.75, 11.5]);
  // effective markup after rounding is shown, never below the multiplier when rounding up
  for (const p of q.pours) assert.ok(p.markup >= 4.5);
});

test('default settings match CG Bible today: 4x, $6 floor, whole dollars', () => {
  const q = pricePours({ bottle_cost: 20, volume_ml: 1000 }, {});
  // $20 / 33.81 oz = $0.59/oz × 4 = $2.37 → $6 floor
  assert.deepEqual(q.pours.map((p) => p.price), [6, 9, 12]);
});

test('rejects bad input and clamps settings', () => {
  assert.equal(pricePours({ bottle_cost: 0, volume_ml: 750 }, {}), null);
  assert.equal(cleanSettings({ multiplier: 'abc' }).multiplier, 4);
  assert.equal(cleanSettings({ multiplier: '3.75' }).multiplier, 3.75);
  assert.equal(cleanSettings({ rounding: 0.33 }).rounding, 1);
  assert.equal(markupFor(10, 1.25, 2), 4);
});

// ---- Back Bar mirror + API, against a fake export shaped like CG Bible's tables ----
let server, base, dir;
const tok = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };

function fakeExport() {
  const Database = require('better-sqlite3');
  const f = path.join(dir, 'fake.db');
  const db = new Database(f);
  db.exec(`
    CREATE TABLE bb_sections (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE bb_products (id INTEGER PRIMARY KEY, name TEXT, producer TEXT, category TEXT, subcategory TEXT, status TEXT,
      par_level INTEGER, allocated_rare INTEGER, primary_section_id INTEGER, spirit_library_entry_id INTEGER);
    CREATE TABLE bb_size_variants (id INTEGER PRIMARY KEY, product_id INTEGER, volume_ml INTEGER, wholesale_cost REAL, on_hand_count REAL, last_counted_at TEXT);
    CREATE TABLE bb_pricing (product_id INTEGER, cost_per_oz REAL, price_1oz REAL, price_highball REAL, price_2oz REAL, is_manual_override INTEGER);
    CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name TEXT, bb_product_id INTEGER);
    INSERT INTO bb_sections VALUES (1, 'Top shelf');
    INSERT INTO bb_products VALUES (1, 'Buffalo Trace', 'Sazerac', 'Bourbon', '', 'in_stock', 2, 0, 1, 9),
                                   (2, 'Mystery Amaro', '', 'Amaro', '', 'in_stock', 1, 0, NULL, NULL);
    INSERT INTO bb_size_variants VALUES (10, 1, 750, 25, 0, NULL), (11, 1, 1000, 30, 2, NULL), (12, 2, 750, 0, 1, NULL);
    INSERT INTO bb_pricing VALUES (1, 0.89, 6, 9, 12, 0);
    INSERT INTO ingredients VALUES (5, 'Buffalo Trace Bourbon', 1);`);
  db.close();
  return zlib.gzipSync(fs.readFileSync(f));
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-'));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  process.env.AGENT_T_TOKEN = 't';
  require('../src/cgbible').loadExport(fakeExport());
  const { buildApp } = require('../src/server');
  const store = require('../src/store').createStore();
  await store.init();
  server = buildApp(store).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

test('mirror exposes Back Bar products with sizes, pricing, section, ingredient links', async () => {
  const d = await (await fetch(`${base}/api/backbar`, { headers: tok })).json();
  assert.equal(d.status.products, 2);
  const bt = d.products.find((p) => p.name === 'Buffalo Trace');
  assert.equal(bt.section, 'Top shelf');
  assert.equal(bt.sizes.length, 2);
  assert.equal(bt.pricing.price_1oz, 6);
  assert.deepEqual(bt.ingredients, [{ id: 5, name: 'Buffalo Trace Bourbon' }]);
});

test('review uses the in-stock size as the cost basis and respects saved multiplier', async () => {
  await fetch(`${base}/api/pricing/settings`, { method: 'PUT', headers: tok, body: JSON.stringify({ multiplier: 5.5, rounding: 0.5, min_1oz: 0 }) });
  const d = await (await fetch(`${base}/api/pricing/review`, { headers: tok })).json();
  assert.equal(d.settings.multiplier, 5.5);
  const bt = d.products.find((p) => p.name === 'Buffalo Trace');
  assert.equal(bt.basis.volume_ml, 1000); // the 1 L is the one in stock
  assert.equal(bt.proposal.cost_per_oz, 0.89);
  const amaro = d.products.find((p) => p.name === 'Mystery Amaro');
  assert.equal(amaro.proposal, null); // no cost yet → needs Fintech/Provi
});

test('approval records human-edited prices with the resulting markup', async () => {
  const r = await fetch(`${base}/api/pricing/approve`, { method: 'POST', headers: tok, body: JSON.stringify({
    product_id: 1, name: 'Buffalo Trace', volume_ml: 1000, cost_bottle: 30, prices: { '1oz': 7, highball: 10, '2oz': 13 } }) });
  assert.equal(r.status, 201);
  const { approval } = await r.json();
  assert.equal(approval.approved_by, 't');
  assert.equal(approval.markups['1oz'], 7.89); // $7 / ($30 / 33.81 oz)
  const bad = await fetch(`${base}/api/pricing/approve`, { method: 'POST', headers: tok, body: JSON.stringify({ name: 'x', volume_ml: 750, cost_bottle: 20, prices: { '1oz': 7 } }) });
  assert.equal(bad.status, 400);
  const list = await (await fetch(`${base}/api/pricing/approved`, { headers: tok })).json();
  assert.equal(list.approvals.length, 1);
});
