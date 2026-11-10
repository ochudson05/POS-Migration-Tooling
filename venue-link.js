/* Oolio Menu Tools: links the four tools to one venue.
   The venue (an organisation in the Setup Tracker, shared with the team on claude.ai) is picked in the header,
   and every tab works on it:
   - Restaurant Lookup: a venue's lookup is saved with it and shown again for free; new lookups fill its business details.
   - Menu Converter: files are named after the venue, its printers replace the generic ones, the lookup's menu links are one click,
     and downloading the import saves a summary (products, categories, printers) and ticks "Import products".
   - Photo Finder: gets the venue name and the converted products without loading an export; saving ticks "Add product photos".
   - Setup Tracker: opens on the venue.
   build_apps.py puts this after the tools' own scripts. */
(()=>{
const g=id=>document.getElementById(id),OV=window.OolioVenues;if(!OV)return;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const day=t=>t?new Date(t).toLocaleDateString('en-AU',{day:'numeric',month:'short'}):'';
const view=()=>location.hash.slice(1);
const go=v=>{if(view()===v)window.dispatchEvent(new HashChangeEvent('hashchange'));else location.hash=v};
function suburbOf(a){const parts=String(a||'').split(',').map(s=>s.trim()).filter(Boolean);
  const s=parts.find(x=>/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/.test(x))||parts[1]||'';return s.replace(/\s*\d{4}\s*$/,'').trim()}
function queryOf(o){const q=o.lookupQ||{};return{name:q.name||o.name||'',loc:q.loc||suburbOf(OV.address(o.id))}}

/* ---------- header: which venue ---------- */
const sel=g('lx-venue');
function drawPicker(){const a=OV.activeId,L=OV.list();
  sel.innerHTML=(OV.ready?'<option value="">No venue selected</option>':'<option value="">Loading venues…</option>')+
    L.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name||'Untitled')+'</option>').join('')+(OV.readOnly||!OV.ready?'':'<option value="+">+ New venue…</option>');
  sel.value=a}
sel.addEventListener('change',()=>{if(sel.value==='+'){sel.value=OV.activeId;newVenue();return}
  OV.setActive(sel.value);if(view()==='setup')OV.open(sel.value)});

/* ---------- new venue ---------- */
function newVenue(prefill){const d=g('lx-dlg');
  d.innerHTML='<form method="dialog" class="lx-form"><h2>New venue</h2>'+
    '<label>Venue name<input id="lx-nn" required autocomplete="off" value="'+esc(prefill&&prefill.name||'')+'"></label>'+
    '<label>Suburb or street<input id="lx-nl" autocomplete="off" placeholder="e.g. Surry Hills" value="'+esc(prefill&&prefill.loc||'')+'"></label>'+
    '<label class="lx-ck"><input type="checkbox" id="lx-nrun" checked> Look it up now (free with the Google relay in the Claude app; otherwise about 10–13 Firecrawl credits)</label>'+
    '<div class="lx-row"><button value="ok">Create venue</button><button value="cancel" class="lx-sec" formnovalidate>Cancel</button></div></form>';
  d.showModal();g('lx-nn').focus();
  d.onclose=async()=>{if(d.returnValue!=='ok')return;const name=clean(g('lx-nn').value),loc=clean(g('lx-nl').value),run=g('lx-nrun').checked;if(!name)return;
    try{const id=await OV.create({name,lookupQ:{name,loc}});
      if(run){LK.for=id;go('venue');window.dispatchEvent(new CustomEvent('oolio:lookup-fill',{detail:{name,loc,force:true,clear:true,run:true}}))}else go('')}
    catch(e){alert('Couldn’t create the venue: '+((e&&(e.message||e.code))||'error'))}}}

