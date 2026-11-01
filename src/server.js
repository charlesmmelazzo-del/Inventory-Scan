const express = require('express');
const path = require('path');
const fs = require('fs');
const { createStore, TOPICS } = require('./store');
const { checkLogin, requireAuth, sessionCookie, accounts } = require('./auth');
const cgbible = require('./cgbible');
const pricing = require('./pricing');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

function buildApp(store) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // ---- login / logout ----
  app.get('/login', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
  app.post('/login', (req, res) => {
    const user = checkLogin(req.body.username, req.body.password);
    if (!user) return res.redirect('/login?error=1');
    res.setHeader('Set-Cookie', sessionCookie(user));
    res.redirect('/');
  });
  app.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
    res.redirect('/login');
  });

  // Everything below requires a session cookie or an agent Bearer token.
  app.use(requireAuth);
  app.use(express.static(path.join(ROOT, 'public')));

  // ---- API: identity ----
  app.get('/api/me', async (req, res) => {
    const { humans, agents } = accounts();
    res.json({
      ...req.user,
      last_read_id: await store.getRead(req.user.username),
      participants: [...Object.keys(humans).map((n) => ({ username: n, kind: 'human' })), ...Object.keys(agents).map((n) => ({ username: n, kind: 'agent' }))],
      topics: TOPICS,
    });
  });

  // ---- API: message board ----
  // GET /api/messages?since_id=0&topic=pricing&limit=200
  app.get('/api/messages', async (req, res) => {
    const since_id = parseInt(req.query.since_id, 10) || 0;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const topic = req.query.topic && TOPICS.includes(req.query.topic) ? req.query.topic : undefined;
    res.json({ messages: await store.list({ since_id, topic, limit }) });
  });

  // GET /api/messages/unread  -> everything newer than this user's read marker, then advances it
  app.get('/api/messages/unread', async (req, res) => {
    const last = await store.getRead(req.user.username);
    const messages = await store.list({ since_id: last, limit: 1000 });
    const others = messages.filter((m) => m.author !== req.user.username);
    if (messages.length && req.query.peek !== '1') await store.setRead(req.user.username, messages[messages.length - 1].id);
    res.json({ previous_last_read_id: last, messages: others });
  });

  // POST /api/messages/read { id }  -> advance this user's read marker
  app.post('/api/messages/read', async (req, res) => {
    const id = parseInt(req.body && req.body.id, 10);
    if (!id) return res.status(400).json({ error: 'id required' });
    await store.setRead(req.user.username, id);
    res.json({ ok: true });
  });

  app.get('/api/messages/:id', async (req, res) => {
    const m = await store.get(parseInt(req.params.id, 10));
    if (!m) return res.status(404).json({ error: 'not found' });
    const all = await store.list({ limit: 1000 });
    res.json({ message: m, replies: all.filter((x) => x.parent_id === m.id) });
  });

  // POST /api/messages  { body, title?, topic?, parent_id? }
  app.post('/api/messages', async (req, res) => {
    const { body, title, topic = 'general', parent_id } = req.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'body is required' });
    if (!TOPICS.includes(topic)) return res.status(400).json({ error: `topic must be one of: ${TOPICS.join(', ')}` });
    let parent = null;
    if (parent_id != null) {
      parent = await store.get(Number(parent_id));
      if (!parent) return res.status(400).json({ error: 'parent_id not found' });
    }
    const m = await store.create({
      author: req.user.username,
      topic: parent ? parent.topic : topic,
      parent_id: parent ? parent.id : null,
      title: parent ? null : title || null,
      body: body.trim(),
    });
    res.status(201).json({ message: m });
  });

  // PATCH /api/messages/:id  { status: open | resolved | decided }
  app.patch('/api/messages/:id', async (req, res) => {
    const { status } = req.body || {};
    if (!['open', 'resolved', 'decided'].includes(status)) return res.status(400).json({ error: 'status must be open|resolved|decided' });
    const m = await store.setStatus(parseInt(req.params.id, 10), status);
    if (!m) return res.status(404).json({ error: 'not found' });
    res.json({ message: m });
  });

  // Whole board as one Markdown page — easiest for browser-based agents (ChatGPT agent mode) to read.
  app.get('/api/board.md', async (_req, res) => {
    const all = await store.list({ limit: 1000 });
    const roots = all.filter((m) => !m.parent_id).reverse();
    const out = ['# Inventory Scan board', ''];
    for (const r of roots) {
      out.push(`## #${r.id} [${r.topic}] [${r.status}] ${r.title || ''}`.trim(), `*${r.author} · ${r.created_at}*`, '', r.body, '');
      for (const x of all.filter((m) => m.parent_id === r.id)) out.push(`> **${x.author}** · ${x.created_at} · #${x.id}`, '>', ...x.body.split('\n').map((l) => `> ${l}`), '');
      out.push('---', '');
    }
    res.type('text/markdown').send(out.join('\n'));
  });

  // ---- API: CG Bible Back Bar mirror (read-only) ----
  app.get('/api/backbar/status', (_req, res) => res.json(cgbible.status()));
  app.post('/api/backbar/sync', async (_req, res) => res.json(await cgbible.sync('on demand')));
  app.get('/api/backbar', (_req, res) => res.json({ status: cgbible.status(), products: cgbible.catalog() }));

  // ---- API: Pour Price Calculator ----
  const getPricing = async () => pricing.cleanSettings((await store.getSetting('pricing')) || {});
  app.get('/api/pricing/settings', async (_req, res) => res.json({ settings: await getPricing(), defaults: pricing.DEFAULT_SETTINGS }));
  app.put('/api/pricing/settings', async (req, res) => {
    const settings = pricing.cleanSettings({ ...(await getPricing()), ...(req.body || {}) });
    await store.setSetting('pricing', settings);
    res.json({ settings });
  });
  // POST { bottle_cost, volume_ml, multiplier? } → cost/oz and 1 / 1.5 / 2 oz prices
  app.post('/api/pricing/quote', async (req, res) => {
    const b = req.body || {};
    const q = pricing.pricePours(b, { ...(await getPricing()), ...(b.multiplier ? { multiplier: b.multiplier } : {}) });
    if (!q) return res.status(400).json({ error: 'bottle_cost and volume_ml must be positive numbers' });
    res.json({ quote: q });
  });
  // Every Back Bar product with a cost, proposed prices next to what CG Bible has today.
  app.get('/api/pricing/review', async (_req, res) => {
    const s = await getPricing();
    const rows = cgbible.catalog().map((p) => {
      const costed = p.sizes.filter((v) => v.wholesale_cost > 0);
      const inStock = costed.filter((v) => v.on_hand_count > 0);
      const pool = inStock.length ? inStock : costed; // same basis rule CG Bible uses
      const basis = pool.reduce((best, v) => (!best || v.wholesale_cost > best.wholesale_cost ? v : best), null);
      return {
        product_id: p.id, name: p.name, producer: p.producer, category: p.category, status: p.status,
        allocated_rare: p.allocated_rare, current: p.pricing,
        basis: basis ? { variant_id: basis.id, volume_ml: basis.volume_ml, cost: basis.wholesale_cost } : null,
        proposal: basis ? pricing.pricePours({ bottle_cost: basis.wholesale_cost, volume_ml: basis.volume_ml }, s) : null,
      };
    });
    res.json({ settings: s, status: cgbible.status(), products: rows });
  });
  // Human approval of final prices. Prototype: recorded here; later this feeds CG Bible's bb_pos_queue / Toast.
  app.post('/api/pricing/approve', async (req, res) => {
    const b = req.body || {};
    const prices = b.prices || {};
    const costPerOz = Number(b.cost_bottle) / (Number(b.volume_ml) / pricing.ML_PER_OZ);
    if (!b.name || !(costPerOz > 0) || !pricing.POURS.every((p) => Number(prices[p.key]) > 0)) {
      return res.status(400).json({ error: 'name, cost_bottle, volume_ml and prices for 1oz, highball, 2oz are required' });
    }
    const row = await store.addPriceReview({
      product_id: b.product_id ?? null, name: b.name, volume_ml: Number(b.volume_ml), cost_bottle: Number(b.cost_bottle),
      cost_per_oz: Math.round(costPerOz * 100) / 100,
      prices: Object.fromEntries(pricing.POURS.map((p) => [p.key, Number(prices[p.key])])),
      markups: Object.fromEntries(pricing.POURS.map((p) => [p.key, pricing.markupFor(Number(prices[p.key]), costPerOz, p.oz)])),
      approved_by: req.user.username, destination: 'pending: Toast publish (not wired yet)',
    });
    res.status(201).json({ approval: row });
  });
  app.get('/api/pricing/approved', async (_req, res) => res.json({ approvals: await store.listPriceReviews() }));

  // ---- API: project docs (the shared brief both agents work from) ----
  app.get('/api/docs', (_req, res) => {
    const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).sort();
    res.json({ docs: files.map((f) => ({ name: f, url: `/api/docs/${f}` })) });
  });
  app.get('/api/docs/:name', (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(DOCS_DIR, name);
    if (!name.endsWith('.md') || !fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    res.type('text/markdown').send(fs.readFileSync(file, 'utf8'));
  });

  return app;
}

async function seedIfEmpty(store) {
  if ((await store.count()) > 0) return;
  const seedFile = path.join(ROOT, 'docs', 'seed-messages.json');
  if (!fs.existsSync(seedFile)) return;
  for (const m of JSON.parse(fs.readFileSync(seedFile, 'utf8'))) await store.create(m);
}

async function main() {
  const store = createStore();
  await store.init();
  await seedIfEmpty(store);
  cgbible.start();
  const app = buildApp(store);
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    const { humans, agents } = accounts();
    console.log(`inventory-scan listening on :${port}`);
    console.log(`storage: ${process.env.DATABASE_URL ? 'postgres' : 'json file'}`);
    console.log(`humans: ${Object.keys(humans).join(', ') || '(none – set USER_<NAME>_PASSWORD)'}`);
    console.log(`agents: ${Object.keys(agents).join(', ') || '(none – set AGENT_<NAME>_TOKEN)'}`);
    if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set – browser logins will reset on every deploy');
  });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { buildApp, seedIfEmpty };
