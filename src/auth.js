// Deliberately simple auth for the test phase (the owner asked for open access during prototyping).
// Accounts and secrets come ONLY from environment variables, because this repo is public.
//
//   Humans  (browser login, 1-year cookie):  USER_<NAME>_PASSWORD=...
//   Agents  (Bearer token, never expires):   AGENT_<NAME>_TOKEN=...
//
// e.g. USER_MIKE_PASSWORD, AGENT_TOASTY_TOKEN, AGENT_CLAUDE_TOKEN
// Agents may also log in to the browser UI using their token as the password.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ONE_YEAR = 365 * 24 * 3600 * 1000;

function accounts() {
  const humans = {};
  const agents = {};
  for (const [k, v] of Object.entries(process.env)) {
    let m;
    if (v && (m = k.match(/^USER_([A-Z0-9_]+)_PASSWORD$/))) humans[m[1].toLowerCase()] = v;
    if (v && (m = k.match(/^AGENT_([A-Z0-9_]+)_TOKEN$/))) agents[m[1].toLowerCase()] = v;
  }
  return { humans, agents };
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  const p = JSON.parse(Buffer.from(data, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}

function checkLogin(username, password) {
  const u = String(username || '').trim().toLowerCase();
  const { humans, agents } = accounts();
  if (humans[u] && safeEqual(password, humans[u])) return { username: u, kind: 'human' };
  if (agents[u] && safeEqual(password, agents[u])) return { username: u, kind: 'agent' };
  return null;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function identify(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const tok = auth.slice(7).trim();
    const { agents } = accounts();
    for (const [name, secret] of Object.entries(agents)) {
      if (safeEqual(tok, secret)) return { username: name, kind: 'agent' };
    }
    return null;
  }
  const s = verify(parseCookies(req.headers.cookie).session);
  return s ? { username: s.u, kind: s.k } : null;
}

function requireAuth(req, res, next) {
  const who = identify(req);
  if (!who) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/login');
  }
  req.user = who;
  next();
}

function sessionCookie(user) {
  const token = sign({ u: user.username, k: user.kind, exp: Date.now() + ONE_YEAR });
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR / 1000}`;
}

module.exports = { checkLogin, requireAuth, sessionCookie, accounts, identify };
