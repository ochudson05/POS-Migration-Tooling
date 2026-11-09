/* Oolio Menu Tools relay: a Cloudflare Worker (free plan) that Restaurant Lookup calls instead of Firecrawl.
   claude.ai pages can't call Google directly, but the Claude desktop app's browser (and a copy of the page
   saved on your computer) can open this relay, which holds the Google key so the page never sees it.

   Deploying: this file is the Worker "menurunner". Cloudflare deploys it automatically when it's pushed to the
   main branch on GitHub (Workers Builds, settings in wrangler.toml), so don't edit it in the dashboard.
   Secrets live only in Cloudflare (menurunner → Settings → Variables and Secrets, type Secret):
     GOOGLE_KEY   your Google Maps Platform key (restricted to "Places API (New)")
     RELAY_TOKEN  any long random password; paste the same one into Restaurant Lookup's settings

   Endpoints (all need ?t=RELAY_TOKEN):
     /ping                 -> {ok:true, google:true|false}
     /place?q=NAME PLACE   -> Google Places Text Search (New): up to 5 places with hours, services and 5 reviews
     /page?url=https://... -> the venue's web page (HTML, with styles and inline scripts removed)
     /search?q=...         -> DuckDuckGo web results [{url,title}]
*/
const FIELDS = [
  'id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'location',
  'rating', 'userRatingCount', 'priceLevel', 'businessStatus', 'primaryTypeDisplayName', 'editorialSummary',
  'regularOpeningHours.weekdayDescriptions', 'reviews',
  'dineIn', 'takeout', 'delivery', 'curbsidePickup', 'reservable', 'servesBreakfast', 'servesBrunch', 'servesLunch',
  'servesDinner', 'servesCoffee', 'servesBeer', 'servesWine', 'servesCocktails', 'servesDessert',
  'servesVegetarianFood', 'outdoorSeating', 'liveMusic', 'goodForGroups', 'menuForChildren', 'allowsDogs',
].map(f => 'places.' + f).join(',');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEAD = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: HEAD });

export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.searchParams;
    if (!env.RELAY_TOKEN || p.get('t') !== env.RELAY_TOKEN) return out({ error: 'Wrong or missing relay token.' }, 403);
    try {
      if (u.pathname === '/ping') return out({ ok: true, google: !!env.GOOGLE_KEY });

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
    } catch (e) {
      return out({ error: String((e && e.message) || e) }, 500);
    }
    return out({ error: 'Unknown address.' }, 404);
  },
};