/* ---------- home: the venue's progress through the tools ---------- */
function drawHub(){const el=g('lx-hub'),a=OV.active();
  if(!a){const L=OV.list().slice(0,8);
    el.innerHTML='<h1>Oolio Menu Tools</h1><p>Pick the venue you’re setting up. Every tool then works on it: the lookup fills its business details, the converted menu goes to Photo Finder and the checklist, and progress is shared with the team.</p>'+
      '<div class="lx-card lx-pick">'+(OV.readOnly?'':'<button type="button" data-hub="new">New venue</button>')+
      (L.length?'<div class="lx-recent">'+L.map(o=>{const p=OV.progress(o.id);return '<button type="button" class="lx-sec" data-hub="pick" data-id="'+esc(o.id)+'"><b>'+esc(o.name||'Untitled')+'</b><span>'+esc(OV.stage(o.id))+' · '+p.done+'/'+p.total+' steps</span></button>'}).join('')+'</div>':
        (OV.ready?'<p class="lx-muted">No venues yet.</p>':'<p class="lx-muted">Loading venues…</p>'))+'</div>';
    return}
  const P=OV.lookup(a.id),pre=OV.progress(a.id,'pre'),trn=OV.progress(a.id,'trn'),all=OV.progress(a.id),m=a.menu,f=a.photos;
  const menuLinks=P&&P.det&&(P.det.menu||[]).length;
  const steps=[
    {k:'lookup',t:'Look up the venue',done:!!a.lookup,s:a.lookup?'Done '+day(a.lookup.at)+'. Business details, contacts and links are filled in.':'Finds the address, ABN, contacts, services, delivery and booking sites, and menu links.',b:a.lookup?'View lookup':'Look it up'},
    {k:'menu',t:'Convert the menu',done:!!m,s:m?m.products+' products in '+(m.cats||[]).length+' categories, '+day(m.at)+'.':(menuLinks?'The lookup found '+menuLinks+' menu link'+(menuLinks>1?'s':'')+' to read.':'From a menu PDF, photo, web page or POS export.'),b:m?'Open converter':'Convert menu'},
    {k:'photos',t:'Find product photos',done:!!f,s:f?f.saved+' photos saved, '+day(f.at)+'.':(m?'Uses the '+m.products+' converted products.':'Uses the converted menu, so do that first.'),b:'Find photos'},
    {k:'setup',t:'Setup checklist',done:all.total>0&&all.done===all.total,s:'Pre-config '+pre.done+'/'+pre.total+' · Training '+trn.done+'/'+trn.total+(a.training?' · Training '+new Date(a.training+'T00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'}):''),b:'Open checklist'}];
  const next=steps.findIndex(s=>!s.done);
  el.innerHTML='<div class="lx-vhead"><div><h1>'+esc(a.name||'Untitled')+'</h1><p>'+esc([OV.address(a.id),OV.stage(a.id)].filter(Boolean).join(' · '))+'</p></div>'+
    '<div class="lx-prog"><span class="lx-bar2"><i style="width:'+(all.total?Math.round(all.done/all.total*100):0)+'%"></i></span>'+all.done+'/'+all.total+' steps</div></div>'+
    '<ol class="lx-steps">'+steps.map((s,i)=>'<li class="lx-step'+(s.done?' done':'')+(i===next?' next':'')+'"><span class="lx-num">'+(s.done?'✓':i+1)+'</span><div><h2>'+esc(s.t)+'</h2><p>'+esc(s.s)+'</p></div>'+
      '<button type="button"'+(i===next?'':' class="lx-sec"')+' data-hub="'+s.k+'">'+esc(s.b)+'</button></li>').join('')+'</ol>'+
    '<p class="lx-muted lx-small">Working on another venue? Switch at the top, or <button type="button" class="lx-link" data-hub="none">clear the venue</button>.</p>'}
document.addEventListener('click',e=>{const b=e.target.closest('[data-hub]');if(!b)return;const k=b.dataset.hub,a=OV.active();
  if(k==='new')newVenue();
  else if(k==='pick'){OV.setActive(b.dataset.id)}
  else if(k==='none'){OV.setActive('')}
  else if(k==='lookup'){if(!a)return;LK.for='';go('venue');if(!a.lookup){const q=queryOf(a);LK.for=a.id;window.dispatchEvent(new CustomEvent('oolio:lookup-fill',{detail:Object.assign(q,{force:true,clear:true,run:true})}))}}
  else if(k==='menu')go('converter');
  else if(k==='photos')go('photos');
  else if(k==='setup'){OV.open(a&&a.id);go('setup')}});

