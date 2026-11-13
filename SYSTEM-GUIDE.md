# Menu Hauler: how it all fits together

A plain-language map of the whole system: what it does, which tools exist, where each piece runs, and what has
to be set up for everything to work. Written 2026-11-13. If something here disagrees with the code, the code wins.
The Worker's own header comment (top of `relay-worker.js`) and `server/README.md` hold the detailed setup steps.

---

## 1. What it is, in one paragraph

Menu Hauler is a set of web tools for getting a hospitality venue set up on **Oolio One**. It looks up the venue,
reads its menus from any source (website, PDF, photo, ordering app) and turns them into Oolio's import
spreadsheet. It also finds product photos, tracks the setup checklist and turns pictures of documents into Word
files. Everyone on the team works from the same shared venue records. It lives at **https://menuhauler.com**,
behind an email-code sign-in.

---

## 2. The big picture

```
                         ┌──────────────────────────────── Cloudflare (free plan) ───────────────────────────────┐
  Your browser  ───────▶ │  Worker "menurunner"  (relay-worker.js)                                               │
  menuhauler.com         │   • serves the website files (public/)                                                │
                         │   • sign-in, admin, shared records API                                                │
                         │   • calls paid services with the team's keys ──▶ Firecrawl, Google Places, Claude,    │
                         │                                                  Gemini, Resend (email), ABN Lookup   │
                         │  D1 database "oolio-tools"  ◀── all shared data lives here                            │
                         │  Cloudflare Tunnel ─────────┐                                                         │
                         └─────────────────────────────┼─────────────────────────────────────────────────────────┘
                                                       ▼
                         ┌──────────── Google Cloud VM "menu-hauler-main" (e2-small, Sydney) ───────────┐
                         │  server.menuhauler.com  →  gateway (key check)  →  menu scraper + OCR        │
                         │  nightly D1 backup (not set up yet)      optional local AI model (off)       │
                         └──────────────────────────────────────────────────────────────────────────────┘

  GitHub (ochudson05/POS-Migration-Tooling, private) ──push to main──▶ Cloudflare auto-deploys the Worker + site
```

Three things to remember:

1. **Cloudflare is the website.** One Worker serves the pages, handles sign-in and holds every API key.
2. **D1 is the only place data is stored.** The Google server keeps nothing, so it can be thrown away and rebuilt.
3. **The Google server is optional.** It makes menu-reading from websites and photos better. If it's off, the
   site still works and each tool falls back to its built-in readers.

---

## 3. The tools

All six tools live in one page (the "launcher"), with a venue picker at the top and a home hub that walks a venue
through four stages: lookup → menu → photos → checklist.

| Tool | What it does | Source file | Costs money? |
|---|---|---|---|
| **Venues** | Searches the venues the team has already saved (name, organisation, suburb, ABN, legal name, owner, phone, email), with filters for stage, go-live soon, overdue steps and "mine". Opens a venue in any tool. Not found → add it or look it up. | `venue-search.js` | Free (reads the saved records only) |
| **Restaurant Lookup** | Type a venue name and suburb. Gets the Google listing, hours, reviews, website, ABN, POS/ordering tech, delivery-app links, and a Claude summary. | `restaurant-lookup.html` | Google Places (1,000 free/month), Firecrawl only as last resort (~13–23 credits), ABN Lookup free |
| **Menu Converter** ("Menu Reader 2.0") | Reads menus from files (PDF, Word, Excel, photos) or web addresses ("Find all menus": website, Hungry Hungry, me&u/Mr Yum, DoorDash, Uber Eats). Sorts items into categories, food/drink, printers, sizes and modifier groups, then writes the **Oolio One import CSV**. Includes a pre-flight check, "menu changes vs last version", spirit-brand sorting and standard option groups. | `menu-converter.html` + `menu-knowledge.js` (trained rules) | Free reading first; Firecrawl capped per search; Claude if switched on |
| **Photo Finder** | Takes an Oolio product export and finds a photo per product: the venue's own photos first (Hungry Hungry, website, Uber Eats, DoorDash), then free libraries (Pexels, Pixabay, Openverse, Wikimedia). Saves a folder or ZIP with credits. | `photo-finder.html` (runs in a frame) | Free libraries; DoorDash ~5 credits |
| **Setup Tracker** | The Oolio "Config Recap Checklist" per venue: steps, owners, due dates, devices/printers (can read a site diagram), staff list, brand, a Board view, organisations (groups of venues), and a go-live pack (.docx). Has links to help.oolio.com guides. Can create a **customer intake link**. | `setup-tracker.html` | Free |
| **Image to Word** | Turns photos/scans of documents into a formatted, editable Word file. | `image-to-word.html` | Claude if on, otherwise free Tesseract OCR in the browser |

