/* Menu Hauler website and relay: the Cloudflare Worker "menurunner" (free plan), at https://menuhauler.com
   (also menurunner.ochudson05.workers.dev, which the claude.ai copy's relay setting uses).

   It serves the tools as a website (the files in public/, built by build_apps.py) and the API they use there:
     /login, /auth/start, /auth/verify, /auth/logout   sign-in with a 6-digit code emailed to an allowed address
     /api/me                  who is signed in
     /api/db/list|get|set|update|delete   the shared venue records (D1 database "oolio-tools", table docs)
     /api/fc                  Firecrawl scrape / search with the team's key, capped per month
     /api/fetch?url=...       downloads a web page, PDF, menu feed or picture for the page (free; the browser can't)
   and the original relay endpoints, which the claude.ai version still uses:
     /ping  /place?q=  /page?url=  /search?q=

   Who can use it: everything except /login, /auth/*, /legal/* and /.well-known/* needs a signed-in session
   (cookie mh_session, 30 days; D1 table sessions). Codes go only to emails ending in ALLOWED_DOMAINS or listed in
   ALLOWED_EMAILS. The relay endpoints also accept the old ?t=RELAY_TOKEN.
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
const VERSION = '2026-11-11.4';
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
  ]);
  TABLES = true;
}
const list = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
function allowed(env, email) {
  const domains = list(env.ALLOWED_DOMAINS || 'oolio.com'), emails = list(env.ALLOWED_EMAILS).concat(OWNER);
  return emails.includes(email) || domains.some(d => email.endsWith('@' + d));
}
const cookieOf = (req, name) => { const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : ''; };
async function sessionUser(req, env) {
  const t = cookieOf(req, 'mh_session');
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  await tables(env);
  const r = await env.DB.prepare('SELECT email, expires FROM sessions WHERE token_hash = ?1').bind(await hmac(env, 's:' + t)).first();
  return r && r.expires > Date.now() ? { email: r.email } : null;
}
// a page may only send people back to a path on this site
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : '/');
async function authStart(req, env) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return api({ error: 'Enter a valid email address.' }, 400);
  if (!allowed(env, email)) return api({ error: 'That email can’t sign in to Menu Hauler. Use your work email, or ask the owner to add it.' }, 403);
  if (!env.RESEND_KEY) return api({ error: 'Sign-in emails aren’t set up yet (RESEND_KEY is missing).' }, 503);
  await tables(env);
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
  const t = hex(crypto.getRandomValues(new Uint8Array(32))), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE login_codes SET code_hash = NULL WHERE email = ?1').bind(email),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?1').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, email, expires, created) VALUES (?1, ?2, ?3, ?4)').bind(await hmac(env, 's:' + t), email, now + SESSION_DAYS * 864e5, now),
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
const PUBLIC = path => path === '/login' || path === '/login.html' || path.startsWith('/legal') || path.startsWith('/.well-known/') || path === '/favicon.ico' || path === '/robots.txt';
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

/* ---------- download a page, PDF, feed or picture for the page ---------- */
async function fetchFor(q, env) {
  let target = q.get('url') || '';
  if (!/^https?:\/\/[^/]+\.[^/]+/i.test(target)) return api({ error: 'Not a web address.' }, 400);
  // ABN Lookup: the team's GUID is added here, so nobody needs their own
  if (/^https:\/\/abr\.business\.gov\.au\//i.test(target) && env.ABR_GUID) { const t = new URL(target); if (!t.searchParams.get('guid') || t.searchParams.get('guid') === 'server') t.searchParams.set('guid', env.ABR_GUID); target = t.href; }
  const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-AU,en;q=0.9' } });
  const len = +(r.headers.get('content-length') || 0);
  if (len > 20e6) return api({ error: 'That file is too big.' }, 413);
  const h = new Headers({ 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'X-Final-Url': r.url, 'X-Status': String(r.status), 'Cache-Control': 'no-store' });
  return new Response(r.body, { status: r.ok ? 200 : 502, headers: h });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.searchParams;
    // www.menuhauler.com -> menuhauler.com
    if (u.hostname.startsWith('www.')) { u.hostname = u.hostname.slice(4); return Response.redirect(u.href, 301); }
    try {
      /* ----- sign-in ----- */
      if (u.pathname === '/auth/start' && req.method === 'POST') return authStart(req, env);
      if (u.pathname === '/auth/verify' && req.method === 'POST') return authVerify(req, env, u);
      if (u.pathname === '/auth/logout') return authLogout(req, env, u);
      if (u.pathname === '/login' && (await sessionUser(req, env))) return Response.redirect(new URL(safeNext(p.get('next')), u).href, 302);

      /* ----- the website's API: signed-in people only ----- */
      if (u.pathname.startsWith('/api/')) {
        const user = await sessionUser(req, env);
        if (!user) return api({ error: 'You’re signed out. Reload the page to sign in again.', code: 'not_granted' }, 401);
        // only this site's own pages may change records
        const origin = req.headers.get('Origin');
        if (req.method === 'POST' && origin && new URL(origin).host !== u.host) return api({ error: 'Not allowed from another site.' }, 403);
        const route = u.pathname.slice(5);
        if (route === 'me') return api({ email: user.email, name: nameOf(user.email), version: VERSION });
        if (route.startsWith('db/')) return db(route.slice(3), req, env, user, p);
        if (route === 'fc') return firecrawl(req, env);
        if (route === 'fetch') return fetchFor(p, env);
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
    if (!PUBLIC(u.pathname) && !(await sessionUser(req, env).catch(() => null))) {
      if ((req.headers.get('Accept') || '').includes('text/html')) return Response.redirect(new URL('/login?next=' + encodeURIComponent(u.pathname + u.search), u).href, 302);
      return new Response('Sign in first.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return out({ error: 'Unknown address.' }, 404);
  },
};
