"""Builds apps.html: one page that launches the Menu Converter and the Photo Finder.

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

# the Photo Finder's page as a JS string; "</" is written "<\/" so it can't close this page's <script>
pf_js = json.dumps(pf, ensure_ascii=False).replace("</", "<\\/")

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
#lx-pfframe{display:block;width:100%;border:0;height:calc(100vh - 56px);min-height:520px;background:var(--bg)}
"""

LAUNCHER_HTML = """
<header class="lx-bar">
  <button type="button" class="lx-brand" data-go="">Oolio Menu Tools</button>
  <nav class="lx-tabs" aria-label="Tools">
    <button type="button" class="lx-tab" data-go="converter">Menu Converter</button>
    <button type="button" class="lx-tab" data-go="photos">Photo Finder</button>
    <button type="button" class="lx-tab" data-go="venue">Restaurant Lookup</button>
  </nav>
</header>
<section class="lx-home" id="lx-home">
  <h1>Oolio Menu Tools</h1>
  <p>Tools for researching and setting up a venue in Oolio One. Open any one on its own; each keeps its own work while you switch between them.</p>
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
  </div>
</section>
<div id="lx-conv" hidden>
""" + conv_body + """
</div>
<div id="lx-rf" hidden>
""" + rl_body + """
</div>
<div id="lx-pf" class="lx-pfwrap" hidden>
  <div class="lx-note" id="lx-pfnote" hidden>
    <span>Photo search and saving are blocked on claude.ai, because claude.ai pages can’t download pictures from other websites. Save the Photo Finder to your computer and open the file in Edge or Chrome. It works there with nothing to install.</span>
    <button type="button" id="lx-pfsave">Save Photo Finder</button>
    <span id="lx-pfmsg" class="warn" style="margin:0"></span>
  </div>
  <iframe id="lx-pfframe" title="Photo Finder"></iframe>
</div>
"""

LAUNCHER_JS = r"""
(()=>{
  const g=id=>document.getElementById(id),views={'':g('lx-home'),converter:g('lx-conv'),photos:g('lx-pf'),venue:g('lx-rf')};
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
    Object.entries(views).forEach(([k,el])=>{el.hidden=k!==v});
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
    "<title>Oolio Menu Tools</title>\n"
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>\n'
    "<style>" + conv_css + LAUNCHER_CSS + rl_css + "</style>\n"
    + LAUNCHER_HTML
    + "<script>" + conv_js + "</script>\n"
    + "<script>" + rl_js + "</script>\n"
    + "<script>\nconst PF_HTML=" + pf_js + ";\n" + LAUNCHER_JS + "</script>\n"
)

full = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + page.replace("\n<header", "\n</head>\n<body>\n<header", 1)
    + "</body>\n</html>\n"
)
(HERE / "apps.html").write_text(full, encoding="utf-8")
print("wrote", HERE / "apps.html", len(full), "bytes")
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(page, encoding="utf-8")
    print("wrote", sys.argv[1], len(page), "bytes")
