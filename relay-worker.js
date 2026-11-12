/* Menu Hauler website and relay: the Cloudflare Worker "menurunner" (free plan), at https://menuhauler.com
   (also menurunner.ochudson05.workers.dev, which the claude.ai copy's relay setting uses).

   It serves the tools as a website (the files in public/, built by build_apps.py) and the API they use there:
     /login, /auth/start, /auth/verify, /auth/logout   sign-in with a 6-digit code emailed to an allowed address
     /api/me                  who is signed in, and what they may do
     /api/account             your own account for the settings panel: details, display name, sign out everywhere
     /api/seen                which tool a person opened (for the admin page)
     /api/admin/*             the admin page (/admin): people, permissions, activity; owner and admins only
     /api/intake/*            customer intake links for a venue (signed in); /api/public/intake/<token> is the form's own API
     /intake/<token>          the customer intake form (public/intake.html), open to anyone with the link
     /api/db/list|get|set|update|delete   the shared venue records (D1 database "oolio-tools", table docs)
     /api/fc                  Firecrawl scrape / search with the team's key, capped per month
     /api/fetch?url=...       downloads a web page, PDF, menu feed or picture for the page (free; the browser can't)
   and the original relay endpoints, which the claude.ai version still uses:
     /ping  /place?q=  /page?url=  /search?q=

   Who can use it: everything except /login, /auth/*, /legal/* and /.well-known/* needs a signed-in session
   (cookie mh_session, 30 days; D1 table sessions). Codes go only to the owner, people added on /admin (D1 table users,
   unless blocked), ALLOWED_EMAILS, or emails in the allowed domains (set on /admin, else ALLOWED_DOMAINS). The relay endpoints also accept the old ?t=RELAY_TOKEN.
   wrangler.toml sets run_worker_first, so the page files themselves are behind the sign-in too.

   Deploying: Cloudflare deploys this automatically when it's pushed to the main branch on GitHub (Workers Builds,
   settings in wrangler.toml), so don't edit it in the dashboard.
   Set in Cloudflare (menurunner → Settings → Variables and Secrets):
     RESEND_KEY      secret  Resend API key (re_...), sends the sign-in codes
     AUTH_SECRET     secret  any long random text; scrambles stored codes and sessions
     ALLOWED_DOMAINS text (optional)  email domains that may sign in, comma-separated, default "oolio.com"
     ALLOWED_EMAILS  text (optional)  extra single addresses, comma-separated (the owner's is built in)
     MAIL_FROM       text (optional)  sender, default "Menu Hauler <login@menuhauler.com>" (verify the domain in Resend)
     GOOGLE_KEY      secret  Google Maps Platform key (Places API (New))
     RELAY_TOKEN     secret  password for the old relay endpoints
     FIRECRAWL_KEY   secret  Firecrawl API key (fc-...)
     ABR_GUID        secret  ABN Lookup GUID, shared by the team
     FIRECRAWL_MONTHLY_CAP  text (optional)  Firecrawl credits the site may use per month, default 500
     ANTHROPIC_API_KEY secret (optional)  Claude API key (sk-ant-...). Without it Claude is simply off on the website.
     CLAUDE_OFF      text (optional)  "1" turns Claude off for everyone, whatever /admin says (an emergency stop)
     SERVER_URL      text (optional)  the Menu Hauler server's address through its Cloudflare Tunnel, e.g. https://server.menuhauler.com
                     (server/README.md: any Linux VM with Docker; Google Cloud for now)
     SERVER_KEY      secret (optional) the key that server's gateway expects (MH_KEY in server/.env). Both set = the menu
                     scraper (/api/server/scrape) and OCR second opinion (/api/server/ocr) are on, and the small local
                     model too if the server runs it (LOCAL_MODEL_ON = "1").
     LOCAL_MODEL_ON  text (optional)  "1" when the server runs the local model (the "local-model" profile in server/)
     LOCAL_MODEL     text (optional)  the local model's name on that server, default "qwen3:4b" (LOCAL_MODEL in server/.env)
     GEMINI_KEY      secret (optional) a Gemini API key (Google AI Studio or Google Cloud). Set = /admin offers Gemini for small jobs.
     GEMINI_MODEL    text (optional)  which Gemini model, default "gemini-2.5-flash-lite"

   Claude on the website (/api/claude) is off until the owner turns it on at /admin, and then only for people the
   owner has ticked one by one. Every call is checked against per-minute, per-day and monthly limits, a site-wide
   monthly spending cap, and size limits; the model and its settings are chosen here, never by the page.
*/
const FIELDS = [
  'id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'location',
  'rating', 'userRatingCount', 'priceLevel', 'businessStatus', 'primaryTypeDisplayName', 'editorialSummary',
  'regularOpeningHours.weekdayDescriptions', 'reviews',
  'dineIn', 'takeout', 'delivery', 'curbsidePickup', 'reservable', 'servesBreakfast', 'servesBrunch', 'servesLunch',
  'servesDinner', 'servesCoffee', 'servesBeer', 'servesWine', 'servesCocktails', 'servesDessert',
  'servesVegetarianFood', 'outdoorSeating', 'liveMusic', 'goodForGroups', 'menuForChildren', 'allowsDogs',
].map(f => 'places.' + f).join(',');
// bump on every change, so /ping shows which version Cloudflare is running
const VERSION = '2026-11-12.1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEAD = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const API_HEAD = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: HEAD });
const api = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: API_HEAD });
const RELAY = new Set(['/ping', '/place', '/page', '/search']);

/* ---------- sign-in: a 6-digit code by email, then a 30-day session cookie ---------- */
const OWNER = 'ochudson05@gmail.com';
const CODE_MIN = 10, SESSION_DAYS = 30, MAX_TRIES = 5, MAX_SENDS_PER_HOUR = 5;
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET || 'menu-hauler'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
let TABLES = false;
async function tables(env) {
  if (TABLES) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, tries INTEGER, sends INTEGER, window_start INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL)'),
    // people and what they may do (managed on /admin); tools is a JSON list of tool keys, NULL = every tool
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', tools TEXT, can_edit INTEGER NOT NULL DEFAULT 1, firecrawl INTEGER NOT NULL DEFAULT 1, note TEXT, added_by TEXT, added_at INTEGER, last_seen INTEGER, last_tool TEXT)"),
    // sign-ins, tools opened and admin changes, kept ACTIVITY_DAYS
    env.DB.prepare('CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, email TEXT NOT NULL, what TEXT NOT NULL, detail TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS activity_at ON activity (at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)'),
  ]);
  // columns added after the table was first made (fails harmlessly once the column exists)
  await env.DB.prepare('ALTER TABLE users ADD COLUMN name TEXT').run().catch(() => {});
  // Claude: off for everyone until the owner ticks them; claude_cap is their own monthly limit in US$ (NULL = the default)
  await env.DB.prepare('ALTER TABLE users ADD COLUMN claude INTEGER NOT NULL DEFAULT 0').run().catch(() => {});
  await env.DB.prepare('ALTER TABLE users ADD COLUMN claude_cap REAL').run().catch(() => {});
  // one row per Claude call; cost is in millionths of a US$, written as the worst case before the call and corrected after
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS claude_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, email TEXT NOT NULL, tool TEXT, model TEXT, in_tokens INTEGER, out_tokens INTEGER, cost INTEGER NOT NULL, state TEXT NOT NULL, note TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS claude_calls_at ON claude_calls (at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS claude_calls_email ON claude_calls (email, at)'),
    // Claude's answers by a hash of exactly what was asked, so reading the same file again costs nothing (kept CLAUDE_CACHE_DAYS)
    env.DB.prepare('CREATE TABLE IF NOT EXISTS claude_cache (key TEXT PRIMARY KEY, at INTEGER NOT NULL, model TEXT, text TEXT NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS claude_cache_at ON claude_cache (at)'),
  ]);
  TABLES = true;
}
const list = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

