"""Builds apps.html: one page that launches the Menu Converter, Photo Finder, Restaurant Lookup and Setup Tracker,
with the legal pages from legal.html (business details in BUSINESS below) and a footer on every view.

    python build_apps.py [publish_copy.html]

Reads menu-converter.html and photo-finder.html from this folder (edit those, then rebuild).
- apps.html: the launcher as a normal page, for opening locally.
- publish_copy.html (optional): the same page without the <!DOCTYPE>/<html>/<head>/<body>
  wrapper and charset/viewport metas, which is the form the claude.ai artifact service wants.

The converter runs in the launcher page itself, because its claude.ai features (Firecrawl, the
Claude app's browser, reading photos with Claude, downloads) only reach the top page. The Photo
Finder runs in a frame made from its own file, so the two tools' code and element ids never clash.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def between(text, start, end, from_pos=0):
    a = text.index(start, from_pos) + len(start)
    b = text.index(end, a)
    return text[a:b], b + len(end)


conv = (HERE / "menu-converter.html").read_text(encoding="utf-8")
pf = (HERE / "photo-finder.html").read_text(encoding="utf-8")

conv_css, _ = between(conv, "<style>", "</style>")
body_start = conv.index("<body>") + len("<body>")
script_start = conv.index("<script>", body_start)
conv_body = conv[body_start:script_start].strip()
conv_js = conv[script_start + len("<script>"):conv.rindex("</script>")]

# Restaurant Lookup also runs in the top page (it needs Firecrawl and Claude); its ids and classes start rf-
rl = (HERE / "restaurant-lookup.html").read_text(encoding="utf-8")
rl_css, _ = between(rl, "<style>", "</style>")
rl_css = re.sub(r"/\*BASE.*?/\*END BASE\*/", "", rl_css, flags=re.S)
rl_body_start = rl.index("<body>") + len("<body>")
rl_script = rl.index("<script>", rl_body_start)
rl_body = rl[rl_body_start:rl_script].strip()
rl_js = rl[rl_script + len("<script>"):rl.rindex("</script>")]

# Setup Tracker also runs in the top page (its shared database and the downloads capability only reach it); ids and classes start st-
stp = (HERE / "setup-tracker.html").read_text(encoding="utf-8")
st_css, _ = between(stp, "<style>", "</style>")
st_css = re.sub(r"/\*BASE.*?/\*END BASE\*/", "", st_css, flags=re.S)
st_body_start = stp.index("<body>") + len("<body>")
st_script = stp.index("<script>", st_body_start)
st_body = stp[st_body_start:st_script].strip()
st_js = stp[st_script + len("<script>"):stp.rindex("</script>")]

# the Photo Finder's page as a JS string; "</" is written "<\/" so it can't close this page's <script>
# the Oolio One look (oolio-theme.css) goes after every tool's own CSS, and into the Photo Finder frame too
THEME = (HERE / "oolio-theme.css").read_text(encoding="utf-8")
FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">'
pf = pf.replace("</head>", FONT + "\n<style>" + THEME + "</style>\n</head>", 1)
pf_js = json.dumps(pf, ensure_ascii=False).replace("</", "<\\/")

# ---------- legal and compliance pages (legal.html; see COMPLIANCE.md) ----------
# The business details shown in the footer and on every legal page. Blank values are left out and the build warns.
BUSINESS = {
    "operator": "Oscar Hudson",        # registered name, confirmed by the owner 11 Nov 2026 (ABN Lookup had no record yet)
    "trading_name": "",                # registered business name, if the tools are run under one
    "abn": "60 219 896 086",
    "acn": "",                         # only if the operator is a company
    "email": "ochudson05@gmail.com",                       # contact email for privacy, accessibility, content and security requests
    "phone": "0408 941 151",
    "address": "",                     # business or postal address
    "state": "Queensland",             # governing law in the Terms of Use
    "site": "https://menuhauler.com",
    "updated": "11 November 2026",
    "year": "2026",
}
for k in ("email", "phone"):
    if not BUSINESS[k]:
        print("warning: BUSINESS['" + k + "'] is blank; the legal pages need it before going live")
B = BUSINESS
esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
who = esc(B["operator"]) + (" trading as " + esc(B["trading_name"]) if B["trading_name"] else "")
email_link = ('<a href="mailto:' + esc(B["email"]) + '">' + esc(B["email"]) + "</a>") if B["email"] else "us using the details on the Contact page"
rows = [("Business", who), ("ABN", esc(B["abn"]))] + ([("ACN", esc(B["acn"]))] if B["acn"] else []) + \
       ([("Email", email_link)] if B["email"] else []) + \
       ([("Phone", '<a href="tel:' + B["phone"].replace(" ", "") + '">' + esc(B["phone"]) + "</a>")] if B["phone"] else []) + \
       ([("Address", esc(B["address"]))] if B["address"] else [])
contact = '<dl class="lg-dl">' + "".join("<dt>" + a + "</dt><dd>" + b + "</dd>" for a, b in rows) + "</dl>"
legal = (HERE / "legal.html").read_text(encoding="utf-8")
legal = re.sub(r"<!--.*?-->", "", legal, count=1, flags=re.S).strip()
for k, v in {"OPERATOR": who, "ABN": esc(B["abn"]), "EMAIL_LINK": email_link, "STATE": esc(B["state"]), "SITE": esc(B["site"]),
             "UPDATED": esc(B["updated"]), "YEAR": B["year"], "CONTACT": contact}.items():
    legal = legal.replace("{{" + k + "}}", v)
assert "{{" not in legal, "unknown {{...}} in legal.html"
LEGAL_PAGES = re.findall(r'<article class="lg-doc" id="lg-([a-z]+)" data-title="([^"]+)"', legal)
LEGAL_NAV = "".join('<a href="#' + k + '">' + t + "</a>" for k, t in LEGAL_PAGES)
FOOTER = ('<footer class="lx-foot"><p>© ' + B["year"] + " " + who + " · ABN " + esc(B["abn"]) +
          (" · ACN " + esc(B["acn"]) if B["acn"] else "") + '</p><nav aria-label="Legal and policies">' + LEGAL_NAV + "</nav></footer>")

LEGAL_CSS = r"""
/* legal pages (legal.html) and the footer on every view */
.lx-legal{max-width:1000px;margin:0 auto;padding-block:24px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;align-items:start}
.lx-lnav{display:grid;gap:2px;position:sticky;top:12px;font-size:.9rem}
.lx-lnav a,.lx-foot a{color:var(--accent);text-decoration:none}.lx-lnav a{padding:5px 8px;border-radius:6px}
.lx-lnav a[aria-current="page"]{background:var(--accent-soft);font-weight:600}
.lx-lnav a:hover,.lx-foot a:hover{text-decoration:underline}
.lx-lnav a:focus-visible,.lx-foot a:focus-visible,.lg-doc a:focus-visible,.lx-cn a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lg-doc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;min-width:0;line-height:1.55;max-width:78ch}
.lg-doc h1{font-size:1.5rem;margin:0 0 4px;text-wrap:balance}.lg-doc h2{font-size:1.08rem;margin:22px 0 6px}
.lg-doc p,.lg-doc li{font-size:.95rem}.lg-doc ul{padding-left:1.2em}.lg-doc li{margin:4px 0}
.lg-doc a{color:var(--accent)}
.lg-upd{color:var(--muted);font-size:.85rem!important;margin:0 0 14px}
.lg-tw{overflow-x:auto;margin:8px 0}
.lg-t{border-collapse:collapse;width:100%;font-size:.86rem}
.lg-t th,.lg-t td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.lg-t th{background:var(--bg);font-weight:600}
.lg-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:8px 0 14px}.lg-dl dt{color:var(--muted)}.lg-dl dd{margin:0}
.lx-foot{border-top:1px solid var(--line);background:var(--card);color:var(--muted);font-size:.82rem;padding-block:14px 18px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:6px;justify-items:center;text-align:center}
.lx-foot p{margin:0}.lx-foot nav{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:center}
.lx-cn{font-size:.82rem;color:var(--muted);margin:6px 0 0;line-height:1.4}.lx-cn a{color:var(--accent)}
@media (max-width:720px){.lx-legal{grid-template-columns:1fr}.lx-lnav{position:static;display:flex;flex-wrap:wrap;gap:4px}.lg-doc{padding:16px}}
"""

LAUNCHER_CSS = r"""
/* Launcher: a slim bar with the two tools as tabs; the start view shows each tool as a card */
[hidden]{display:none!important}
.lx-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;padding-block:10px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));border-bottom:1px solid var(--line);background:var(--card)}
.lx-brand{font:inherit;font-weight:700;font-size:1rem;background:none;border:0;color:var(--text);padding:4px 0;margin:0;cursor:pointer}
.lx-tabs{display:flex;gap:4px;flex-wrap:wrap}
.lx-tab{font:inherit;font-size:.9rem;font-weight:600;background:none;border:1px solid transparent;color:var(--muted);border-radius:8px;padding:6px 12px;margin:0;cursor:pointer}
.lx-tab[aria-current="page"]{color:var(--accent);border-color:var(--line);background:var(--bg)}
.lx-tab:focus-visible,.lx-brand:focus-visible,.lx-open:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lx-home{max-width:960px;margin:0 auto;padding-block:28px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:18px}
.lx-home h1{font-size:1.5rem;margin:0;text-wrap:balance}
.lx-home>p{color:var(--muted);margin:0;max-width:65ch}
.lx-cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.lx-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;display:grid;gap:10px;align-content:start;min-width:0}
.lx-card h2{font-size:1.1rem;margin:0}
.lx-card p{margin:0;color:var(--muted);font-size:.92rem}
.lx-flow{font-size:.85rem;color:var(--text);display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}
.lx-flow dt{color:var(--muted)}.lx-flow dd{margin:0}
.lx-open{justify-self:start;margin:4px 0 0}
.lx-note{max-width:960px;margin:14px auto 0;padding:12px 14px;border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:8px;background:var(--card);font-size:.9rem;display:grid;gap:8px}
.lx-note button{justify-self:start;margin:0}
.lx-pfwrap{padding-left:max(0px,env(safe-area-inset-left,0px));padding-right:max(0px,env(safe-area-inset-right,0px))}
.lx-pfwrap .lx-note{margin-left:max(16px,env(safe-area-inset-left,0px));margin-right:max(16px,env(safe-area-inset-right,0px))}
/* the venue: header picker, home hub, and the strip each tool shows */
.lx-venue{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:.85rem;color:var(--muted);min-width:0}
.lx-venue select{font:inherit;font-size:.9rem;font-weight:600;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:5px 8px;max-width:min(260px,60vw);width:auto;margin:0}
.lx-toolsh{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 -6px}
#lx-hub{display:grid;gap:14px}
#lx-hub h1{font-size:1.5rem;margin:0;text-wrap:balance}
#lx-hub>p{color:var(--muted);margin:0;max-width:70ch}
.lx-muted{color:var(--muted)}.lx-small{font-size:.85rem}
.lx-pick{display:grid;gap:12px}.lx-pick>button{justify-self:start;margin:0}
.lx-recent{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.lx-recent button{display:grid;gap:2px;text-align:left;margin:0;font-weight:400}
.lx-recent button span{color:var(--muted);font-size:.82rem}
.lx-vcard{display:grid;gap:4px}.lx-vcard>button:first-child{width:100%}
.lx-del{justify-self:end;background:none!important;border:0!important;padding:0 2px!important;margin:0!important;font:inherit;font-size:.78rem;color:var(--muted)!important;cursor:pointer}
.lx-del:hover,.lx-del:focus-visible{color:var(--bad)!important;text-decoration:underline}
.lx-bad,.lx-link.lx-bad{color:var(--bad)!important}
.lx-dtext{margin:0;font-size:.9rem}
.lx-row .lx-danger{background:var(--bad)!important;color:#fff!important}.lx-row .lx-danger:disabled{opacity:.45;cursor:not-allowed}
.lx-vhead{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:end;justify-content:space-between}
.lx-vhead p{margin:2px 0 0;color:var(--muted)}
.lx-vhead .lx-org{margin:0 0 2px;font-size:.88rem}
.lx-prog{display:flex;gap:8px;align-items:center;font-size:.88rem;font-variant-numeric:tabular-nums}
.lx-bar2{display:block;width:160px;height:8px;border-radius:4px;background:var(--line);overflow:hidden}.lx-bar2 i{display:block;height:100%;background:var(--ok)}
.lx-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.lx-step{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 14px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.lx-step.next{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.lx-step h2{font-size:1rem;margin:0}.lx-step p{margin:2px 0 0;color:var(--muted);font-size:.88rem}
.lx-step button{margin:0}
.lx-num{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:700;border:2px solid var(--line);color:var(--muted);font-size:.9rem}
.lx-step.next .lx-num{border-color:var(--accent);color:var(--accent)}
.lx-step.done .lx-num{background:var(--ok);border-color:var(--ok);color:#fff}
@media (max-width:560px){.lx-step{grid-template-columns:auto minmax(0,1fr)}.lx-step button{grid-column:2;justify-self:start}}
.lx-strip{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;background:var(--card);padding:10px 12px;font-size:.9rem;display:grid;gap:6px;margin:0 0 16px}
.lx-strip button,.lx-row button{font:inherit;font-size:.85rem;font-weight:600;padding:5px 10px;margin:0 6px 0 0;border-radius:8px;cursor:pointer;background:var(--accent);color:var(--accent-text);border:0}
.lx-sec,.lx-strip .lx-sec,.lx-row .lx-sec{background:transparent!important;color:var(--text)!important;border:1px solid var(--line)!important}
.lx-link,.lx-strip .lx-link{background:none!important;border:0!important;color:var(--accent)!important;padding:0!important;font:inherit;font-weight:600;cursor:pointer;margin:0!important}
.lx-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#lx-rf .lx-strip{max-width:1100px;margin:16px auto 0}
.lx-dlg{border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);padding:18px;width:min(460px,calc(100vw - 32px))}
.lx-dlg::backdrop{background:rgb(0 0 0 / .4)}
.lx-form{display:grid;gap:12px}.lx-form h2{margin:0;font-size:1.15rem}
.lx-form label{display:grid;gap:4px;font-size:.85rem;color:var(--muted)}
.lx-form input{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%}
.lx-form .lx-ck{display:flex;gap:8px;align-items:flex-start}.lx-form .lx-ck input{width:auto;margin-top:3px}
/* notes that differ between claude.ai and the website (hosted.js adds .oolio-hosted to <html>) */
.hosted-only{display:none!important}
html.oolio-hosted .hosted-only{display:block!important}
html.oolio-hosted .claude-only,html.oolio-hosted #rf-setbox{display:none!important}
.oh-banner{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px max(16px,env(safe-area-inset-left,0px));background:var(--warn);color:var(--card);font-size:.92rem}
.oh-banner button{font:inherit;font-weight:600;background:var(--card);color:var(--text);border:0;border-radius:6px;padding:4px 12px;cursor:pointer;margin:0}
#lx-pfframe{display:block;width:100%;border:0;height:calc(100vh - 56px);min-height:520px;background:var(--bg)}
"""

LAUNCHER_HTML = """
<header class="lx-bar">
  <button type="button" class="lx-brand" data-go="">Menu Hauler</button>
  <nav class="lx-tabs" aria-label="Tools">
    <button type="button" class="lx-tab" data-go="converter">Menu Converter</button>
    <button type="button" class="lx-tab" data-go="photos">Photo Finder</button>
    <button type="button" class="lx-tab" data-go="venue">Restaurant Lookup</button>
    <button type="button" class="lx-tab" data-go="setup">Setup Tracker</button>
  </nav>
  <label class="lx-venue"><span>Venue</span><select id="lx-venue" aria-label="Venue you are working on"><option value="">Loading venues…</option></select></label>
</header>
<dialog class="lx-dlg" id="lx-dlg"></dialog>
<section class="lx-home" id="lx-home">
  <div id="lx-hub"></div>
  <h2 class="lx-toolsh">All tools</h2>
  <div class="lx-cards">
    <article class="lx-card">
      <h2>Menu Converter</h2>
      <p>Turns a customer’s menu into a file the Oolio One setup wizard accepts, with categories, size variants and modifier groups worked out.</p>
      <dl class="lx-flow"><dt>Takes</dt><dd>Square or Lightspeed exports, spreadsheets, menu PDFs, web pages, menu photos</dd><dt>Gives</dt><dd>Oolio One product import (.csv or .xlsx) and modifier groups</dd></dl>
      <button type="button" class="lx-open" data-go="converter">Open Menu Converter</button>
    </article>
    <article class="lx-card">
      <h2>Photo Finder</h2>
      <p>Finds a free photo for every product and saves them in a folder named after the venue, each image named exactly like its product.</p>
      <dl class="lx-flow"><dt>Takes</dt><dd>Product export from Oolio One (.csv or .xlsx)</dd><dt>Gives</dt><dd>A venue folder of JPEGs plus a photo credits list</dd></dl>
      <button type="button" class="lx-open" data-go="photos">Open Photo Finder</button>
    </article>
    <article class="lx-card">
      <h2>Restaurant Lookup</h2>
      <p>One page on any venue: address, legal name and ABN, services, reviews and popular dishes, and its delivery, booking and ordering links.</p>
      <dl class="lx-flow"><dt>Takes</dt><dd>The venue’s name and suburb</dd><dt>Gives</dt><dd>A venue profile, usually free in the Claude app with the Google relay, saved for 14 days</dd></dl>
      <button type="button" class="lx-open" data-go="venue">Open Restaurant Lookup</button>
    </article>
    <article class="lx-card">
      <h2>Setup Tracker</h2>
      <p>Tracks each organisation’s setup against the Config Recap Checklist, shared with the team, with the matching help.oolio.com guide on every step.</p>
      <dl class="lx-flow"><dt>Takes</dt><dd>The venue, or a Restaurant Lookup result</dd><dt>Gives</dt><dd>Progress for each step, devices and printers checked against the rules, and a recap to paste into HubSpot</dd></dl>
      <button type="button" class="lx-open" data-go="setup">Open Setup Tracker</button>
    </article>
  </div>
</section>
<div id="lx-conv" hidden>
""" + conv_body + """
</div>
<div id="lx-rf" hidden>
""" + rl_body + """
</div>
<div id="lx-st" hidden>
""" + st_body + """
</div>
<div id="lx-pf" class="lx-pfwrap" hidden>
  <div class="lx-note" id="lx-pfnote" hidden>
    <span>Photo search and saving are blocked on claude.ai, because claude.ai pages can’t download pictures from other websites. Save the Photo Finder to your computer and open the file in Edge or Chrome. It works there with nothing to install.</span>
    <button type="button" id="lx-pfsave">Save Photo Finder</button>
    <span id="lx-pfmsg" class="warn" style="margin:0"></span>
  </div>
  <iframe id="lx-pfframe" title="Photo Finder"></iframe>
</div>
<div id="lx-legal" class="lx-legal" hidden>
<nav class="lx-lnav" aria-label="Policies">""" + LEGAL_NAV + """</nav>
<div>""" + legal + """</div>
</div>
""" + FOOTER + "\n"

LAUNCHER_JS = r"""
(()=>{
  const g=id=>document.getElementById(id),views={'':g('lx-home'),converter:g('lx-conv'),photos:g('lx-pf'),venue:g('lx-rf'),setup:g('lx-st')};
  const LEGAL=[...document.querySelectorAll('#lx-legal .lg-doc')].map(a=>a.id.slice(3));LEGAL.forEach(k=>{views[k]=g('lx-legal')});
  const onClaude=!!(window.claude&&window.claude.use)||/(^|\.)claude(usercontent)?\.(ai|com)$/.test(location.hostname);
  let pfReady=false,checked=false;
  // the Photo Finder is only built the first time it's opened, so its libraries don't load until needed
  function openPF(){
    if(!pfReady){pfReady=true;g('lx-pfframe').srcdoc=PF_HTML}
    if(onClaude&&!checked){checked=true;canFetchPhotos().then(ok=>{g('lx-pfnote').hidden=ok})}}
  // can this page reach the free photo libraries? (one request to Wikimedia, which has no daily limit)
  function canFetchPhotos(){return new Promise(res=>{let done=false;const end=v=>{if(!done){done=true;res(v)}};setTimeout(()=>end(false),6000);
    fetch('https://commons.wikimedia.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*',{credentials:'omit'}).then(r=>r.json())
      .then(()=>{const i=new Image();i.onload=()=>end(true);i.onerror=()=>end(false);i.src='https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/40px-Example.jpg'}).catch(()=>end(false))})}
  function show(){let v=location.hash.slice(1);if(!(v in views))v='';
    const cur=views[v];new Set(Object.values(views)).forEach(el=>{el.hidden=el!==cur});
    if(LEGAL.includes(v)){document.querySelectorAll('#lx-legal .lg-doc').forEach(a=>{a.hidden=a.id!=='lg-'+v});document.querySelectorAll('.lx-lnav a').forEach(a=>{if(a.getAttribute('href')==='#'+v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});document.title=g('lg-'+v).dataset.title+' · Menu Hauler'}else document.title='Menu Hauler';
    document.querySelectorAll('.lx-tab').forEach(b=>{if(b.dataset.go===v)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    if(v==='photos')openPF();window.scrollTo(0,0)}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(!b)return;const v=b.dataset.go;
    if(location.hash.slice(1)===v)return;if(v)location.hash=v;else{history.pushState?history.pushState(null,'',location.pathname+location.search):location.hash='';show()}});
  window.addEventListener('hashchange',show);window.addEventListener('popstate',show);
  g('lx-pfsave').addEventListener('click',async()=>{const m=g('lx-pfmsg');m.textContent='';
    let dl=null;try{dl=window.claude&&window.claude.use?await window.claude.use('downloads'):null}catch(e){}
    if(!dl){m.textContent='Saving isn’t available in this view. Ask whoever shared this page for the photo-finder.html file.';return}
    try{await dl.save({filename:'Photo Finder.html',data:new Blob([PF_HTML],{type:'text/html'})});m.textContent='Saved. Open “Photo Finder.html” from your Downloads folder.'}
    catch(e){if(!e||e.code!=='declined')m.textContent='The file couldn’t be saved ('+((e&&(e.message||e.code))||'unknown error')+').'}});
  show();
})();
"""

page = (
    "<title>Menu Hauler</title>\n"
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>\n'
    + FONT + "\n"
    "<style>" + conv_css + LAUNCHER_CSS + LEGAL_CSS + rl_css + st_css + THEME + "</style>\n"
    + LAUNCHER_HTML
    + "<script>" + conv_js + "</script>\n"
    + "<script>" + rl_js + "</script>\n"
    + "<script>" + st_js + "</script>\n"
    + "<script>\nconst PF_HTML=" + pf_js + ";\n" + LAUNCHER_JS + "</script>\n"
    + "<script>" + (HERE / "venue-link.js").read_text(encoding="utf-8") + "</script>\n"
)

full = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + page.replace("\n<header", "\n</head>\n<body>\n<header", 1)
    + "</body>\n</html>\n"
)
(HERE / "apps.html").write_text(full, encoding="utf-8")
# the website (Cloudflare Worker "menurunner", see wrangler.toml): the same page with hosted.js first,
# which connects the tools to the website's sign-in, shared records and Firecrawl instead of claude.ai's
hosted = full.replace("<title>Menu Hauler</title>",
                      "<title>Menu Hauler</title>\n<script>" + (HERE / "hosted.js").read_text(encoding="utf-8") + "</script>", 1)
(HERE / "public").mkdir(exist_ok=True)
(HERE / "public" / "index.html").write_bytes(hosted.replace("\r\n", "\n").encode("utf-8"))
print("wrote", HERE / "public" / "index.html", len(hosted), "bytes")
# public/legal/: the same pages, readable without signing in (needs a Cloudflare Access "Bypass" rule for /legal/* and /.well-known/*)
standalone = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    "<title>Policies · Menu Hauler</title>\n" + FONT + "\n<style>" + THEME + "[hidden]{display:none!important}" + LEGAL_CSS +
    ".lx-top{padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card);font-weight:700}.lx-top a{color:var(--text);text-decoration:none}</style>\n</head>\n<body>\n"
    '<header class="lx-top"><a href="/">Menu Hauler</a></header>\n<main class="lx-legal">\n<nav class="lx-lnav" aria-label="Policies">' + LEGAL_NAV + "</nav>\n<div>" + legal + "</div>\n</main>\n" + FOOTER +
    "\n<script>(()=>{const ks=[...document.querySelectorAll('.lg-doc')].map(a=>a.id.slice(3));function show(){let v=location.hash.slice(1);if(!ks.includes(v))v=ks[0];"
    "document.querySelectorAll('.lg-doc').forEach(a=>{a.hidden=a.id!=='lg-'+v});document.querySelectorAll('.lx-lnav a').forEach(a=>{if(a.getAttribute('href')==='#'+v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});"
    "document.title=document.getElementById('lg-'+v).dataset.title+' · Menu Hauler';window.scrollTo(0,0)}window.addEventListener('hashchange',show);show()})();</script>\n</body>\n</html>\n")
(HERE / "public" / "legal").mkdir(exist_ok=True)
(HERE / "public" / "legal" / "index.html").write_bytes(standalone.replace("\r\n", "\n").encode("utf-8"))
(HERE / "public" / ".well-known").mkdir(exist_ok=True)
sec = ("# Security contact for Menu Hauler (RFC 9116)\n" + ("Contact: mailto:" + B["email"] + "\n" if B["email"] else "") +
       "Contact: " + B["site"] + "/legal/#security\nPolicy: " + B["site"] + "/legal/#security\nPreferred-Languages: en\n"
       "Canonical: " + B["site"] + "/.well-known/security.txt\nExpires: 2027-11-11T00:00:00.000Z\n")
(HERE / "public" / ".well-known" / "security.txt").write_bytes(sec.encode("utf-8"))
print("wrote", HERE / "public" / "legal" / "index.html", "and public/.well-known/security.txt")

print("wrote", HERE / "apps.html", len(full), "bytes")
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(page, encoding="utf-8")
    print("wrote", sys.argv[1], len(page), "bytes")