Other pages:

| Page | Address | Who |
|---|---|---|
| Sign-in | `/login` | Anyone with an allowed email gets a 6-digit code |
| Admin | `/admin` | Owner and admins: people, roles, per-tool access, view-only, block, Firecrawl on/off, Claude settings and spend, activity log |
| Customer intake form | `/intake/<token>` | Public. A venue's customer uploads their menus, staff list and other files through it. Links last 30 days. |
| Legal | `/legal/` | Public: privacy, terms, and the other policy pages |

**Shared "glue" files** (in the launcher, not tools themselves): `venue-link.js` (one active venue flows through
every tool), `shell.js` / `shell.css` / `theme-boot.js` / `icons.svg` (light/dark, settings panel, icons),
`hosted.js` (makes the tools work on the website, see §5), `oolio-theme.css`.

---

## 4. Where everything is hosted

| Piece | Where | Address / name | How it gets updated |
|---|---|---|---|
| **Website + API** | Cloudflare Worker `menurunner` | https://menuhauler.com (also `menurunner.ochudson05.workers.dev`) | **Automatic**: push to `main` on GitHub → Workers Builds deploys in ~1–2 min |
| **Database** | Cloudflare D1 `oolio-tools` (id `c3c0e022-…`) | bound to the Worker as `DB` | Tables create themselves; no manual migrations |
| **Domain + DNS** | Cloudflare (menuhauler.com zone) | `www` redirects to the bare domain | Set by `wrangler.toml` routes |
| **Server (VM)** | Google Cloud, project with trial credits, `australia-southeast1` | VM `menu-hauler-main`, reached as https://server.menuhauler.com via tunnel `menuhauler-server` | SSH in, `git pull`, `docker compose up -d --build` (see `server/README.md` → "Update it") |
| **VM internet access** | Google Cloud NAT (`menuhauler-router`, `menuhauler-nat`) | outbound only, no open ports | Set once |
| **Code** | GitHub, private | `github.com/ochudson05/POS-Migration-Tooling`, branch `main` | `git push` |
| **Sign-in emails** | Resend | sender `login@menuhauler.com` | Key in Worker secret `RESEND_KEY` |
| **Older copy on claude.ai** | claude.ai artifact "Oolio Menu Tools" | https://claude.ai/artifact/2z2y6N7C1PsCdcaZgn4kHG | Republished by hand (see §7). Uses its own separate database, not D1. |
| **Monthly menu scan** | Claude desktop scheduled task `oolio-monthly-menu-scan` (1st of the month, 9am) | follows `menu-scan-task.md` | Runs only while this PC + Claude app are on |

> **Important:** a push to `main` goes **live straight away**. There is no staging site.

### What's stored in D1

| Table | Holds |
|---|---|
| `docs` | All shared venue records: venues (`orgs`), organisations (`groups`), menu versions (`orgs/<id>/menus`) |
| `users`, `sessions`, `login_codes` | People, roles, permissions, sign-in sessions |
| `activity` | Sign-ins, tools opened, admin changes (kept 180 days) |
| `settings` | Admin settings (allowed domains, Claude on/off, model choices) |
| `usage` | Firecrawl credits used per month |
| `claude_calls`, `claude_cache` | Every Claude/Gemini call with its cost, plus saved answers so repeat reads are free |
| `intake`, `intake_files`, `intake_chunks` | Customer intake links and uploaded files (stored in ~900 KB pieces) |

---

## 5. How the same tools run in three places

The tools were first written for claude.ai, and they still run there. `hosted.js` translates the claude.ai features
into calls to the website's own API, so the tool code is identical everywhere:

| Feature the tools ask for | On **menuhauler.com** | On **claude.ai** | As a **local file** (`apps.html`) |
|---|---|---|---|
| Shared records | `/api/db/*` → D1 | the artifact's own database | browser storage only (just you) |
| Who you are | `/api/me` | claude.ai account | "not signed in" |
| Firecrawl | `/api/fc` (team key, monthly cap) | the viewer's own Firecrawl connector | not available |
| Fetching pages/photos | `/api/fetch` (free) | Claude app's browser, or Firecrawl | direct only (many sites block it) |
| Claude (reading photos, PDFs, summaries) | `/api/claude`: off unless the owner enables it for you | the viewer's own Claude usage | Tesseract/built-in parsers |
| Menu scraper + OCR server | `/api/server/*` → Google VM | not available | not available |

