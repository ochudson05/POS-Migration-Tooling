/* Oolio Menu Tools website and relay: the Cloudflare Worker "menurunner" (free plan).

   It serves the tools as a website (the files in public/, built by build_apps.py) and the API they use there:
     /api/me                  who is signed in (from Cloudflare Access)
     /api/db/list|get|set|update|delete   the shared venue records (D1 database "oolio-tools", table docs)
     /api/fc                  Firecrawl scrape / search with the team's key, capped per month
     /api/fetch?url=...       downloads a web page, PDF, menu feed or picture for the page (free; the browser can't)
   and the original relay endpoints, which the claude.ai version still uses:
     /ping  /place?q=  /page?url=  /search?q=

   Who can use it: the site sits behind Cloudflare Access (a one-time code sent to an allowed work email).
   Every /api call checks the Access sign-in token, so the API stays closed even if Access is switched off.
   The relay endpoints also accept the old ?t=RELAY_TOKEN.

   Deploying: Cloudflare deploys this automatically when it's pushed to the main branch on GitHub (Workers Builds,
   settings in wrangler.toml), so don't edit it in the dashboard.
   Set in Cloudflare (menurunner → Settings → Variables and Secrets):
     GOOGLE_KEY      secret  Google Maps Platform key (Places API (New))
     RELAY_TOKEN     secret  password for the old relay endpoints
     FIRECRAWL_KEY   secret  Firecrawl API key (fc-...)
     ABR_GUID        secret  ABN Lookup GUID, shared by the team
     ACCESS_TEAM / ACCESS_AUD  optional: built in below (dawn-star-10db and the menurunner Access app)
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
const VERSION = '2026-11-11.1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEAD = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const API_HEAD = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: HEAD });
const api = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: API_HEAD });
const RELAY = new Set(['/ping', '/place', '/page', '/search']);

/* ---------- Cloudflare Access sign-in ----------
   Which sign-in to trust: the Zero Trust team and the Access app's Audience tag. Neither is secret (both appear in every
   sign-in link), so they're built in here; ACCESS_TEAM / ACCESS_AUD set in the dashboard override them. */
const TEAM = env => env.ACCESS_TEAM || 'dawn-star-10db';
const AUD = env => env.ACCESS_AUD || '64a99e246fcfc30de5b899a9ec7d84010dec1a06ef42257f1580a00716aa0e8e';
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
let CERTS = null, CERTS_AT = 0;
async function accessUser(req, env) {
  const cookie = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = req.headers.get('Cf-Access-Jwt-Assertion') || (cookie && cookie[1]);
  if (!token) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  let head, body;
  try { head = JSON.parse(new TextDecoder().decode(b64u(h))); body = JSON.parse(new TextDecoder().decode(b64u(p))); } catch (e) { return null; }
  const iss = 'https://' + TEAM(env) + '.cloudflareaccess.com';
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (body.iss !== iss || !aud.includes(AUD(env)) || !(body.exp > Date.now() / 1000)) return null;
  if (!CERTS || Date.now() - CERTS_AT > 3600e3) { CERTS = (await (await fetch(iss + '/cdn-cgi/access/certs')).json()).keys || []; CERTS_AT = Date.now(); }
  const jwk = CERTS.find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p));
  return ok && body.email ? { email: String(body.email).toLowerCase() } : null;
}
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
    try {
      /* ----- the website's API: signed-in people only ----- */
      if (u.pathname.startsWith('/api/')) {
        const user = await accessUser(req, env);
        if (!user) return api({ error: 'Please sign in again (reload the page).', code: 'not_granted' }, 401);
        const route = u.pathname.slice(5);
        if (route === 'me') return api({ email: user.email, name: nameOf(user.email), version: VERSION });
        if (route.startsWith('db/')) return db(route.slice(3), req, env, user, p);
        if (route === 'fc') return firecrawl(req, env);
        if (route === 'fetch') return fetchFor(p, env);
        return api({ error: 'Unknown address.' }, 404);
      }

      /* ----- the original relay: the token, or a signed-in person ----- */
      if (RELAY.has(u.pathname)) {
        if (!(env.RELAY_TOKEN && p.get('t') === env.RELAY_TOKEN) && !(await accessUser(req, env))) return out({ error: 'Wrong or missing relay token.' }, 403);
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
    /* ----- everything else: the website's files ----- */
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return out({ error: 'Unknown address.' }, 404);
  },
};
