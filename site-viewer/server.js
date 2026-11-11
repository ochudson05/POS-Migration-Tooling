// Local, read-only viewer for the Menu Hauler website's data.
// Runs fixed SELECT queries against the live D1 database "oolio-tools" through Wrangler (signed in with
// `npm run login`), and serves index.html on http://127.0.0.1:8790. Nothing is written to the database or to disk.
// Left out on purpose: settings (keys), session token hashes, login codes and intake link tokens.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = +process.env.PORT || 8790;
const DB = 'oolio-tools';
const WRANGLER = path.join(__dirname, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

// one statement per section, run together in one call; the order matches SECTIONS
const SECTIONS = ['users', 'signedIn', 'groups', 'venues', 'menus', 'activity', 'claude', 'intake', 'usage'];
const SQL = [
  `SELECT email, name, role, status, tools, can_edit, firecrawl, claude, claude_cap, note, added_by, added_at, last_seen, last_tool FROM users ORDER BY last_seen DESC`,
  `SELECT email, COUNT(*) AS sessions, MAX(created) AS latest FROM sessions WHERE expires > CAST(strftime('%s','now') AS INTEGER) * 1000 GROUP BY email`,
  `SELECT id, data, updated_at, updated_by FROM docs WHERE coll = 'groups'`,
  `SELECT id, data, updated_at, updated_by FROM docs WHERE coll = 'orgs'`,
  `SELECT coll, id, json_extract(data, '$.kind') AS kind, json_extract(data, '$.file') AS file, json_extract(data, '$.by') AS by_whom, json_extract(data, '$.at') AS at, json_array_length(json_extract(data, '$.items')) AS items FROM docs WHERE coll LIKE 'orgs/%/menus'`,
  `SELECT id, at, email, what, detail FROM activity ORDER BY at DESC LIMIT 1000`,
  `SELECT id, at, email, tool, model, in_tokens, out_tokens, cost, state, note FROM claude_calls ORDER BY at DESC LIMIT 1000`,
  `SELECT i.venue, i.venue_name, i.created_by, i.created_at, i.expires, i.revoked, i.submitted_at, i.submits, (SELECT COUNT(*) FROM intake_files f WHERE f.token = i.token) AS files, (SELECT COALESCE(SUM(size), 0) FROM intake_files f WHERE f.token = i.token) AS bytes FROM intake i ORDER BY i.created_at DESC`,
  `SELECT month, kind, amount FROM usage ORDER BY month DESC, kind`,
].join(';\n');

function query() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WRANGLER)) return reject(new Error('Wrangler is not installed. Run "npm install" in the site-viewer folder.'));
    execFile(process.execPath, [WRANGLER, 'd1', 'execute', DB, '--remote', '--json', '--command', SQL],
      { cwd: __dirname, maxBuffer: 64 * 1024 * 1024, timeout: 90000, env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }) },
      (err, stdout, stderr) => {
        const out = String(stdout || '');
        let json = null;
        try { json = JSON.parse(out.slice(out.indexOf('['))); } catch (e) { }
        if (!Array.isArray(json)) {
          const msg = (out + '\n' + (stderr || '') + '\n' + (err ? err.message : '')).trim();
          const auth = /not authenticated|login|auth|10000|token/i.test(msg);
          return reject(Object.assign(new Error(auth ? 'Wrangler is not signed in to Cloudflare. Run "npm run login" in the site-viewer folder, then refresh.' : msg.slice(0, 2000)), { auth }));
        }
        const data = {};
        SECTIONS.forEach((k, i) => { data[k] = (json[i] && json[i].results) || []; });
        resolve(data);
      });
  });
}

let cache = null, pending = null;
async function getData(force) {
  if (!force && cache && Date.now() - cache.fetchedAt < 30000) return cache;
  if (!pending) pending = query().then(d => (cache = Object.assign(d, { fetchedAt: Date.now() }))).finally(() => { pending = null; });
  return pending;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    try {
      const d = await getData(url.searchParams.has('fresh'));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(d));
    } catch (e) {
      res.writeHead(e.auth ? 401 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, '127.0.0.1', () => console.log('Menu Hauler viewer: http://127.0.0.1:' + PORT + '  (Ctrl+C to stop)'));
