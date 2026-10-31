const express = require('express');
const path = require('path');
const fs = require('fs');
const { createStore, TOPICS } = require('./store');
const { checkLogin, requireAuth, sessionCookie, accounts } = require('./auth');

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
