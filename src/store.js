// Storage layer for the message board.
// Uses Postgres when DATABASE_URL is set (Railway), otherwise a JSON file on disk (local dev / tests).
const fs = require('fs');
const path = require('path');

const TOPICS = ['general', 'research', 'scan-flow', 'debrief', 'pricing', 'toast-sync', 'fintech', 'data-model', 'testing', 'decision'];

function normalize(m) {
  return {
    id: Number(m.id),
    author: m.author,
    topic: m.topic || 'general',
    parent_id: m.parent_id == null ? null : Number(m.parent_id),
    title: m.title || null,
    body: m.body,
    status: m.status || 'open',
    created_at: new Date(m.created_at).toISOString(),
  };
}

class FileStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { seq: 0, messages: [], reads: {} };
    this.data.reads = this.data.reads || {};
  }
  async init() {}
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
  async create({ author, topic, parent_id, title, body }) {
    const m = { id: ++this.data.seq, author, topic, parent_id: parent_id ?? null, title: title ?? null, body, status: 'open', created_at: new Date().toISOString() };
    this.data.messages.push(m);
    this.save();
    return normalize(m);
  }
  async list({ since_id = 0, topic, limit = 200 } = {}) {
    return this.data.messages
      .filter((m) => m.id > since_id && (!topic || m.topic === topic))
      .slice(-limit)
      .map(normalize);
  }
  async get(id) {
    const m = this.data.messages.find((x) => x.id === id);
    return m ? normalize(m) : null;
  }
  async setStatus(id, status) {
    const m = this.data.messages.find((x) => x.id === id);
    if (!m) return null;
    m.status = status;
    this.save();
    return normalize(m);
  }
  async count() { return this.data.messages.length; }
  async getRead(user) { return this.data.reads[user] || 0; }
  async setRead(user, id) { this.data.reads[user] = Math.max(this.data.reads[user] || 0, id); this.save(); }
}

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    const ssl = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url) ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: url, ssl });
  }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS board_messages (
        id SERIAL PRIMARY KEY,
        author TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT 'general',
        parent_id INTEGER REFERENCES board_messages(id),
        title TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS board_reads (
        username TEXT PRIMARY KEY,
        last_read_id INTEGER NOT NULL DEFAULT 0
      );`);
  }
  async create({ author, topic, parent_id, title, body }) {
    const r = await this.pool.query(
      'INSERT INTO board_messages (author, topic, parent_id, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [author, topic, parent_id ?? null, title ?? null, body]
    );
    return normalize(r.rows[0]);
  }
  async list({ since_id = 0, topic, limit = 200 } = {}) {
    const params = [since_id];
    let q = 'SELECT * FROM board_messages WHERE id > $1';
    if (topic) { params.push(topic); q += ` AND topic = $${params.length}`; }
    params.push(limit);
    q += ` ORDER BY id DESC LIMIT $${params.length}`;
    const r = await this.pool.query(q, params);
    return r.rows.reverse().map(normalize);
  }
  async get(id) {
    const r = await this.pool.query('SELECT * FROM board_messages WHERE id = $1', [id]);
    return r.rows[0] ? normalize(r.rows[0]) : null;
  }
  async setStatus(id, status) {
    const r = await this.pool.query('UPDATE board_messages SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
    return r.rows[0] ? normalize(r.rows[0]) : null;
  }
  async count() {
    const r = await this.pool.query('SELECT count(*)::int AS n FROM board_messages');
    return r.rows[0].n;
  }
  async getRead(user) {
    const r = await this.pool.query('SELECT last_read_id FROM board_reads WHERE username = $1', [user]);
    return r.rows[0] ? r.rows[0].last_read_id : 0;
  }
  async setRead(user, id) {
    await this.pool.query(
      `INSERT INTO board_reads (username, last_read_id) VALUES ($1,$2)
       ON CONFLICT (username) DO UPDATE SET last_read_id = GREATEST(board_reads.last_read_id, EXCLUDED.last_read_id)`,
      [user, id]
    );
  }
}

function createStore() {
  if (process.env.DATABASE_URL) return new PgStore(process.env.DATABASE_URL);
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  return new FileStore(path.join(dir, 'board.json'));
}

module.exports = { createStore, TOPICS };