**The website is the main home.** The claude.ai copy still works but keeps its own separate data. Use Setup Tracker →
Download backup / Restore to move records between the two.

---

## 6. Every setting and key, and where it lives

### On the Worker (Cloudflare dashboard → Workers & Pages → menurunner → Settings → Variables and Secrets)

| Name | Needed for | Required? |
|---|---|---|
| `RESEND_KEY` | Sending sign-in codes | **Yes**, or nobody can sign in |
| `AUTH_SECRET` | Securing codes and sessions | **Yes** |
| `GOOGLE_KEY` | Restaurant Lookup (Google Places) | Yes, for lookups |
| `FIRECRAWL_KEY` | Reading hard websites, maps search | Yes, for those features |
| `FIRECRAWL_MONTHLY_CAP` | Credit limit per month (default 500) | Optional |
| `ABR_GUID` | ABN lookups | Yes, for ABNs |
| `RELAY_TOKEN` | Old relay endpoints used by the claude.ai copy | For the claude.ai copy |
| `ANTHROPIC_API_KEY` | Claude on the website | Optional (off without it) |
| `CLAUDE_OFF` | `1` = emergency stop for Claude | Optional |
| `GEMINI_KEY`, `GEMINI_MODEL` | Gemini for small jobs (paid-tier key only) | Optional |
| `SERVER_URL`, `SERVER_KEY` | Connecting to the Google VM | Optional (server features off without them) |
| `LOCAL_MODEL_ON`, `LOCAL_MODEL` | Local AI model on the VM | Optional (off) |
| `ALLOWED_DOMAINS`, `ALLOWED_EMAILS`, `MAIL_FROM` | Who may sign in, sender address | Optional (domains can also be set on /admin; default `oolio.com`) |

Never put keys in `wrangler.toml` or in git. `keep_vars = true` means deploys don't wipe them.

### On the VM (`~/menuhauler/server/.env`, never committed)