/* ---------- people and permissions ---------- */
// role: owner (the built-in OWNER, can't be changed) > admin (uses /admin) > member. status: active | blocked.
const TOOLS = ['converter', 'photos', 'venue', 'setup', 'word'];
const ACTIVITY_DAYS = 180;
// email domains that may sign in without being added one by one: set on /admin, else ALLOWED_DOMAINS, else oolio.com
async function domainsOf(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'domains'").first();
  return list(r ? r.value : (env.ALLOWED_DOMAINS || 'oolio.com'));
}
const userOf = (email, r) => {
  const owner = email === OWNER;
  let tools = null; try { tools = r && r.tools ? JSON.parse(r.tools).filter(t => TOOLS.includes(t)) : null; } catch (e) { }
  return {
    email, name: (r && r.name) || nameOf(email), role: owner ? 'owner' : (r && r.role === 'admin' ? 'admin' : 'member'), status: owner ? 'active' : (r && r.status === 'blocked' ? 'blocked' : 'active'),
    tools: owner ? null : tools, canEdit: owner || !r || r.can_edit !== 0, firecrawl: owner || !r || r.firecrawl !== 0,
    // Claude is opt-in per person (the owner is always ticked, but still bound by the limits)
    claude: owner || !!(r && r.claude === 1), claudeCap: r && r.claude_cap != null ? +r.claude_cap : null,
  };
};
// may this email sign in? Added people (not blocked), the owner, ALLOWED_EMAILS, or an allowed domain
async function access(env, email) {
  if (email === OWNER) return { ok: true };
  const r = await env.DB.prepare('SELECT status FROM users WHERE email = ?1').bind(email).first();
  if (r) return r.status === 'blocked' ? { ok: false, blocked: true } : { ok: true };
  if (list(env.ALLOWED_EMAILS).includes(email) || (await domainsOf(env)).some(d => email.endsWith('@' + d))) return { ok: true };
  return { ok: false };
}
const log = (env, email, what, detail) => env.DB.prepare('INSERT INTO activity (at, email, what, detail) VALUES (?1, ?2, ?3, ?4)').bind(Date.now(), email, what, detail == null ? null : String(detail).slice(0, 500));
const cookieOf = (req, name) => { const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : ''; };
async function sessionUser(req, env) {
  const t = cookieOf(req, 'mh_session');
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  await tables(env);
  const r = await env.DB.prepare('SELECT s.email, s.expires, u.email AS known, u.name, u.role, u.status, u.tools, u.can_edit, u.firecrawl, u.claude, u.claude_cap, u.last_seen FROM sessions s LEFT JOIN users u ON u.email = s.email WHERE s.token_hash = ?1')
    .bind(await hmac(env, 's:' + t)).first();
  if (!r || r.expires < Date.now()) return null;
  const user = userOf(r.email, r.known ? r : null);
  if (user.status === 'blocked') return null;
  // people signed in before the users table existed get a row now; "last seen" is saved at most every 5 minutes
  const now = Date.now();
  if (!r.known) await env.DB.prepare("INSERT OR IGNORE INTO users (email, role, added_by, added_at, last_seen) VALUES (?1, ?2, 'signed in', ?3, ?3)").bind(r.email, user.role, now).run();
  else if (!r.last_seen || now - r.last_seen > 300e3) await env.DB.prepare('UPDATE users SET last_seen = ?2 WHERE email = ?1').bind(r.email, now).run();
  return user;
}
// a page may only send people back to a path on this site
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : '/');
async function authStart(req, env) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return api({ error: 'Enter a valid email address.' }, 400);
  await tables(env);
  const ok = await access(env, email);
  if (!ok.ok) return api({ error: ok.blocked ? 'This email’s access to Menu Hauler has been turned off. Ask the owner if you need it back.' : 'That email can’t sign in to Menu Hauler. Use your work email, or ask the owner to add it.' }, 403);
  if (!env.RESEND_KEY) return api({ error: 'Sign-in emails aren’t set up yet (RESEND_KEY is missing).' }, 503);
  const now = Date.now(), row = await env.DB.prepare('SELECT sends, window_start FROM login_codes WHERE email = ?1').bind(email).first();
  const fresh = !row || now - row.window_start > 3600e3, sends = fresh ? 0 : row.sends;
  if (sends >= MAX_SENDS_PER_HOUR) return api({ error: 'Too many codes asked for. Try again in an hour.' }, 429);
  const n = new Uint32Array(1); crypto.getRandomValues(n);
  const code = String(n[0] % 1000000).padStart(6, '0');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Menu Hauler <login@menuhauler.com>', to: [email],
      subject: 'Your Menu Hauler sign-in code: ' + code,
      text: 'Your Menu Hauler sign-in code is ' + code + '.\n\nIt works for ' + CODE_MIN + ' minutes. If you didn’t ask for it, ignore this email.\n\nMenu Hauler · https://menuhauler.com',
      html: '<p>Your Menu Hauler sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">' + code + '</p><p>It works for ' + CODE_MIN + ' minutes. If you didn’t ask for it, ignore this email.</p><p style="color:#777">Menu Hauler · <a href="https://menuhauler.com">menuhauler.com</a></p>',
    }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return api({ error: 'The code couldn’t be emailed (' + (j.message || 'error ' + r.status) + ').' }, 502); }
  await env.DB.prepare('INSERT INTO login_codes (email, code_hash, expires, tries, sends, window_start) VALUES (?1, ?2, ?3, 0, ?4, ?5) ON CONFLICT(email) DO UPDATE SET code_hash = ?2, expires = ?3, tries = 0, sends = ?4, window_start = ?5')
    .bind(email, await hmac(env, 'c:' + email + ':' + code), now + CODE_MIN * 60e3, sends + 1, fresh ? now : row.window_start).run();
  return api({ ok: true });
}
async function authVerify(req, env, u) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase(), code = String(b.code || '').replace(/\D/g, '');
  await tables(env);
  const row = await env.DB.prepare('SELECT code_hash, expires, tries FROM login_codes WHERE email = ?1').bind(email).first();
  if (!row || !row.code_hash || row.expires < Date.now()) return api({ error: 'That code has expired. Ask for a new one.' }, 400);
  if (row.tries >= MAX_TRIES) return api({ error: 'Too many wrong codes. Ask for a new one.' }, 429);
  if (code.length !== 6 || (await hmac(env, 'c:' + email + ':' + code)) !== row.code_hash) {
    await env.DB.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?1').bind(email).run();
    return api({ error: 'That code isn’t right. Check the email and try again.' }, 400);
  }
  // access may have been turned off since the code was sent
  if (!(await access(env, email)).ok) return api({ error: 'This email’s access to Menu Hauler has been turned off. Ask the owner if you need it back.' }, 403);
  const t = hex(crypto.getRandomValues(new Uint8Array(32))), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE login_codes SET code_hash = NULL WHERE email = ?1').bind(email),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?1').bind(now),
    env.DB.prepare('DELETE FROM activity WHERE at < ?1').bind(now - ACTIVITY_DAYS * 864e5),
    env.DB.prepare('INSERT INTO sessions (token_hash, email, expires, created) VALUES (?1, ?2, ?3, ?4)').bind(await hmac(env, 's:' + t), email, now + SESSION_DAYS * 864e5, now),
    env.DB.prepare("INSERT INTO users (email, role, added_by, added_at, last_seen) VALUES (?1, ?2, 'signed in', ?3, ?3) ON CONFLICT(email) DO UPDATE SET last_seen = ?3")
      .bind(email, email === OWNER ? 'owner' : 'member', now),
    log(env, email, 'sign-in'),
  ]);
  const h = new Headers(API_HEAD);
  h.append('Set-Cookie', 'mh_session=' + t + '; Path=/; Max-Age=' + SESSION_DAYS * 86400 + '; HttpOnly; Secure; SameSite=Lax');
  return new Response(JSON.stringify({ ok: true, next: safeNext(b.next) }), { headers: h });
}
async function authLogout(req, env, u) {
  const t = cookieOf(req, 'mh_session');
  if (/^[a-f0-9]{64}$/.test(t)) { await tables(env); await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await hmac(env, 's:' + t)).run(); }
  return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': 'mh_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax', 'Cache-Control': 'no-store' } });
}
// pages anyone can open: the sign-in itself, the policies and security.txt
const PUBLIC = path => path === '/login' || path === '/login.html' || path === '/intake' || path === '/intake.html' || path.startsWith('/intake/') || path.startsWith('/legal') || path.startsWith('/.well-known/') || path === '/favicon.ico' || path === '/robots.txt';
const nameOf = email => email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/* ---------- shared records (D1) ---------- */
// collection paths alternate collection/document: "orgs", "orgs/<id>/menus"
const COLL = /^[A-Za-z0-9_\-.~:@+]{1,200}(\/[A-Za-z0-9_\-.~:@+]{1,200}\/[A-Za-z0-9_\-.~:@+]{1,200})*$/;
const ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) { const o = Object.assign({}, a); for (const [k, v] of Object.entries(b || {})) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v; return o; }
async function db(path, req, env, user, q) {
  const DB = env.DB;
  if (path === 'list') {
    const coll = q.get('coll') || '', since = +q.get('since') || 0, order = q.get('order') || '', dir = q.get('dir') === 'desc' ? 'DESC' : 'ASC', limit = Math.min(1000, +q.get('limit') || 1000);
    if (!COLL.test(coll)) return api({ error: 'Bad collection.' }, 400);
    const field = /^[A-Za-z0-9_]{1,40}$/.test(order) ? order : '';
    const sql = 'SELECT id, data, updated_at FROM docs WHERE coll = ?1' + (since ? ' AND updated_at > ?2' : '') +
      (field ? " ORDER BY json_extract(data, '$." + field + "') " + dir : ' ORDER BY id') + ' LIMIT ' + limit;
    const rows = (await (since ? DB.prepare(sql).bind(coll, since) : DB.prepare(sql).bind(coll)).all()).results || [];
    // the ids that exist now, so a page that polls with "since" can tell what was deleted
    const ids = since ? ((await DB.prepare('SELECT id FROM docs WHERE coll = ?1').bind(coll).all()).results || []).map(r => r.id) : null;
    const now = ((await DB.prepare('SELECT MAX(updated_at) AS m FROM docs WHERE coll = ?1').bind(coll).first()) || {}).m || since;
    return api({ docs: rows.map(r => ({ id: r.id, data: JSON.parse(r.data), at: r.updated_at })), ids, now });
  }
  if (path === 'get') {
    const coll = q.get('coll') || '', id = q.get('id') || '';
    if (!COLL.test(coll) || !ID.test(id)) return api({ error: 'Bad path.' }, 400);
    const r = await DB.prepare('SELECT data FROM docs WHERE coll = ?1 AND id = ?2').bind(coll, id).first();
    return api({ data: r ? JSON.parse(r.data) : null });
  }
  if (req.method !== 'POST') return api({ error: 'Use POST.' }, 405);
  if (!user.canEdit) return api({ error: 'Your access is view-only, so you can’t change venues. Ask an admin if you need to.', code: 'not_granted_edit' }, 403);
  const b = await req.json().catch(() => null);
  if (!b || !COLL.test(b.coll || '') || !ID.test(b.id || '')) return api({ error: 'Bad path.' }, 400);
  if (path === 'delete') { await DB.prepare('DELETE FROM docs WHERE coll = ?1 AND id = ?2').bind(b.coll, b.id).run(); return api({ ok: true }); }
  if (!isObj(b.data)) return api({ error: 'The record must be an object.' }, 400);
  let data = b.data;
  if (path === 'update') {
    const r = await DB.prepare('SELECT data FROM docs WHERE coll = ?1 AND id = ?2').bind(b.coll, b.id).first();
    if (!r) return api({ error: 'That record doesn’t exist.', code: 'invalid_argument' }, 400);
    data = merge(JSON.parse(r.data), b.data);
  } else if (path !== 'set') return api({ error: 'Unknown action.' }, 404);
  const json = JSON.stringify(data);
  if (json.length > 900000) return api({ error: 'The record is too big.', code: 'invalid_argument' }, 400);
  await DB.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(coll, id) DO UPDATE SET data = ?3, updated_at = ?4, updated_by = ?5')
    .bind(b.coll, b.id, json, Date.now(), user.email).run();
  return api({ ok: true });
}

