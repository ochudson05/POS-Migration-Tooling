# Menu scraper

A small web service that takes a venue's web address and returns its menu as rows:

```
POST /v1/menu  {"url": "https://venue.com.au"}
```
```json
{
  "venue": "The Grounds Cafe",
  "method": "ai",                 // jsonld | embedded-json | network-json | ai | none
  "fetched_with": "http",         // http | browser | firecrawl
  "items": [
    {"category": "Breakfast", "name": "Big Brekkie", "variation": "", "price": 36,
     "description": "eggs, bacon, ...", "dietary": "GF"}
  ],
  "markdown": "...",              // the page text, for callers that parse it themselves
  "pages": [...], "menu_links": [...], "warnings": [...], "attempts": [...]
}
```

Any app can call it. The menu converter (`menu-converter.html`) uses it when you enter the
service address under **1. Source files → Menu scraper service**.

## How it reads a site

1. **Load the page, cheapest way first.**
   - `http`: a normal request with a real Chrome network fingerprint. Most venue sites load here.
   - `browser`: headless Chromium (patchright) for pages that need JavaScript. It waits out
     passive "Checking your browser" pages and records the JSON the page loads.
   - `firecrawl`: Firecrawl's hosted scraper, if `FIRECRAWL_API_KEY` is set.
2. **Find the menu.** From a homepage, it follows links that look like the menu (Menu pages, menu
   PDFs, Mr Yum / me&u / Square / Toast / Uber Eats ordering links, embedded menu iframes).
3. **Machine-readable data first.** schema.org `Menu` data, `__NEXT_DATA__`-style embedded JSON,
   and ordering-platform JSON give exact names and prices without any guessing.
4. **Otherwise Claude reads it**, if `ANTHROPIC_API_KEY` is set. It reads page text, menu PDFs and
   photos of menus. Without a key, `items` is empty and `markdown` holds the page text, which the
   converter parses itself.

**Bot protection.** Sites that show an interactive challenge (Cloudflare Turnstile, CAPTCHAs) are
reported as `"error": "blocked"` (HTTP 422). The service does not try to solve them. Ask the venue
for its menu PDF or a photo, or paste the menu text into the converter.

## Run it on Windows

One-time setup (already done on this PC, in `%USERPROFILE%\.menu-scraper\venv`):

```powershell
python -m venv $env:USERPROFILE\.menu-scraper\venv
& $env:USERPROFILE\.menu-scraper\venv\Scripts\python.exe -m pip install -r requirements.txt
& $env:USERPROFILE\.menu-scraper\venv\Scripts\python.exe -m patchright install chromium
```

Then copy `.env.example` to `.env`, add the keys you have, and start it:

```powershell
.\run.ps1
```

It listens on http://localhost:8787. Check http://localhost:8787/health; it shows which parts are
switched on.

## Run it on a server

```bash
docker build -t menu-scraper .
docker run -p 8787:8787 --env-file .env menu-scraper
```

On a shared server, set `API_KEY` (callers send it as `X-API-Key`) and set `ALLOWED_ORIGINS`
to the sites allowed to call it.

## Settings (`.env`)

| Setting | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Lets Claude read menus with no machine-readable data. Recommended. |
| `CLAUDE_MODEL` | Default `claude-opus-5-5`. `claude-haiku-5-5` is far cheaper for simple menus. |
| `FIRECRAWL_API_KEY` | Last-resort loader for sites the built-in tiers can't open. |
| `PROXY_URL` | Send requests through a proxy. |
| `API_KEY` | Require callers to send this key. |
| `ALLOWED_ORIGINS` | Browser origins allowed to call the API. |
| `ENABLE_BROWSER` | `0` turns off the headless browser. |

## Other endpoints

- `POST /v1/scrape {"url": ...}`: one page as markdown + HTML + menu links (no menu reading).
- `POST /v1/ocr` with a picture as the body (`Content-Type: image/jpeg` etc.): every text line with its box,
  from RapidOCR (PaddleOCR's models, CPU only). The website uses it as a second opinion on Claude's
  reading of menu photos, and as the reader when Claude is off. `ENABLE_OCR=0` turns it off.
- `GET /health`

On the Menu Hauler server (`server/`), this service runs behind a gateway and Cloudflare Tunnel, and the
website calls it through `/api/server/*`. There it runs without `ANTHROPIC_API_KEY`: the website sends
what it finds to Claude itself, so the website's limits, saved readings and log still apply.

Request options for `/v1/menu`: `follow_links` (default true), `use_ai` (null = only when needed,
true = always, false = never), `max_pages` (default 4), `include_markdown` (default true),
`start_tier` (`http` | `browser` | `firecrawl`).

## Tests

```powershell
& $env:USERPROFILE\.menu-scraper\venv\Scripts\python.exe tests\test_content.py
```

## Be a good guest

The service makes one request at a time per site and identifies as a normal browser. Use it for
venues you work with: they're your customers, so when a site blocks automated access, asking for
the menu directly is quicker anyway.