/* ---------- Restaurant Lookup ---------- */
const LK={for:'',last:null,attached:false};
const rfbar=document.createElement('div');rfbar.className='lx-strip';rfbar.id='lx-rfbar';
{const out=g('rf-out');if(out)out.parentNode.insertBefore(rfbar,out)}
function samePlace(L,P){const pl=P.place||{};return !!L&&((L.pid&&L.pid===pl.place_id)||(!L.pid&&L.name===pl.name))}
window.addEventListener('oolio:lookup',e=>{const P=e.detail&&e.detail.P;if(!P||!P.place)return;LK.last=P;const a=OV.active();LK.attached=false;
  if(a&&(!a.lookup||samePlace(a.lookup,P)||LK.for===a.id)){if(!a.lookup||a.lookup.at!==P.at)OV.attachLookup(a.id,P);LK.attached=true}
  LK.for='';drawRf()});
function syncLookup(){const a=OV.active();
  if(a&&LK.shown!==a.id){LK.shown=a.id;const P=OV.lookup(a.id);
    if(P){LK.last=P;LK.attached=true;window.dispatchEvent(new CustomEvent('oolio:lookup-show',{detail:{P,note:'Saved with '+(a.name||'this venue')+' on '+day(a.lookup.at)+'. No credits used.'}}))}
    else{LK.last=null;window.dispatchEvent(new CustomEvent('oolio:lookup-fill',{detail:Object.assign(queryOf(a),{force:true,clear:true})}))}}
  drawRf()}
function drawRf(){const a=OV.active(),P=LK.last,nm=P&&P.place&&P.place.name;let h='';
  if(!a&&!P)h='No venue selected. Look one up, then save it as a venue to use it in the other tools.';
  else if(!a&&P)h='Use '+esc(nm)+' in the other tools? <button type="button" data-rf="new">Save as a new venue</button>';
  else if(!P)h='Looking up <b>'+esc(a.name)+'</b>. The result is saved with it and fills its business details.';
  else if(LK.attached)h='Saved with <b>'+esc(a.name)+'</b>. Its business details and links are in the checklist. <button type="button" class="lx-sec" data-rf="menu">Next: convert the menu</button>';
  else h='This isn’t the lookup saved with <b>'+esc(a.name)+'</b>. <button type="button" data-rf="attach">Save it to '+esc(a.name)+'</button><button type="button" class="lx-sec" data-rf="new">Save as a new venue</button>';
  rfbar.innerHTML=h;rfbar.hidden=OV.readOnly&&!a}
rfbar.addEventListener('click',async e=>{const b=e.target.closest('[data-rf]');if(!b)return;const k=b.dataset.rf,P=LK.last,a=OV.active();
  if(k==='menu')go('converter');
  else if(k==='attach'&&a&&P){OV.attachLookup(a.id,P);LK.attached=true;LK.shown=a.id;drawRf()}
  else if(k==='new'&&P){b.disabled=true;try{const id=await OV.create({name:P.place.name,lookupQ:P.query||{name:P.place.name,loc:''}});OV.attachLookup(id,P);LK.attached=true;LK.shown=id}
    catch(x){alert('Couldn’t create the venue: '+((x&&(x.message||x.code))||'error'))}drawRf()}});