/* ---------- your own account (the settings panel, for everyone) ---------- */
async function account(path, req, env, user) {
  const DB = env.DB, now = Date.now();
  if (path === '' && req.method === 'GET') {
    const r = (await DB.prepare('SELECT added_at, added_by, last_seen FROM users WHERE email = ?1').bind(user.email).first()) || {};
    const live = ((await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE email = ?1 AND expires > ?2').bind(user.email, now).first()) || {}).n || 0;
    const ins = (await DB.prepare("SELECT at FROM activity WHERE email = ?1 AND what = 'sign-in' ORDER BY at DESC LIMIT 2").bind(user.email).all()).results || [];
    const count = ((await DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE email = ?1 AND what = 'sign-in'").bind(user.email).first()) || {}).n || 0;
    return api(Object.assign({}, user, { admin: isAdmin(user), version: VERSION, addedAt: r.added_at || null, addedBy: r.added_by || '', lastSeen: r.last_seen || null,
      devices: live, signIns: count, lastSignIn: ins[0] ? ins[0].at : null, previousSignIn: ins[1] ? ins[1].at : null, sessionDays: SESSION_DAYS }));
  }
  if (req.method !== 'POST') return api({ error: 'Use POST.' }, 405);
  if (path === '') {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    await DB.prepare("INSERT INTO users (email, role, name, added_by, added_at) VALUES (?1, ?2, ?3, 'signed in', ?4) ON CONFLICT(email) DO UPDATE SET name = ?3")
      .bind(user.email, user.role, name || null, now).run();
    return api({ ok: true, name: name || nameOf(user.email) });
  }
  if (path === '/signout-all') {
    await DB.batch([DB.prepare('DELETE FROM sessions WHERE email = ?1').bind(user.email), log(env, user.email, 'sign-out', 'every device')]);
    return api({ ok: true });
  }
  return api({ error: 'Unknown address.' }, 404);
}

/* ---------- the admin page's API (/admin): owner and admins only ---------- */
const isAdmin = user => user.role === 'owner' || user.role === 'admin';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function admin(path, req, env, user, q) {
  const DB = env.DB, now = Date.now();
  if (path === 'overview') {
    const rows = (await DB.prepare(
      "SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.email = u.email AND s.expires > ?1) AS live, " +
      "(SELECT COUNT(*) FROM activity a WHERE a.email = u.email AND a.what = 'sign-in') AS sign_ins FROM users u ORDER BY COALESCE(u.last_seen, 0) DESC").bind(now).all()).results || [];
    if (!rows.some(r => r.email === OWNER)) rows.unshift({ email: OWNER, live: 0, sign_ins: 0 });
    const users = rows.map(r => Object.assign(userOf(r.email, r.role ? r : null), {
      note: r.note || '', addedBy: r.added_by || '', addedAt: r.added_at || null, lastSeen: r.last_seen || null, lastTool: r.last_tool || '', live: r.live || 0, signIns: r.sign_ins || 0,
    }));
    const set = await DB.prepare("SELECT value FROM settings WHERE key = 'domains'").first();
    const month = new Date().toISOString().slice(0, 7);
    const fc = ((await DB.prepare("SELECT amount FROM usage WHERE month = ?1 AND kind = 'firecrawl'").bind(month).first().catch(() => null)) || {}).amount || 0;
    // Claude: settings, whether the key is there, and this month's spend per person
    const cs = await claudeSettings(env), spend = {};
    ((await DB.prepare("SELECT email, COUNT(*) AS calls, COALESCE(SUM(cost), 0) AS cost FROM claude_calls WHERE at >= ?1 GROUP BY email").bind(monthStart()).all()).results || [])
      .forEach(r => { spend[r.email] = { calls: r.calls, usd: r.cost / 1e6 }; });
    const cached = ((await DB.prepare("SELECT COUNT(*) AS n FROM claude_calls WHERE at >= ?1 AND state = 'cached'").bind(monthStart()).first()) || {}).n || 0;
    const claudeInfo = { settings: cs, hard: CLAUDE_HARD, models: Object.entries(CLAUDE_PRICES).map(([id, p]) => ({ id, inUsd: p[0], outUsd: p[1] })), efforts: CLAUDE_EFFORTS,
      keySet: !!env.ANTHROPIC_API_KEY, stopped: env.CLAUDE_OFF === '1', spend, monthUsd: Object.values(spend).reduce((a, x) => a + x.usd, 0),
      localOn: localOn(env), gemini: env.GEMINI_KEY ? geminiModel(env) : null, cachedThisMonth: cached };
    return api({ me: user, owner: OWNER, users, tools: TOOLS, domains: await domainsOf(env), domainsFrom: set ? 'admin' : (env.ALLOWED_DOMAINS ? 'cloudflare' : 'default'),
      extraEmails: list(env.ALLOWED_EMAILS), activityDays: ACTIVITY_DAYS, firecrawl: { used: fc, cap: +env.FIRECRAWL_MONTHLY_CAP || 500 }, claude: claudeInfo });
  }
  if (path === 'claude-calls') {
    const items = (await DB.prepare('SELECT at, email, tool, model, in_tokens, out_tokens, cost, state, note FROM claude_calls ORDER BY at DESC LIMIT 100').all()).results || [];
    return api({ items: items.map(i => Object.assign(i, { usd: i.cost / 1e6 })) });
  }
  if (path === 'activity') {
    const email = (q.get('email') || '').toLowerCase(), limit = Math.min(500, +q.get('limit') || 150);
    const st = email ? DB.prepare('SELECT at, email, what, detail FROM activity WHERE email = ?1 ORDER BY at DESC LIMIT ' + limit).bind(email)
      : DB.prepare('SELECT at, email, what, detail FROM activity ORDER BY at DESC LIMIT ' + limit);
    return api({ items: (await st.all()).results || [] });
  }
  if (req.method !== 'POST') return api({ error: 'Use POST.' }, 405);
  const b = await req.json().catch(() => ({}));
  if (path === 'settings') {
    if (user.role !== 'owner') return api({ error: 'Only the owner can change which email domains may sign in.' }, 403);
    const domains = list(b.domains).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
    await DB.batch([DB.prepare("INSERT INTO settings (key, value) VALUES ('domains', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(domains.join(',')),
      log(env, user.email, 'admin', 'Allowed domains set to: ' + (domains.join(', ') || 'none (only people added by hand)'))]);
    return api({ ok: true, domains });
  }
  // Claude settings and who may use Claude: the owner only
  if (path === 'claude-settings') {
    if (user.role !== 'owner') return api({ error: 'Only the owner can change the Claude settings.' }, 403);
    const cur = await claudeSettings(env), has = k => b[k] !== undefined;
    const next = {
      enabled: has('enabled') ? b.enabled === true : cur.enabled, model: has('model') && CLAUDE_PRICES[b.model] ? b.model : cur.model,
      lightModel: has('lightModel') && (CLAUDE_PRICES[b.lightModel] || b.lightModel === LOCAL_MODEL || b.lightModel === GEMINI) ? b.lightModel : cur.lightModel,
      effort: has('effort') && CLAUDE_EFFORTS.includes(b.effort) ? b.effort : cur.effort,
      siteMonthUsd: has('siteMonthUsd') ? b.siteMonthUsd : cur.siteMonthUsd, userMonthUsd: has('userMonthUsd') ? b.userMonthUsd : cur.userMonthUsd,
      userDayCalls: has('userDayCalls') ? b.userDayCalls : cur.userDayCalls, userMinuteCalls: has('userMinuteCalls') ? b.userMinuteCalls : cur.userMinuteCalls,
    };
    await DB.prepare("INSERT INTO settings (key, value) VALUES ('claude', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(next)).run();
    const s = await claudeSettings(env);   // read back, clamped to the ceilings
    await log(env, user.email, 'admin', 'Claude ' + (s.enabled ? 'on' : 'off') + ': ' + s.model + ' (small jobs: ' + s.lightModel + '), effort ' + s.effort + ', site US$' + s.siteMonthUsd + '/month, US$' + s.userMonthUsd +
      '/person/month, ' + s.userDayCalls + ' calls/person/day, ' + s.userMinuteCalls + '/minute').run();
    return api({ ok: true, settings: s });
  }
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return api({ error: 'Enter a valid email address.' }, 400);
  if (path === 'claude-user') {
    if (user.role !== 'owner') return api({ error: 'Only the owner can choose who uses Claude.' }, 403);
    if (email === OWNER) return api({ error: 'The owner always has Claude; change the limits instead.' }, 400);
    const on = b.claude === true ? 1 : 0, cap = b.cap === null || b.cap === '' || b.cap === undefined ? null : num0(b.cap, null, 0, CLAUDE_HARD.userMonthUsd);
    const r = await DB.prepare('UPDATE users SET claude = ?2, claude_cap = ?3 WHERE email = ?1').bind(email, on, cap).run();
    if (!r.meta || !r.meta.changes) return api({ error: 'Add the person first, then switch Claude on for them.' }, 404);
    await log(env, user.email, 'admin', (on ? 'Claude on for ' : 'Claude off for ') + email + (on ? ' (limit ' + (cap == null ? 'default' : 'US$' + cap) + '/month)' : '')).run();
    return api({ ok: true });
  }
  if (email === OWNER) return api({ error: 'The owner’s access can’t be changed.' }, 403);
  if (email === user.email) return api({ error: 'You can’t change your own access. Ask the owner.' }, 403);
  const cur = await DB.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first();
  // admins manage members; only the owner manages admins or makes someone an admin
  if (user.role !== 'owner' && ((cur && cur.role === 'admin') || b.role === 'admin')) return api({ error: 'Only the owner can add, change or remove admins.' }, 403);
  if (path === 'user') {
    // anything left out keeps its current value
    const has = k => b[k] !== undefined, c = cur || {};
    const role = (has('role') ? b.role : c.role) === 'admin' ? 'admin' : 'member', status = (has('status') ? b.status : c.status) === 'blocked' ? 'blocked' : 'active';
    const tools = has('tools') ? (Array.isArray(b.tools) ? JSON.stringify(TOOLS.filter(t => b.tools.includes(t))) : null) : (c.tools || null);
    const canEdit = has('canEdit') ? (b.canEdit === false ? 0 : 1) : (c.can_edit === 0 ? 0 : 1), fc = has('firecrawl') ? (b.firecrawl === false ? 0 : 1) : (c.firecrawl === 0 ? 0 : 1);
    const note = (has('note') ? String(b.note || '') : (c.note || '')).slice(0, 300);
    const what = !cur ? 'Added ' + email : (status === 'blocked' ? 'Blocked ' : 'Updated ') + email;
    const detail = what + ' (' + [role, status, tools ? 'tools: ' + (JSON.parse(tools).join(', ') || 'none') : 'all tools', canEdit ? 'can edit venues' : 'view only', fc ? 'Firecrawl on' : 'Firecrawl off'].join(', ') + ')';
    const st = [DB.prepare("INSERT INTO users (email, role, status, tools, can_edit, firecrawl, note, added_by, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) " +
      'ON CONFLICT(email) DO UPDATE SET role = ?2, status = ?3, tools = ?4, can_edit = ?5, firecrawl = ?6, note = ?7').bind(email, role, status, tools, canEdit, fc, note, user.email, now),
      log(env, user.email, 'admin', detail)];
    if (status === 'blocked') st.push(DB.prepare('DELETE FROM sessions WHERE email = ?1').bind(email));
    await DB.batch(st);
    return api({ ok: true });
  }
  if (path === 'signout') {
    await DB.batch([DB.prepare('DELETE FROM sessions WHERE email = ?1').bind(email), log(env, user.email, 'admin', 'Signed out ' + email + ' on every device')]);
    return api({ ok: true });
  }
  if (path === 'remove') {
    await DB.batch([DB.prepare('DELETE FROM users WHERE email = ?1').bind(email), DB.prepare('DELETE FROM sessions WHERE email = ?1').bind(email), log(env, user.email, 'admin', 'Removed ' + email)]);
    return api({ ok: true });
  }
  return api({ error: 'Unknown address.' }, 404);
}
// the launcher reports which tool is opened; one entry per person and tool every 30 minutes at most
async function seen(req, env, user) {
  const b = await req.json().catch(() => ({})), tool = TOOLS.includes(b.tool) ? b.tool : '';
  if (!tool) return api({ ok: true });
  const now = Date.now(), last = await env.DB.prepare("SELECT at FROM activity WHERE email = ?1 AND what = 'open' AND detail = ?2 ORDER BY at DESC LIMIT 1").bind(user.email, tool).first();
  const st = [env.DB.prepare('UPDATE users SET last_tool = ?2, last_seen = ?3 WHERE email = ?1').bind(user.email, tool, now)];
  if (!last || now - last.at > 1800e3) st.push(log(env, user.email, 'open', tool));
  await env.DB.batch(st);
  return api({ ok: true });
}

/* ---------- Firecrawl with the team key, capped per month ---------- */
async function firecrawl(req, env) {
  if (!env.FIRECRAWL_KEY) return api({ error: 'Firecrawl isn’t set up on the website yet.', code: 'server_not_connected' }, 503);
  const b = await req.json().catch(() => ({})), input = b.input || {}, tool = b.tool;
  if (input.alexandria) return api({ error: 'This Firecrawl data source isn’t available on the website.', code: 'tool_error' }, 400);
  const month = new Date().toISOString().slice(0, 7), cap = +env.FIRECRAWL_MONTHLY_CAP || 500;
  const used = ((await env.DB.prepare("SELECT amount FROM usage WHERE month = ?1 AND kind = 'firecrawl'").bind(month).first()) || {}).amount || 0;
  if (used >= cap) return api({ error: 'The website’s Firecrawl allowance for this month (' + cap + ' credits) is used up.', code: 'rate_limited' }, 429);
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  let url, body;
  if (tool === 'firecrawl_scrape') { url = 'https://api.firecrawl.dev/v2/scrape'; body = pick(input, ['url', 'formats', 'onlyMainContent', 'waitFor', 'maxAge', 'parsers', 'location', 'mobile']); }
  else if (tool === 'firecrawl_search') { url = 'https://api.firecrawl.dev/v2/search'; body = pick(input, ['query', 'limit', 'sources', 'location', 'tbs', 'categories']); }
  else return api({ error: 'Unknown Firecrawl tool.' }, 400);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + env.FIRECRAWL_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  const cost = +(j.creditsUsed || (j.data && j.data.metadata && j.data.metadata.creditsUsed) || (tool === 'firecrawl_search' ? 2 : 1));
  if (r.ok) await env.DB.prepare("INSERT INTO usage (month, kind, amount) VALUES (?1, 'firecrawl', ?2) ON CONFLICT(month, kind) DO UPDATE SET amount = amount + ?2").bind(month, cost).run();
  if (!r.ok) return api({ error: 'Firecrawl: ' + (j.error || ('error ' + r.status)), code: r.status === 429 ? 'rate_limited' : 'tool_error' }, 502);
  return api({ payload: j, used: used + cost, cap });
}

/* ---------- Claude with the team's Anthropic key: off until the owner turns it on ----------
   The page sends a prompt and up to a few pictures; everything else (model, effort, output length) is decided here.
   Before each call the worst-case cost is written down, so the limits hold even when several calls run at once.
   Two models, both chosen on /admin: "model" reads menus, pictures and documents; "lightModel" does the small jobs a
   page marks task: "light" (review summaries, staff lists, the converter's check). lightModel can be "local", the small
   model on the Menu Hauler server, which costs nothing and hands over to Haiku when it can't answer, or "gemini"
   (GEMINI_KEY), Google's model, which is priced and limited exactly like Claude and also hands over to Haiku if it fails.
   Answers are saved by a hash of exactly what was asked (claude_cache), so the same file read twice is paid for once.
   A page may send fixed reference text as "context": it goes first, marked for Anthropic's prompt cache. */
const CLAUDE_PRICES = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] }; // US$ per million tokens: in, out
const CLAUDE_PRICE_MAX = [10, 50];            // for any model not listed (a fallback model), assume the dearest
const LOCAL_MODEL = 'local', LOCAL_FALLBACK = 'claude-haiku-5-5';
// Gemini (paid tier, so Google doesn't train on what's sent): US$ per million tokens, in and out (thinking counts as out)
const GEMINI = 'gemini', GEMINI_DEFAULT = 'gemini-2.5-flash-lite';
const GEMINI_PRICES = { 'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-3.1-flash-lite': [0.25, 1.50], 'gemini-3.5-flash-lite': [0.30, 2.50] };
const geminiModel = env => String(env.GEMINI_MODEL || GEMINI_DEFAULT).trim();
const localOn = env => serverOn(env) && env.LOCAL_MODEL_ON === '1';
const CLAUDE_CACHE_DAYS = 30;
const CLAUDE_DEFAULTS = { enabled: false, model: 'claude-opus-5-5', lightModel: 'claude-haiku-5-5', effort: 'medium', siteMonthUsd: 10, userMonthUsd: 2, userDayCalls: 25, userMinuteCalls: 4 };
// ceilings the admin page can't go past
const CLAUDE_HARD = { maxTokens: 16000, maxPromptChars: 200000, maxImages: 4, maxImageBytes: 5e6, siteMonthUsd: 200, userMonthUsd: 50, userDayCalls: 200, userMinuteCalls: 10 };
const CLAUDE_EFFORTS = ['low', 'medium', 'high'];
const CLAUDE_IMG = /^image\/(jpeg|png|webp|gif)$/;
const num0 = (v, d, lo, hi) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
async function claudeSettings(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'claude'").first();
  let s = {}; try { s = r ? JSON.parse(r.value) || {} : {}; } catch (e) { }
  const d = CLAUDE_DEFAULTS, h = CLAUDE_HARD;
  return {
    enabled: s.enabled === true, model: CLAUDE_PRICES[s.model] ? s.model : d.model, effort: CLAUDE_EFFORTS.includes(s.effort) ? s.effort : d.effort,
    lightModel: CLAUDE_PRICES[s.lightModel] || (s.lightModel === LOCAL_MODEL && localOn(env)) || (s.lightModel === GEMINI && env.GEMINI_KEY) ? s.lightModel : d.lightModel,
    siteMonthUsd: num0(s.siteMonthUsd, d.siteMonthUsd, 0, h.siteMonthUsd), userMonthUsd: num0(s.userMonthUsd, d.userMonthUsd, 0, h.userMonthUsd),
    userDayCalls: Math.round(num0(s.userDayCalls, d.userDayCalls, 0, h.userDayCalls)), userMinuteCalls: Math.round(num0(s.userMinuteCalls, d.userMinuteCalls, 1, h.userMinuteCalls)),
  };
}
// can this person use Claude right now? (limits are checked per call)
function claudeState(env, s, user) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, why: 'Claude isn’t set up on the website (no API key).' };
  if (env.CLAUDE_OFF === '1') return { ok: false, why: 'Claude has been switched off for the website in Cloudflare.' };
  if (!s.enabled) return { ok: false, why: 'Claude is turned off for the website. The owner can turn it on at /admin.' };
  if (!user.claude) return { ok: false, why: 'Claude isn’t switched on for your account. Ask the owner if you need it.' };
  return { ok: true };
}
const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const priceOf = m => CLAUDE_PRICES[m] || GEMINI_PRICES[m] || CLAUDE_PRICE_MAX;
// US$ in millionths for some tokens; Haiku 5.5 costs more past 100K input tokens.
// Prompt-cache writes cost 1.25× the input price and cache reads 0.1×.
function costOf(model, inTok, outTok, cacheWrite = 0, cacheRead = 0) {
  if (model === LOCAL_MODEL) return 0;
  let [pi, po] = priceOf(model);
  if (model === 'claude-haiku-5-5' && inTok + cacheWrite + cacheRead > 100000) { pi = 0.5; po = 2.5; }
  return Math.ceil(inTok * pi + cacheWrite * pi * 1.25 + cacheRead * pi * 0.1 + outTok * po);
}
// one hash for everything that decides the answer; each piece is hashed on its own so big pictures aren't copied together
async function askKey(parts) {
  const hs = [];
  for (const p of parts) hs.push(hex(await crypto.subtle.digest('SHA-256', enc.encode(p))));
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(hs.join('|'))));
}
// the small model on the Menu Hauler server (Ollama behind the gateway); text only. Returns the answer's text, or null.
async function askLocal(env, context, prompt) {
  try {
    const r = await fetch(env.SERVER_URL.replace(/\/+$/, '') + '/ai/api/chat', {
      method: 'POST', signal: AbortSignal.timeout(120e3), headers: { 'Content-Type': 'application/json', 'X-MH-Key': env.SERVER_KEY },
      body: JSON.stringify({ model: env.LOCAL_MODEL || 'qwen3:4b', stream: false, think: false, format: 'json', options: { temperature: 0, num_ctx: 16384 },
        messages: [...(context ? [{ role: 'system', content: context }] : []), { role: 'user', content: prompt }] }),
    });
    if (!r.ok) return null;
    const j = await r.json(), t = j && j.message && j.message.content;
    return typeof t === 'string' && t.trim() ? t : null;
  } catch (e) { return null; }
}
// Gemini (Google's Generative Language API) for small jobs; pictures allowed. Small jobs ask for JSON, as with the local model.
// Returns { text, inT, outT, cached, cut } on an answer, { refused } when Google blocks it, or { error } when it fails.
async function askGemini(env, model, context, prompt, imgs) {
  const parts = imgs.map(i => ({ inline_data: { mime_type: i.type, data: i.data } }));
  parts.push({ text: prompt });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, maxOutputTokens: CLAUDE_HARD.maxTokens, responseMimeType: 'application/json' } };
  if (context) body.systemInstruction = { parts: [{ text: context }] };
  let r, j;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', signal: AbortSignal.timeout(120e3), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body: JSON.stringify(body) });
    j = await r.json().catch(() => ({}));
  } catch (e) { return { error: 'network: ' + (e && e.message) }; }
  if (!r.ok) return { error: r.status + ' ' + ((j.error && j.error.message) || '').slice(0, 150) };
  const u = j.usageMetadata || {}, cached = u.cachedContentTokenCount || 0;
  const inT = Math.max(0, (u.promptTokenCount || 0) - cached), outT = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  const c = (j.candidates || [])[0], why = (j.promptFeedback && j.promptFeedback.blockReason) || (c && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(c.finishReason || '') && c.finishReason);
  if (why) return { refused: 'Gemini: ' + why, inT, outT, cached };
  const text = c && c.content ? (c.content.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('') : '';
  if (!text.trim()) return { error: 'empty answer (' + ((c && c.finishReason) || 'no candidates') + ')' };
  return { text, inT, outT, cached, cut: c.finishReason === 'MAX_TOKENS' };
}
const usd = micro => Math.round(micro / 1e4) / 100;
async function claude(req, env, user) {
  const s = await claudeSettings(env), st = claudeState(env, s, user);
  if (!st.ok) return api({ error: st.why, code: 'sampling_disabled' }, 403);
  if (+(req.headers.get('Content-Length') || 0) > 30e6) return api({ error: 'That’s too much to send to Claude at once.', code: 'image_rejected' }, 413);
  const b = await req.json().catch(() => null);
  if (!b || typeof b.prompt !== 'string' || !b.prompt.trim()) return api({ error: 'Nothing to send to Claude.', code: 'invalid_argument' }, 400);
  const context = typeof b.context === 'string' ? b.context : '';
  if (b.prompt.length + context.length > CLAUDE_HARD.maxPromptChars) return api({ error: 'The text is too long for Claude here (' + CLAUDE_HARD.maxPromptChars + ' characters at most). Split the menu into parts.', code: 'invalid_argument' }, 413);
  const imgs = Array.isArray(b.images) ? b.images : [];
  if (imgs.length > CLAUDE_HARD.maxImages) return api({ error: 'Claude takes at most ' + CLAUDE_HARD.maxImages + ' pictures at a time here.', code: 'image_rejected' }, 413);
  for (const i of imgs) {
    if (!i || !CLAUDE_IMG.test(i.type) || typeof i.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(i.data)) return api({ error: 'Claude takes JPG, PNG, WebP or GIF pictures.', code: 'image_rejected' }, 400);
    if (i.data.length * 0.75 > CLAUDE_HARD.maxImageBytes) return api({ error: 'A picture is too big for Claude (5 MB at most).', code: 'image_rejected' }, 413);
  }
  const tool = TOOLS.includes(b.tool) ? b.tool : '', now = Date.now(), DB = env.DB;
  // small jobs go to the light model, at low effort; the local model can't see pictures
  const light = b.task === 'light';
  let model = light ? s.lightModel : s.model;
  const effort = light ? 'low' : s.effort;
  if (model === LOCAL_MODEL && (imgs.length || !localOn(env))) model = LOCAL_FALLBACK;
  if (model === GEMINI) model = env.GEMINI_KEY ? geminiModel(env) : LOCAL_FALLBACK;
  const gemini = model.startsWith('gemini');

  // the same question asked before (by anyone, within CLAUDE_CACHE_DAYS) is answered from the saved reading, free
  const key = await askKey([light ? 'light:' + model : model, effort, context, b.prompt, ...imgs.map(i => i.type + ':' + i.data)]);
  if (b.fresh !== true) {
    const hit = await DB.prepare('SELECT text, model FROM claude_cache WHERE key = ?1 AND at > ?2').bind(key, now - CLAUDE_CACHE_DAYS * 864e5).first();
    if (hit) {
      await DB.prepare("INSERT INTO claude_calls (at, email, tool, model, in_tokens, out_tokens, cost, state, note) VALUES (?1, ?2, ?3, ?4, 0, 0, 0, 'cached', 'answered from a saved reading')")
        .bind(now, user.email, tool, hit.model).run();
      return api({ text: hit.text, model: hit.model, truncated: false, costUsd: 0, cached: true });
    }
  }
  const remember = (text, m) => text.length < 900000
    ? DB.prepare('INSERT INTO claude_cache (key, at, model, text) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET at = ?2, model = ?3, text = ?4').bind(key, Date.now(), m, text).run()
    : null;

  // the local model first, when it's chosen for small jobs; if it can't answer, Haiku does (and is charged as usual)
  if (model === LOCAL_MODEL) {
    const text = await askLocal(env, context, b.prompt);
    if (text) {
      await DB.prepare("INSERT INTO claude_calls (at, email, tool, model, in_tokens, out_tokens, cost, state, note) VALUES (?1, ?2, ?3, ?4, 0, 0, 0, 'ok', 'Menu Hauler server')")
        .bind(now, user.email, tool, LOCAL_MODEL).run();
      await remember(text, LOCAL_MODEL);
      return api({ text, model: LOCAL_MODEL, truncated: false, costUsd: 0 });
    }
    model = LOCAL_FALLBACK;
  }

  // the worst this call could cost: about 1 token per 3 characters, ~1,600 per picture, and the longest allowed answer
  // (for Gemini, the dearer of it and Haiku, which answers instead if Gemini fails)
  const tokIn = Math.ceil((b.prompt.length + context.length * 1.25) / 3) + imgs.length * 1600;
  const worst = Math.max(costOf(model, tokIn, CLAUDE_HARD.maxTokens), gemini ? costOf(LOCAL_FALLBACK, tokIn, CLAUDE_HARD.maxTokens) : 0);
  // free answers (saved readings, the local model) don't count towards the per-minute and per-day limits
  const [minute, day, mine, site] = await DB.batch([
    DB.prepare("SELECT COUNT(*) AS n FROM claude_calls WHERE email = ?1 AND at > ?2 AND state != 'cached' AND model != 'local'").bind(user.email, now - 60e3),
    DB.prepare("SELECT COUNT(*) AS n FROM claude_calls WHERE email = ?1 AND at > ?2 AND state != 'cached' AND model != 'local'").bind(user.email, now - 864e5),
    DB.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM claude_calls WHERE email = ?1 AND at >= ?2').bind(user.email, monthStart()),
    DB.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM claude_calls WHERE at >= ?1').bind(monthStart()),
  ]);
  const n = x => (x.results && x.results[0]) || {}, myCap = (user.claudeCap != null ? user.claudeCap : s.userMonthUsd) * 1e6;
  if (n(minute).n >= s.userMinuteCalls) return api({ error: 'Too many Claude requests in a minute. Wait a moment and try again.', code: 'rate_limited' }, 429);
  if (n(day).n >= s.userDayCalls) return api({ error: 'You’ve reached today’s Claude limit (' + s.userDayCalls + ' requests in 24 hours).', code: 'rate_limited' }, 429);
  if (n(mine).c + worst > myCap) return api({ error: 'You’ve reached your Claude spending limit for this month (US$' + usd(myCap).toFixed(2) + ').', code: 'rate_limited' }, 429);
  if (n(site).c + worst > s.siteMonthUsd * 1e6) return api({ error: 'The website’s Claude budget for this month is used up.', code: 'rate_limited' }, 429);
  // hold the worst-case cost while the call runs; the insert re-checks both budgets itself, so two calls at once can't both slip under
  const held = await DB.prepare("INSERT INTO claude_calls (at, email, tool, model, cost, state) SELECT ?1, ?2, ?3, ?4, ?5, 'running' " +
    'WHERE (SELECT COALESCE(SUM(cost), 0) FROM claude_calls WHERE email = ?2 AND at >= ?6) + ?5 <= ?7 AND (SELECT COALESCE(SUM(cost), 0) FROM claude_calls WHERE at >= ?6) + ?5 <= ?8 RETURNING id')
    .bind(now, user.email, tool, model, worst, monthStart(), myCap, s.siteMonthUsd * 1e6).first();
  if (!held) return api({ error: 'The Claude budget for this month is used up.', code: 'rate_limited' }, 429);
  const settle = (cost, state, m, inT, outT, note) => DB.prepare('UPDATE claude_calls SET cost = ?2, state = ?3, model = ?4, in_tokens = ?5, out_tokens = ?6, note = ?7 WHERE id = ?1')
    .bind(held.id, cost, state, m, inT || 0, outT || 0, note ? String(note).slice(0, 300) : null).run();
  // Gemini for small jobs, when the owner picked it; if it fails, Haiku answers under the same hold
  let gemNote = '';
  if (gemini) {
    const g = await askGemini(env, model, context, b.prompt, imgs);
    if (g.text != null || g.refused) {
      const cost = costOf(model, g.inT, g.outT, 0, g.cached);
      if (g.refused) { await settle(cost, 'refused', model, g.inT + g.cached, g.outT, g.refused); return api({ error: 'Gemini declined to read this.', code: 'refused' }, 422); }
      await settle(cost, 'ok', model, g.inT + g.cached, g.outT, g.cut ? 'answer cut off at the length limit' : g.cached ? g.cached + ' tokens from Gemini’s cache' : null);
      if (!g.cut && g.text) await remember(g.text, model);
      return api({ text: g.text, model, truncated: g.cut, costUsd: cost / 1e6 });
    }
    gemNote = 'Gemini failed (' + g.error + '), Haiku answered. ';
    model = LOCAL_FALLBACK;
  }
  const content = imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.type, data: i.data } }));
  content.push({ type: 'text', text: b.prompt });
  const body = { model, max_tokens: CLAUDE_HARD.maxTokens, output_config: { effort }, messages: [{ role: 'user', content }] };
  // fixed reference text goes first and is marked for the prompt cache (too-short text simply isn't cached)
  if (context) body.system = [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }];
  const headers = { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21' };
  // if Claude declines a request on safety grounds, the API retries it on a suitable model (Opus and Sonnet only)
  if (model !== 'claude-haiku-5-5') { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  let r, j;
  try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); }
  catch (e) { await settle(0, 'failed', model, 0, 0, gemNote + 'network: ' + (e && e.message)); return api({ error: 'Claude couldn’t be reached. Try again in a minute.', code: 'unavailable' }, 502); }
  if (!r.ok) {
    const m = (j.error && j.error.message) || ('error ' + r.status);
    await settle(0, 'failed', model, 0, 0, gemNote + r.status + ' ' + m);
    if (r.status === 429 || r.status === 529) return api({ error: 'Claude is busy right now. Try again in a minute.', code: 'rate_limited' }, 429);
    if (r.status === 400 && /image/i.test(m)) return api({ error: 'Claude couldn’t use that picture. Try a JPG or PNG.', code: 'image_rejected' }, 400);
    if (r.status === 401 || r.status === 403) return api({ error: 'The website’s Claude key was refused. Tell the owner.', code: 'unavailable' }, 502);
    return api({ error: 'Claude couldn’t answer (' + m + ').', code: 'unavailable' }, 502);
  }
  const u = j.usage || {}, plain = u.input_tokens || 0, cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0, outT = u.output_tokens || 0;
  const inT = plain + cw + cr;
  // price at the dearer of the model asked for and the model that answered (a fallback may have run)
  const used = j.model || model, cost = Math.max(costOf(model, plain, outT, cw, cr), costOf(used, plain, outT, cw, cr));
  if (j.stop_reason === 'refusal') { await settle(cost, 'refused', used, inT, outT, j.stop_details && j.stop_details.category); return api({ error: 'Claude declined to read this.', code: 'refused' }, 422); }
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const cut = j.stop_reason === 'max_tokens';
  await settle(cost, 'ok', used, inT, outT, (gemNote + (cut ? 'answer cut off at the length limit' : cr ? cr + ' tokens from the prompt cache' : '')) || null);
  if (!cut && text) await remember(text, used);
  // keep the call log as long as the activity log, and saved readings CLAUDE_CACHE_DAYS
  if (Math.random() < 0.05) await DB.batch([DB.prepare('DELETE FROM claude_calls WHERE at < ?1').bind(now - ACTIVITY_DAYS * 864e5),
    DB.prepare('DELETE FROM claude_cache WHERE at < ?1').bind(now - CLAUDE_CACHE_DAYS * 864e5)]);
  return api({ text, model: used, truncated: cut, costUsd: cost / 1e6 });
}

