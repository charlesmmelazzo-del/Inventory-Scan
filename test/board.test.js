const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
delete process.env.DATABASE_URL;
process.env.USER_MIKE_PASSWORD = 'pw';
process.env.AGENT_TOASTY_TOKEN = 'toasty-tok';
process.env.AGENT_CLAUDE_TOKEN = 'claude-tok';
process.env.SESSION_SECRET = 'test-secret';

const { buildApp, seedIfEmpty } = require('../src/server');
const { createStore } = require('../src/store');

let server, base;
before(async () => {
  const store = createStore();
  await store.init();
  await seedIfEmpty(store);
  server = buildApp(store).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const as = (tok) => ({ Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });

test('rejects unauthenticated API calls', async () => {
  assert.equal((await fetch(`${base}/api/messages`)).status, 401);
  assert.equal((await fetch(`${base}/api/messages`, { headers: as('wrong') })).status, 401);
});

test('seeds kickoff threads', async () => {
  const { messages } = await (await fetch(`${base}/api/messages`, { headers: as('toasty-tok') })).json();
  assert.ok(messages.length >= 5);
  assert.equal(messages[0].author, 'claude');
});

test('agent posts, replies inherit topic, unread excludes own posts', async () => {
  // drain toasty's unread
  await fetch(`${base}/api/messages/unread`, { headers: as('toasty-tok') });
  const r = await fetch(`${base}/api/messages`, { method: 'POST', headers: as('claude-tok'), body: JSON.stringify({ title: 'T', topic: 'pricing', body: 'hello' }) });
  assert.equal(r.status, 201);
  const { message } = await r.json();
  const rep = await (await fetch(`${base}/api/messages`, { method: 'POST', headers: as('toasty-tok'), body: JSON.stringify({ parent_id: message.id, body: 'reply', topic: 'general' }) })).json();
  assert.equal(rep.message.topic, 'pricing');
  assert.equal(rep.message.parent_id, message.id);

  const unread = await (await fetch(`${base}/api/messages/unread`, { headers: as('toasty-tok') })).json();
  assert.deepEqual(unread.messages.map((m) => m.body), ['hello']);
  const again = await (await fetch(`${base}/api/messages/unread`, { headers: as('toasty-tok') })).json();
  assert.equal(again.messages.length, 0);

  const thread = await (await fetch(`${base}/api/messages/${message.id}`, { headers: as('claude-tok') })).json();
  assert.equal(thread.replies.length, 1);
});

test('validates input and status', async () => {
  assert.equal((await fetch(`${base}/api/messages`, { method: 'POST', headers: as('claude-tok'), body: '{"body":""}' })).status, 400);
  assert.equal((await fetch(`${base}/api/messages`, { method: 'POST', headers: as('claude-tok'), body: '{"body":"x","topic":"nope"}' })).status, 400);
  const p = await fetch(`${base}/api/messages/1`, { method: 'PATCH', headers: as('claude-tok'), body: '{"status":"decided"}' });
  assert.equal((await p.json()).message.status, 'decided');
});

test('human browser login sets a cookie that works', async () => {
  const bad = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=mike&password=nope' });
  assert.match(bad.headers.get('location'), /error/);
  const ok = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=Mike&password=pw' });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.username, 'mike');
  assert.equal(me.kind, 'human');
  assert.ok(me.participants.some((p) => p.username === 'toasty'));
});

test('serves docs', async () => {
  const { docs } = await (await fetch(`${base}/api/docs`, { headers: as('toasty-tok') })).json();
  assert.ok(docs.some((d) => d.name === '01-PROJECT_BRIEF.md'));
  const txt = await (await fetch(`${base}/api/docs/01-PROJECT_BRIEF.md`, { headers: as('toasty-tok') })).text();
  assert.match(txt, /Inventory Debrief/);
});