`MH_KEY` (must match the Worker's `SERVER_KEY`), `TUNNEL_TOKEN`, `SCRAPER_MEM`, `COMPOSE_PROFILES`, backup settings
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_GCS_BUCKET`). Template: `server/.env.example`.

**Keep a copy of this `.env` somewhere safe.** It's the only thing needed to rebuild the server elsewhere.

### In each person's browser (localStorage)

Theme/settings (`mh.settings`), active venue (`ov-active`), Pexels/Pixabay keys and pauses, added spirit brands, and
Venues tab filters (`vs.view`), the menu being converted (`oolio.convSession`) and Converter settings (`oolio.convSettings`),
caches (lookups 14 days, menu reads 7 days, photo searches 14 days). If you clear site data, these reset. No shared
data is lost.

---

## 7. What's on this PC and what to install

You **don't need anything installed** to use the website. Only a browser.

To **change** the software:

| What | Why | Notes |
|---|---|---|
| **Git** (with Git Credential Manager) | Push changes → deploys the site | Already set up; pushing from the agent shell works |
| **Python 3** | Run `build_apps.py` (rebuilds the pages), `make_icons.py`, `training/*.py` | Microsoft Store Python works |
| **Claude Code / desktop app** | How this was built; runs the monthly scan task | |
| **Node.js** *(only for the data viewer)* | `site-viewer/` | `C:\Program Files\nodejs` |

**Normal change workflow:**

1. Edit the source file (`menu-converter.html`, `setup-tracker.html`, `relay-worker.js`, …).
2. If you changed any page: `python build_apps.py`. This regenerates `apps.html` and everything in `public/`.
   Never edit `public/` or `apps.html` by hand.
3. If you changed `relay-worker.js`: bump `VERSION` near the top.
4. Commit and push to `main`. Live in ~1–2 minutes. Check https://menuhauler.com/ping shows the new `VERSION`.
5. If the change touches the scraper (`menu-scraper/`) or `server/`: SSH into the VM and run the "Update it" command
   from `server/README.md`.
6. *(Optional)* To update the claude.ai copy: `python build_apps.py <scratchpad>\oolio-menu-tools.html` and publish that
   file to the artifact link above.

**Local-only helpers** (nothing to do with the live site):

| Folder | What | How to run |
|---|---|---|
| `site-viewer/` | Read-only view of the live D1 data (users, venues, activity, Claude spend) on http://127.0.0.1:8790 | Double-click `start.cmd` (installs Wrangler, asks you to sign in to Cloudflare once) |
| `menu-scraper/` | The scraper the VM runs. Can also run on this PC on port 8787 | venv in `%USERPROFILE%\.menu-scraper\venv`; your organisation's script block may stop it |
| `training/` | Rebuilds `menu-knowledge.js` from the onboarding team's finished pre-work folder | `harvest.py` → `build_knowledge.py`; venue data files are gitignored |
| `.claude/launch.json` | Local preview servers (`tools-static` on 8768 serves `apps.html`) | Used by Claude Code |
| `.claude/agents/menu-parser.md` | A Claude Code helper that parses a menu with the same rules | Ask Claude Code to "parse this menu" |

---

## 8. Repository map

```
relay-worker.js          the whole backend (Cloudflare Worker): sign-in, API, admin, intake, Claude, server proxy
wrangler.toml            Cloudflare deploy settings (name, domain, D1 binding)
build_apps.py            builds apps.html + public/ from the source pages; business details (BUSINESS) live here
hosted.js                adapter that makes the claude.ai-style tools work on the website

menu-converter.html      Menu Converter            ┐
restaurant-lookup.html   Restaurant Lookup         │ the tool sources: edit these
setup-tracker.html       Setup Tracker             │
photo-finder.html        Photo Finder              │
image-to-word.html       Image to Word             ┘
menu-knowledge.js        trained category/printer rules (generated by training/)
venue-search.js         Venues tab (search the saved venues)
venue-link.js, shell.*, theme-boot.js, icons.svg, oolio-theme.css   shared glue and look
admin.html, intake.html, legal.html                 admin page, customer intake form, policy pages (sources)

public/                  GENERATED website files (don't edit; run build_apps.py)
apps.html                GENERATED launcher for opening locally

server/                  the Google VM kit: docker-compose, Caddy gateway, setup.sh, backup.sh, README
menu-scraper/            Python scraper + OCR service (runs on the VM)
site-viewer/             local read-only database viewer
training/                Menu Reader training scripts
menu-scan-task.md        instructions the monthly scheduled scan follows
COMPLIANCE.md            legal checklist, breach plan, retention, owner to-do list
THIRD_PARTY_NOTICES.md   libraries and licences
```

---

## 9. Who can do what

- **Owner** (built in, `OWNER` in `relay-worker.js`): everything. The only one who can make admins, change allowed
  domains, turn Claude on and tick who may use it.
- **Admin**: opens `/admin` and manages members.
- **Member**: uses the tools. They can be limited to certain tools, view-only, have Firecrawl off, or be blocked.

The Worker enforces blocking, view-only and Firecrawl-off. Per-tool limits only hide the tool in the launcher,
because all tools ship in one page.

---

## 10. Open items and things to watch

| Item | Status (as of 2026-11-13) |
|---|---|
| **Google Cloud trial ends** (90 days or US$500) | Google stops the VM unless you upgrade (~US$15–18/month) or move it (`server/README.md` → "Moving to another provider"). The website keeps working without it. **Activation date not recorded. Check Billing in the Google console.** |
| Nightly D1 backups | **Not set up yet** (`server/README.md` step 6). Cloudflare's Time Travel covers the last 7 days in the meantime. |
| Claude on the website | Off until `ANTHROPIC_API_KEY` is set and the owner enables it on `/admin` |
| Legal pages | Contact email, phone and address still blank in `BUSINESS` (`build_apps.py`); governing state assumed NSW |
| Data split | The claude.ai copy has its own records. Moving everything to the website is the recommended direction, but the decision is still open. |
| Untested live | Customer intake uploads on real D1, Claude reading of PDFs/diagrams on the site, two people editing one venue at once |
| Monthly menu scan | Runs from this PC's Claude app, so it only fires while the PC is on |

---

## 11. Quick health checks

| Check | How | Good result |
|---|---|---|
| Site is up, which version | https://menuhauler.com/ping (while signed in) | `{"ok":true,…,"version":"2026-11-12.1"}` (or newer) |
| Deploy worked | GitHub → Actions/Cloudflare dashboard → menurunner → Deployments | latest commit listed |
| Server is connected | Converter → enter a menu web address | card says "… Menu Hauler server" |
| Server itself | SSH: `cd ~/menuhauler/server && sudo docker compose ps` | gateway, scraper, tunnel all "running" |
| Who's using it, spend | `/admin`, or `site-viewer/start.cmd` | |