/* ---------- customer intake: a link the team sends a venue, so the owner can give us what setup needs ----------
   Staff (signed in, able to edit) make one link per venue: /intake/<token>. Anyone with the link can fill in the form
   and upload files until it expires (INTAKE_DAYS) or is turned off. Files are kept in D1 in pieces, because the free
   plan has no file storage set up. Tables: intake (one row per link), intake_files, intake_chunks. */
const INTAKE_DAYS = 30, FILE_MAX = 15e6, TOKEN_MAX_BYTES = 60e6, TOKEN_MAX_FILES = 40, CHUNK = 900000;
const INTAKE_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|gif|heic|heif)|text\/(csv|plain)|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|application\/vnd\.ms-excel)$/;
const FILE_KINDS = ['menu', 'logo', 'layout', 'staff', 'other'];
let ITABLES = false;
async function intakeTables(env) {
  if (ITABLES) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS intake (token TEXT PRIMARY KEY, venue TEXT NOT NULL, venue_name TEXT, created_by TEXT, created_at INTEGER, expires INTEGER, revoked INTEGER NOT NULL DEFAULT 0, submitted_at INTEGER, submits INTEGER NOT NULL DEFAULT 0, data TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS intake_venue ON intake (venue)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS intake_files (id TEXT PRIMARY KEY, token TEXT NOT NULL, name TEXT, type TEXT, size INTEGER, kind TEXT, at INTEGER, chunks INTEGER)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS intake_files_token ON intake_files (token)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS intake_chunks (file_id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB, PRIMARY KEY (file_id, n))'),
  ]);
  ITABLES = true;
}
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = /^[A-Za-z0-9_-]{24}$/;
const filesOf = async (env, token) => ((await env.DB.prepare('SELECT id, name, type, size, kind, at FROM intake_files WHERE token = ?1 ORDER BY at').bind(token).all()).results || []);
async function dropFile(env, id) { await env.DB.batch([env.DB.prepare('DELETE FROM intake_chunks WHERE file_id = ?1').bind(id), env.DB.prepare('DELETE FROM intake_files WHERE id = ?1').bind(id)]); }
const linkOf = (u, token) => new URL('/intake/' + token, u).href;
const liveLink = r => r && !r.revoked && r.expires > Date.now();