/* ---------- Menu Converter ---------- */
const cvbar=document.createElement('div');cvbar.className='lx-strip';cvbar.id='lx-cvbar';
{const m=g('lx-conv')&&g('lx-conv').querySelector('main');if(m){const h=m.querySelector('p.sub');m.insertBefore(cvbar,h?h.nextSibling:m.firstChild)}}
let cvSig=null,lastMenu=null;
function syncConv(){const a=OV.active(),pr=a?OV.printers(a.id):[];
  window.OOLIO_VENUE_NAME=a?a.name:'';const sig=pr.join('|');window.OOLIO_PRINTERS=pr;
  if(sig!==cvSig){cvSig=sig;if(window.convRefresh)window.convRefresh()}
  if(!a){cvbar.innerHTML='No venue selected. Pick one at the top and downloads are named after it and saved to its checklist.';return}
  const P=OV.lookup(a.id),links=P&&P.det?(P.det.menu||[]).slice(0,4):[],site=P&&P.place&&P.place.website,m=a.menu;
  cvbar.innerHTML='<div>Converting the menu for <b>'+esc(a.name)+'</b>. Files are named after it, and downloading the import saves a summary to its checklist'+(m?' (last: '+m.products+' products, '+day(m.at)+')':'')+'.</div>'+
    '<div>'+(pr.length?'Printers from its checklist: <b>'+esc(pr.join(', '))+'</b>. “Auto” picks from these.':'No printers in its checklist yet, so generic printer names are used. <button type="button" class="lx-link" data-cv="printers">Add the printers</button>')+'</div>'+
    (links.length||site?'<div class="lx-row">'+links.map((u,i)=>'<button type="button" class="lx-sec" data-cv="read" data-u="'+esc(u)+'">Read menu '+(links.length>1?i+1+' ':'')+(/\.pdf(\?|$)/i.test(u)?'(PDF)':'(page)')+'</button>').join('')+
      (!links.length&&site?'<button type="button" class="lx-sec" data-cv="read" data-u="'+esc(site)+'">Read the venue’s website</button>':'')+'<span class="lx-muted lx-small">found by the lookup</span></div>':'')}
cvbar.addEventListener('click',e=>{const b=e.target.closest('[data-cv]');if(!b)return;
  if(b.dataset.cv==='printers'){const a=OV.active();if(a){OV.open(a.id);go('setup');setTimeout(()=>{const s=document.getElementById('st-prn');if(s)s.scrollIntoView()},60)}}
  else{const u=g('url'),r=g('urlb');if(u&&r){u.value=b.dataset.u;r.click()}}});
window.addEventListener('oolio:menu',e=>{const d=e.detail;if(!d)return;lastMenu=d;const a=OV.active();
  if(a){OV.save(a.id,{menu:Object.assign({},d,{by:OV.me()})});OV.tick(a.id,'menu-import')}sendPF(true)});

/* ---------- Photo Finder (in its own frame) ---------- */
const frame=g('lx-pfframe');let pfSig='';
function sendPF(force){if(!frame||!frame.contentWindow||!frame.srcdoc)return;const a=OV.active(),m=(a&&a.menu)||lastMenu;
  const msg={type:'oolio:ctx',venue:a?a.name:'',products:m&&m.names||[],when:m?'converted '+day(m.at):''};
  const sig=msg.venue+'#'+msg.products.length+'#'+(m&&m.at);if(!force&&sig===pfSig)return;pfSig=sig;
  try{frame.contentWindow.postMessage(msg,'*')}catch(e){}}
if(frame)frame.addEventListener('load',()=>{pfSig='';sendPF()});
window.addEventListener('message',e=>{if(!frame||e.source!==frame.contentWindow)return;const d=e.data;if(!d||d.type!=='oolio:photos')return;const a=OV.active();
  if(a&&d.saved>0){OV.save(a.id,{photos:{at:Date.now(),by:OV.me(),saved:d.saved,failed:d.failed||0}});OV.tick(a.id,'menu-photos')}});

/* ---------- keep everything in step ---------- */
function sync(){drawPicker();const v=view();
  if(!v)drawHub();else if(v==='venue')syncLookup();else if(v==='converter')syncConv();else if(v==='photos')sendPF();}
OV.on(sync);window.addEventListener('hashchange',()=>setTimeout(sync,0));
sync();
})();