// the team's side (signed in)
async function intakeStaff(path, req, env, user, q, u) {
  await intakeTables(env);
  const DB = env.DB, now = Date.now();
  if (path === 'status') {
    const venue = q.get('venue') || '';
    const r = await DB.prepare('SELECT * FROM intake WHERE venue = ?1 ORDER BY created_at DESC LIMIT 1').bind(venue).first();
    if (!r) return api({ link: null });
    let data = null; try { data = r.data ? JSON.parse(r.data) : null; } catch (e) { }
    return api({ link: { token: r.token, url: linkOf(u, r.token), createdAt: r.created_at, createdBy: r.created_by, expires: r.expires, live: liveLink(r), revoked: !!r.revoked,
      submittedAt: r.submitted_at, submits: r.submits, data, files: await filesOf(env, r.token) } });
  }
  if (path === 'file') {
    const id = q.get('id') || '';
    const f = await DB.prepare('SELECT * FROM intake_files WHERE id = ?1').bind(id).first();
    if (!f) return api({ error: 'That file is no longer there.' }, 404);
    const parts = (await DB.prepare('SELECT data FROM intake_chunks WHERE file_id = ?1 ORDER BY n').bind(id).all()).results || [];
    const bufs = parts.map(p => p.data instanceof ArrayBuffer ? new Uint8Array(p.data) : new Uint8Array(p.data || []));
    const out = new Uint8Array(bufs.reduce((s, b) => s + b.length, 0)); let o = 0; bufs.forEach(b => { out.set(b, o); o += b.length; });
    return new Response(out, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + String(f.name || 'file').replace(/["\\\r\n]/g, '') + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (req.method !== 'POST') return api({ error: 'Use POST.' }, 405);
  if (!user.canEdit) return api({ error: 'Your access is view-only, so you can’t make intake links.' }, 403);
  const b = await req.json().catch(() => ({}));
  if (path === 'create') {
    const venue = String(b.venue || '').slice(0, 200), name = String(b.venueName || '').slice(0, 200);
    if (!venue) return api({ error: 'No venue.' }, 400);
    const token = b64url(crypto.getRandomValues(new Uint8Array(18)));
    await DB.batch([DB.prepare('UPDATE intake SET revoked = 1 WHERE venue = ?1 AND revoked = 0').bind(venue),
      DB.prepare('INSERT INTO intake (token, venue, venue_name, created_by, created_at, expires) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(token, venue, name, user.email, now, now + INTAKE_DAYS * 864e5),
      log(env, user.email, 'admin', 'Made a customer intake link for ' + (name || venue))]);
    return api({ ok: true, url: linkOf(u, token), token, expires: now + INTAKE_DAYS * 864e5 });
  }
  if (path === 'revoke') {
    await DB.prepare('UPDATE intake SET revoked = 1 WHERE token = ?1').bind(String(b.token || '')).run();
    return api({ ok: true });
  }
  if (path === 'extend') {
    await DB.prepare('UPDATE intake SET expires = ?2, revoked = 0 WHERE token = ?1').bind(String(b.token || ''), now + INTAKE_DAYS * 864e5).run();
    return api({ ok: true });
  }
  // one link ({token}), or every link and file for a venue ({venue}) when the venue is deleted
  if (path === 'delete') {
    const tokens = b.venue ? ((await DB.prepare('SELECT token FROM intake WHERE venue = ?1').bind(String(b.venue)).all()).results || []).map(r => r.token) : [String(b.token || '')];
    for (const token of tokens) {
      for (const f of await filesOf(env, token)) await dropFile(env, f.id);
      await DB.prepare('DELETE FROM intake WHERE token = ?1').bind(token).run();
    }
    return api({ ok: true, deleted: tokens.length });
  }
  return api({ error: 'Unknown address.' }, 404);
}

// the customer's side (no sign-in; the link is the key)
async function intakePublic(rest, req, env) {
  await intakeTables(env);
  const DB = env.DB, now = Date.now(), [token, action] = rest.split('/');
  if (!TOKEN.test(token || '')) return api({ error: 'This link isn’t right. Check you copied all of it.' }, 404);
  const r = await DB.prepare('SELECT * FROM intake WHERE token = ?1').bind(token).first();
  if (!r) return api({ error: 'This link isn’t right. Check you copied all of it.' }, 404);
  if (!liveLink(r)) return api({ error: 'This link has ' + (r.revoked ? 'been turned off' : 'expired') + '. Ask your Oolio contact for a new one.', code: 'expired' }, 410);
  // only this site's own page may send answers or files
  const origin = req.headers.get('Origin');
  if (req.method === 'POST' && origin && new URL(origin).host !== new URL(req.url).host) return api({ error: 'Not allowed from another site.' }, 403);
  if (!action && req.method === 'GET') {
    let data = null; try { data = r.data ? JSON.parse(r.data) : null; } catch (e) { }
    return api({ venue: r.venue_name || '', expires: r.expires, submittedAt: r.submitted_at, data, files: await filesOf(env, token), limits: { file: FILE_MAX, total: TOKEN_MAX_BYTES, files: TOKEN_MAX_FILES } });
  }
  if (req.method !== 'POST') return api({ error: 'Use POST.' }, 405);
  if (!action) {
    const text = await req.text();
    if (text.length > 100000) return api({ error: 'That’s too much text. Shorten the longest answers.' }, 413);
    let data; try { data = JSON.parse(text).data; } catch (e) { return api({ error: 'The answers couldn’t be read. Try again.' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return api({ error: 'The answers couldn’t be read. Try again.' }, 400);
    if (r.submits >= 50) return api({ error: 'This form has been sent too many times. Ask your Oolio contact for a new link.' }, 429);
    await DB.prepare('UPDATE intake SET data = ?2, submitted_at = ?3, submits = submits + 1 WHERE token = ?1').bind(token, JSON.stringify(data), now).run();
    return api({ ok: true, submittedAt: now });
  }
  if (action === 'file') {
    const q = new URL(req.url).searchParams, name = String(q.get('name') || 'file').replace(/[\\/\r\n"]/g, '').slice(0, 150) || 'file';
    const kind = FILE_KINDS.includes(q.get('kind')) ? q.get('kind') : 'other', type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!INTAKE_TYPES.test(type)) return api({ error: 'That kind of file can’t be uploaded. Use PDF, a photo, a spreadsheet, a Word document or a text file.' }, 415);
    const len = +(req.headers.get('Content-Length') || 0);
    if (len > FILE_MAX) return api({ error: 'That file is bigger than ' + Math.round(FILE_MAX / 1e6) + ' MB.' }, 413);
    const have = await filesOf(env, token), used = have.reduce((s, f) => s + (f.size || 0), 0);
    if (have.length >= TOKEN_MAX_FILES) return api({ error: 'That’s the most files this form takes. Remove one to add another.' }, 413);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return api({ error: 'That file is empty.' }, 400);
    if (buf.length > FILE_MAX) return api({ error: 'That file is bigger than ' + Math.round(FILE_MAX / 1e6) + ' MB.' }, 413);
    if (used + buf.length > TOKEN_MAX_BYTES) return api({ error: 'The files on this form add up to more than ' + Math.round(TOKEN_MAX_BYTES / 1e6) + ' MB. Remove one to add this.' }, 413);
    // one piece per statement (each under D1's 2 MB row limit); the file row goes in last, so a failed upload leaves no file
    const id = b64url(crypto.getRandomValues(new Uint8Array(12))), n = Math.ceil(buf.length / CHUNK);
    try {
      for (let i = 0; i < n; i++) await DB.prepare('INSERT INTO intake_chunks (file_id, n, data) VALUES (?1, ?2, ?3)').bind(id, i, buf.slice(i * CHUNK, (i + 1) * CHUNK).buffer).run();
      await DB.prepare('INSERT INTO intake_files (id, token, name, type, size, kind, at, chunks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').bind(id, token, name, type, buf.length, kind, now, n).run();
    } catch (e) { await DB.prepare('DELETE FROM intake_chunks WHERE file_id = ?1').bind(id).run().catch(() => {}); throw e; }
    return api({ ok: true, file: { id, name, type, size: buf.length, kind, at: now } });
  }
  if (action === 'remove') {
    const b = await req.json().catch(() => ({}));
    const f = await DB.prepare('SELECT id FROM intake_files WHERE id = ?1 AND token = ?2').bind(String(b.id || ''), token).first();
    if (f) await dropFile(env, f.id);
    return api({ ok: true });
  }
  return api({ error: 'Unknown address.' }, 404);
}

/* ---------- download a page, PDF, feed or picture for the page ---------- */
async function fetchFor(q, env) {
  let target = q.get('url') || '';
  if (!/^https?:\/\/[^/]+\.[^/]+/i.test(target)) return api({ error: 'Not a web address.' }, 400);
  // ABN Lookup: the team's GUID is added here, so nobody needs their own
  if (/^https:\/\/abr\.business\.gov\.au\//i.test(target) && env.ABR_GUID) { const t = new URL(target); if (!t.searchParams.get('guid') || t.searchParams.get('guid') === 'server') t.searchParams.set('guid', env.ABR_GUID); target = t.href; }
  const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-AU,en;q=0.9' } });
  const len = +(r.headers.get('content-length') || 0);
  if (len > 20e6) return api({ error: 'That file is too big.' }, 413);
  // the proxied body is never trusted: force download, never let the browser render or sniff it as HTML on our origin
  const h = new Headers({ 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff', 'X-Final-Url': r.url, 'X-Status': String(r.status), 'Cache-Control': 'no-store' });
  return new Response(r.body, { status: r.ok ? 200 : 502, headers: h });
}

/* ---------- the Menu Hauler server (server/README.md), reached through its Cloudflare Tunnel ----------
   Its gateway only answers requests carrying SERVER_KEY, so the pages go through here and never see the key.
     /api/server/scrape  {url}            the menu scraper (menu-scraper/), without its own Claude: the page sends what it
                                          finds to /api/claude, so the website's limits, cache and log still apply
     /api/server/ocr     picture bytes    text and positions from RapidOCR, for the converter's second opinion */
function serverOn(env) { return !!(env.SERVER_URL && env.SERVER_KEY); }
const OCR_MAX = 12e6;
async function server(path, req, env) {
  if (!serverOn(env)) return api({ error: 'The Menu Hauler server isn’t set up on the website.', code: 'server_not_connected' }, 503);
  if (req.method !== 'POST') return api({ error: 'Use POST.' }, 405);
  const base = env.SERVER_URL.replace(/\/+$/, ''), key = { 'X-MH-Key': env.SERVER_KEY };
  let r;
  try {
    if (path === 'scrape') {
      const b = await req.json().catch(() => ({})), url = String(b.url || '');
      if (!/^https?:\/\/[^/]+\.[^/]+/i.test(url)) return api({ error: 'Not a web address.' }, 400);
      r = await fetch(base + '/v1/menu', { method: 'POST', signal: AbortSignal.timeout(150e3), headers: Object.assign({ 'Content-Type': 'application/json' }, key),
        body: JSON.stringify({ url, use_ai: false, include_markdown: true, max_pages: 4 }) });
    } else if (path === 'ocr') {
      const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!CLAUDE_IMG.test(type)) return api({ error: 'OCR takes JPG, PNG, WebP or GIF pictures.' }, 415);
      if (+(req.headers.get('Content-Length') || 0) > OCR_MAX) return api({ error: 'That picture is too big for OCR.' }, 413);
      r = await fetch(base + '/v1/ocr', { method: 'POST', signal: AbortSignal.timeout(120e3), headers: Object.assign({ 'Content-Type': type }, key), body: req.body });
    } else return api({ error: 'Unknown address.' }, 404);
  } catch (e) { return api({ error: 'The Menu Hauler server didn’t answer in time.', code: 'unavailable' }, 504); }
  const j = await r.json().catch(() => ({}));
  if (r.ok) {
    const month = new Date().toISOString().slice(0, 7);
    await env.DB.prepare('INSERT INTO usage (month, kind, amount) VALUES (?1, ?2, 1) ON CONFLICT(month, kind) DO UPDATE SET amount = amount + 1').bind(month, 'server-' + path).run().catch(() => {});
  }
  return api(r.ok ? j : { error: (j && (j.message || (typeof j.detail === 'string' && j.detail))) || 'The Menu Hauler server answered ' + r.status + '.', code: r.status === 401 ? 'unavailable' : 'tool_error' }, r.ok ? 200 : 502);
}

// baseline security headers added to every response (set here, not in Cloudflare, so they ship with the code)
const SEC = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // deliberately no script-src/default-src: the tool pages rely on inline scripts (and a cdnjs srcdoc frame).
  // frame-ancestors stops cross-origin clickjacking; base-uri/object-src block two injection vectors.
  'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
};
function harden(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC)) if (!h.has(k)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
export default {
  async fetch(req, env) {
    return harden(await handle(req, env));
  },
};
async function handle(req, env) {
    const u = new URL(req.url), p = u.searchParams;
    // www.menuhauler.com -> menuhauler.com
    if (u.hostname.startsWith('www.')) { u.hostname = u.hostname.slice(4); return Response.redirect(u.href, 301); }
    try {
      /* ----- sign-in ----- */
      if (u.pathname === '/auth/start' && req.method === 'POST') return authStart(req, env);
      if (u.pathname === '/auth/verify' && req.method === 'POST') return authVerify(req, env, u);
      if (u.pathname === '/auth/logout') return authLogout(req, env, u);
      if (u.pathname === '/login' && (await sessionUser(req, env))) return Response.redirect(new URL(safeNext(p.get('next')), u).href, 302);

      /* ----- the customer intake form's API: the link is the key, no sign-in ----- */
      if (u.pathname.startsWith('/api/public/intake/')) return intakePublic(u.pathname.slice('/api/public/intake/'.length), req, env);
      // the form itself: /intake/<token> is served the page public/intake.html
      if (u.pathname.startsWith('/intake/') && env.ASSETS) return env.ASSETS.fetch(new Request(new URL('/intake', u), req));

      /* ----- the website's API: signed-in people only ----- */
      if (u.pathname.startsWith('/api/')) {
        const user = await sessionUser(req, env);
        if (!user) return api({ error: 'You’re signed out. Reload the page to sign in again.', code: 'not_granted' }, 401);
        // only this site's own pages may change records
        const origin = req.headers.get('Origin');
        if (req.method === 'POST' && origin && new URL(origin).host !== u.host) return api({ error: 'Not allowed from another site.' }, 403);
        const route = u.pathname.slice(5);
        if (route === 'me') {
          const cs = claudeState(env, await claudeSettings(env), user);
          return api({ email: user.email, name: user.name, version: VERSION, role: user.role, tools: user.tools, canEdit: user.canEdit, firecrawl: user.firecrawl, admin: isAdmin(user),
            claude: cs.ok, claudeLimits: cs.ok ? { maxImages: CLAUDE_HARD.maxImages, maxPromptChars: CLAUDE_HARD.maxPromptChars } : null,
            scraper: serverOn(env), ocr: serverOn(env) });
        }
        if (route.startsWith('server/')) return server(route.slice(7), req, env);
        if (route === 'claude') return req.method === 'POST' ? claude(req, env, user) : api({ error: 'Use POST.' }, 405);
        if (route === 'seen' && req.method === 'POST') return seen(req, env, user);
        if (route === 'account' || route.startsWith('account/')) return account(route.slice(8), req, env, user);
        if (route.startsWith('admin/')) return isAdmin(user) ? admin(route.slice(6), req, env, user, p) : api({ error: 'Only admins can do that.' }, 403);
        if (route.startsWith('db/')) return db(route.slice(3), req, env, user, p);
        if (route === 'fc') {
          if (!user.firecrawl) return api({ error: 'Firecrawl is turned off for your account, so web pages are read without it. Ask an admin if you need it.', code: 'rate_limited' }, 403);
          return firecrawl(req, env);
        }
        if (route === 'fetch') return fetchFor(p, env);
        if (route.startsWith('intake/')) return intakeStaff(route.slice(7), req, env, user, p, u);
        return api({ error: 'Unknown address.' }, 404);
      }

      /* ----- the original relay: the token, or a signed-in person ----- */
      if (RELAY.has(u.pathname)) {
        if (!(env.RELAY_TOKEN && p.get('t') === env.RELAY_TOKEN) && !(await sessionUser(req, env))) return out({ error: 'Wrong or missing relay token.' }, 403);
        if (u.pathname === '/ping') return out({ ok: true, google: !!env.GOOGLE_KEY, version: VERSION });

        if (u.pathname === '/place') {
          const q = (p.get('q') || '').slice(0, 200);
          if (!q) return out({ error: 'No search text.' }, 400);
          if (!env.GOOGLE_KEY) return out({ error: 'GOOGLE_KEY is not set on the relay.' }, 500);
          const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_KEY, 'X-Goog-FieldMask': FIELDS },
            body: JSON.stringify({ textQuery: q, regionCode: 'AU', languageCode: 'en', pageSize: 5 }),
          });
          const j = await r.json();
          return out(r.ok ? { places: j.places || [] } : { error: (j.error && j.error.message) || 'Google error ' + r.status }, r.ok ? 200 : 502);
        }

        if (u.pathname === '/page') {
          const target = p.get('url') || '';
          if (!/^https?:\/\/[^/]+\.[^/]+/i.test(target)) return out({ error: 'Not a web address.' }, 400);
          const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-AU,en;q=0.9' } });
          const type = r.headers.get('content-type') || '';
          if (!/html|text\/plain/i.test(type)) return out({ url: r.url, status: r.status, type, html: '' });
          let html = await r.text();
          html = html.replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<svg[\s\S]*?<\/svg>/gi, '')
            .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, a, body) => /\bsrc=|ld\+json/i.test(a) ? m : '<script' + a + '></script>')
            .replace(/\s{2,}/g, ' ');
          return out({ url: r.url, status: r.status, type, html: html.slice(0, 300000) });
        }

        if (u.pathname === '/search') {
          const q = (p.get('q') || '').slice(0, 300);
          if (!q) return out({ error: 'No search text.' }, 400);
          const r = await fetch('https://html.duckduckgo.com/html/?kl=au-en&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, 'Accept-Language': 'en-AU,en;q=0.9' } });
          const h = await r.text(), results = [], re = /<a([^>]*\bresult__a\b[^>]*)>([\s\S]*?)<\/a>/g;
          let m;
          while ((m = re.exec(h)) && results.length < 15) {
            const href = (m[1].match(/href="([^"]+)"/) || [])[1] || '';
            const ud = href.match(/[?&]uddg=([^&]+)/);
            const url = ud ? decodeURIComponent(ud[1]) : href.replace(/&amp;/g, '&');
            if (/^https?:/.test(url)) results.push({ url, title: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").trim() });
          }
          return out({ results, blocked: !results.length && /anomaly|captcha/i.test(h) });
        }
      }
    } catch (e) {
      return (u.pathname.startsWith('/api/') ? api : out)({ error: String((e && e.message) || e) }, 500);
    }
    /* ----- everything else: the website's files, behind the sign-in except the public pages ----- */
    const viewer = PUBLIC(u.pathname) ? null : await sessionUser(req, env).catch(() => null);
    if (!PUBLIC(u.pathname) && !viewer) {
      if ((req.headers.get('Accept') || '').includes('text/html')) return Response.redirect(new URL('/login?next=' + encodeURIComponent(u.pathname + u.search), u).href, 302);
      return new Response('Sign in first.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    // the admin page (public/admin.html) is for the owner and admins only
    if (/^\/admin(\.html)?\/?$/.test(u.pathname)) {
      if (!isAdmin(viewer)) return new Response('<!DOCTYPE html><meta charset="utf-8"><title>Not allowed · Menu Hauler</title><p style="font:16px system-ui;padding:24px">Only admins can open this page. <a href="/">Back to Menu Hauler</a></p>', { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      // passed through as asked: the asset server serves admin.html at /admin and redirects /admin.html to /admin
      // (asking it for /admin.html when /admin was opened made a redirect loop)
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return out({ error: 'Unknown address.' }, 404);
}
