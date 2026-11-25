/* Menu Hauler: links the four tools to one venue.
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
function menuCtx(a){const P=OV.lookup(a.id)||{},pl=P.place||{},f=P.found||{},d=P.det||{};
  const urls=o=>Object.entries(o||{}).filter(([,u])=>/^https?:\/\//.test(u));
  return{venue:a.name,website:pl.website||OV.website(a.id),links:(d.menu||[]).slice(),delivery:urls(f.delivery),ordering:[]}}
function findAll(a){if(!a||!window.convFindAll)return;go('converter');setTimeout(()=>window.convFindAll(menuCtx(a)),50)}
function estimate(a){if(!window.convPlan)return null;const p=window.convPlan(menuCtx(a));return p.sources.length?p:null}
function queryOf(o){const q=o.lookupQ||{};return{name:q.name||o.name||'',loc:q.loc||suburbOf(OV.address(o.id))}}

/* ---------- header: which venue ---------- */
const sel=g('lx-venue');
function drawPicker(){const a=OV.activeId,L=OV.list(),G=OV.groups?OV.groups():[],opt=o=>'<option value="'+esc(o.id)+'">'+esc(o.name||'Untitled')+'</option>';
  const byName=(x,y)=>(x.name||'').localeCompare(y.name||''),inG=new Set();
  const groups=G.filter(gr=>gr.venues.length).map(gr=>{const vs=gr.venues.map(id=>L.find(o=>o.id===id)).filter(Boolean).sort(byName);vs.forEach(o=>inG.add(o.id));
    return '<optgroup label="'+esc(gr.name||'Untitled')+'">'+vs.map(opt).join('')+'</optgroup>'}).join('');
  sel.innerHTML=(OV.ready?'<option value="">No venue selected</option>':'<option value="">Loading venues…</option>')+groups+
    L.filter(o=>!inG.has(o.id)).sort(byName).map(opt).join('')+(OV.readOnly||!OV.ready?'':'<option value="+">+ New venue…</option>');
  sel.value=a}
sel.addEventListener('change',()=>{if(sel.value==='+'){sel.value=OV.activeId;newVenue();return}
  OV.setActive(sel.value);if(view()==='setup')OV.open(sel.value)});

/* ---------- new venue ---------- */
function newVenue(prefill){const d=g('lx-dlg'),P=prefill||{},F=OV.flags?OV.flags():[],T=OV.vtypes?OV.vtypes():[],H=!!window.OOLIO_HOSTED;
  // one form for everything known at the start: the venue, what was sold, the dates, then what to do straight away
  d.classList.add('lx-wide');
  d.innerHTML='<form method="dialog" class="lx-form lx-nv"><h2>Start a new venue</h2><p class="lx-cn" style="margin:-6px 0 0">Fill in what you know from the ticket. Everything can be changed later in the Setup Tracker.</p>'+
    '<fieldset><legend>The venue</legend><div class="lx-g2"><label>Venue name<input id="lx-nn" required autocomplete="off" value="'+esc(P.name||'')+'"></label>'+
    '<label>Suburb or street<input id="lx-nl" autocomplete="off" placeholder="e.g. Surry Hills" value="'+esc(P.loc||'')+'"></label>'+
    '<label>Organisation<select id="lx-ng"><option value="">A new organisation with the same name</option>'+(OV.groups?OV.groups():[]).map(gr=>'<option value="'+esc(gr.id)+'"'+(P.group===gr.id?' selected':'')+'>'+esc(gr.name||'Untitled')+' ('+gr.venues.length+' venue'+(gr.venues.length===1?'':'s')+')</option>').join('')+'</select></label>'+
    (T.length?'<label>Venue type<select id="lx-nt"><option value="">Not sure yet</option>'+T.map(([k,t])=>'<option value="'+esc(k)+'">'+esc(t)+'</option>').join('')+'</select></label>':'')+
    '<label>Venue contact<input id="lx-nc" autocomplete="off" placeholder="Name, mobile"></label>'+
    '<label>Owner (who’s setting it up)<input id="lx-no" autocomplete="off" value="'+esc(OV.myName?OV.myName():'')+'"></label></div></fieldset>'+
    (F.length?'<fieldset><legend>What was sold</legend><div class="lx-flags">'+F.map(([k,t])=>'<label class="lx-ck"><input type="checkbox" data-nf="'+esc(k)+'"> '+esc(t)+'</label>').join('')+'</div></fieldset>':'')+
    '<fieldset><legend>Dates</legend><div class="lx-g2"><label>Training date<input type="date" id="lx-ntr"></label><label>Go-live date<input type="date" id="lx-ngl"></label></div></fieldset>'+
    '<fieldset><legend>Straight away</legend>'+
    '<label class="lx-ck"><input type="checkbox" id="lx-nrun" checked> Look it up now ('+(H?'free: Google, the venue’s website and the ABN register':'free with the Google relay in the Claude app; otherwise about 10–13 Firecrawl credits')+')</label>'+
    (T.length?'<label class="lx-ck"><input type="checkbox" id="lx-ntpl" checked> Fill printers, printing workflow and device profiles from the venue type</label>':'')+
    (H?'<label class="lx-ck"><input type="checkbox" id="lx-nik"> Make a customer intake link and copy it, so the venue can send its menus, staff list and details</label>':'')+
    '</fieldset>'+
    '<p class="lx-cn">The venue is saved to the team’s shared records with your name. Lookups send its name and suburb to Google, its website and the ABN register. <a href="#privacy" onclick="this.closest(&quot;dialog&quot;).close()">Privacy Policy</a></p>'+
    '<p class="lx-cn lx-bad" id="lx-nerr" hidden></p>'+
    '<div class="lx-row"><button value="ok" id="lx-nok">Create venue</button><button value="cancel" class="lx-sec" formnovalidate>Cancel</button></div></form>';
  d.showModal();g('lx-nn').focus();
  d.addEventListener('close',()=>d.classList.remove('lx-wide'),{once:true});
  d.querySelector('form').onsubmit=async e=>{if(e.submitter&&e.submitter.value!=='ok')return;e.preventDefault();
    const name=clean(g('lx-nn').value),loc=clean(g('lx-nl').value),run=g('lx-nrun').checked;if(!name)return;
    const v=id=>{const x=g(id);return x?x.value:''},on=id=>{const x=g(id);return!!(x&&x.checked)};
    const flags={};d.querySelectorAll('[data-nf]').forEach(x=>{if(x.checked)flags[x.dataset.nf]=true});
    const owner=clean(v('lx-no')),me=OV.myName?OV.myName():'',vtype=v('lx-nt'),grp=v('lx-ng');
    const o={name,lookupQ:{name,loc},flags};if(grp)o.group=grp;if(vtype)o.vtype=vtype;if(clean(v('lx-nc')))o.contact=clean(v('lx-nc'));
    if(v('lx-ntr'))o.training=v('lx-ntr');if(v('lx-ngl'))o.golive=v('lx-ngl');
    if(owner){o.owner=owner;if(me&&owner.toLowerCase()===me.toLowerCase()&&OV.me)o.ownerId=OV.me()}
    const btn=g('lx-nok');btn.disabled=true;btn.textContent='Creating…';
    try{const id=await OV.create(o);const did=[];
      if(vtype&&on('lx-ntpl')&&OV.applyTemplate){const t=OV.applyTemplate(id);if(t.length)did.push(t.join(', '))}
      if(on('lx-nik')&&OV.makeIntake){try{const url=await OV.makeIntake(id);if(url){try{await navigator.clipboard.writeText(url);did.push('an intake link (copied)')}catch(x){did.push('an intake link (copy it from the Setup Tracker)')}}}catch(x){did.push('no intake link ('+(x.message||'error')+')')}}
      d.close();if(window.mhToast)window.mhToast('Created '+name+(did.length?' with '+did.join(' and '):'')+'.');
      if(run){LK.for=id;go('venue');window.dispatchEvent(new CustomEvent('oolio:lookup-fill',{detail:{name,loc,force:true,clear:true,run:true}}))}else go('')}
    catch(x){const m=g('lx-nerr');m.hidden=false;m.textContent='Couldn’t create the venue: '+((x&&(x.message||x.code))||'error');btn.disabled=false;btn.textContent='Create venue'}}}

window.mhNewVenue=p=>newVenue(p);

/* ---------- home: the venue's progress through the tools ---------- */
const IKC={};// intake link per venue, loaded once per page (website only)
// icons come from shell.js (the Lucide sprite); each step wears its tool's icon and colour
const IC=n=>window.mhIcon?window.mhIcon(n):'';
const STEPICON={lookup:'store',intake:'send',menu:'file-spreadsheet',photos:'images',setup:'list-checks',training:'presentation',golive:'zap',hypercare:'life-buoy'},
  STEPTOOL={lookup:'venue',intake:'setup',menu:'converter',photos:'photos',setup:'setup',training:'training',golive:'setup',hypercare:'hypercare'};
// the tool card for the venue's next step gets a filled button and a "Next for <venue>" tag; the rest stay quiet
function markNext(go,name){document.querySelectorAll('.lx-cards .lx-card').forEach(c=>{const b=c.querySelector('.lx-open'),on=!!go&&!!b&&b.dataset.go===go;c.classList.toggle('lx-next',on);
  let t=c.querySelector('.lx-nexttag');if(on){if(!t){t=document.createElement('span');t.className='lx-nexttag';c.insertBefore(t,c.querySelector('h2'))}t.textContent='Next for '+(name||'this venue')}else if(t)t.remove()})}
function drawHub(){const el=g('lx-hub'),a=OV.active();
  if(!a){const L=OV.list().slice(0,8);
    markNext(null);
    el.innerHTML='<div class="lx-card lx-pick lx-hero"><h1>Which venue are you setting up?</h1><p class="lx-muted">Pick one and every tool works on it, with progress shared with the team.</p>'+(OV.readOnly?'':'<button type="button" data-hub="new">'+IC('plus')+'New venue</button>')+
      (L.length?'<div class="lx-recent">'+L.map(o=>{const p=OV.progress(o.id);return '<div class="lx-vcard"><button type="button" class="lx-sec" data-hub="pick" data-id="'+esc(o.id)+'">'+IC('store')+'<b>'+esc(o.name||'Untitled')+'</b><span>'+(()=>{const gr=OV.groupOf&&OV.groupOf(o.id);return gr&&gr.name!==o.name?esc(gr.name)+' · ':''})()+esc(OV.stage(o.id))+' · '+p.done+'/'+p.total+' steps</span></button>'+
        (OV.readOnly?'':'<button type="button" class="lx-del" data-hub="del" data-id="'+esc(o.id)+'" title="Delete '+esc(o.name||'Untitled')+'" aria-label="Delete '+esc(o.name||'Untitled')+'">Delete</button>')+'</div>'}).join('')+'</div>':
        (OV.ready?'<p class="lx-muted">No venues yet.</p>':'<div class="lx-recent" aria-label="Loading venues"><div class="mh-skel"></div><div class="mh-skel"></div><div class="mh-skel"></div></div>'))+'</div>';
    return}
  const P=OV.lookup(a.id),pre=OV.progress(a.id,'pre'),trn=OV.progress(a.id,'trn'),all=OV.progress(a.id),m=a.menu,f=a.photos;
  // the rest of the journey: intake link (website), training, go-live and hypercare, read from the same venue record
  const H=!!window.OOLIO_HOSTED&&!!OV.intake;if(H&&!(a.id in IKC)){IKC[a.id]=undefined;OV.intake(a.id).then(L=>{IKC[a.id]=L||null;if(OV.activeId===a.id&&!view())drawHub()}).catch(()=>{IKC[a.id]=null})}
  const IK=H?IKC[a.id]:null,tp=window.OolioTraining&&window.OolioTraining.progress&&a.trs?window.OolioTraining.progress(a):null,hst=window.OolioHypercare?window.OolioHypercare.state(a):null;
  const td=new Date(),today=td.getFullYear()+'-'+String(td.getMonth()+1).padStart(2,'0')+'-'+String(td.getDate()).padStart(2,'0');
  const dTo=x=>Math.round((new Date(x+'T00:00')-new Date(today+'T00:00'))/864e5),fd=x=>new Date(x+'T00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
  const late=OV.late?OV.late(a.id):0,hopen=Object.values((a.hc&&a.hc.issues)||{}).filter(x=>x&&x.t&&x.status!=='closed').length;
  const est=!m&&a.lookup?estimate(a):null;
  const steps=[
    {k:'lookup',t:'Look up the venue',done:!!a.lookup,s:a.lookup?'Done '+day(a.lookup.at)+'. Business details, contacts and links are filled in.':'Finds the address, ABN, contacts, services, delivery and booking sites, and menu links.',b:a.lookup?'View lookup':'Look it up'},
    {k:'menu',t:'Find and convert the menus',done:!!m,s:m?m.products+' products in '+(m.cats||[]).length+' categories, '+day(m.at)+'.'+((a.menuLog||[]).length>1?' '+a.menuLog.length+' menu versions.':'')+(a.menuAlert&&!a.menuAlert.seen?' Menu scan '+day(a.menuAlert.at)+': '+a.menuAlert.summary:''):(est?'Reads all '+est.sources.length+' menu source'+(est.sources.length>1?'s':'')+' the lookup found (website, PDFs, ordering and delivery sites, menu pictures). Free reads first; at most '+est.max+' Firecrawl credits.':'From a menu PDF, photo, web page or POS export.'),b:m?'Open converter':est?'Find all menus':'Convert menu'},
    {k:'photos',t:'Find product photos',done:!!f,s:f?f.saved+' photos saved, '+day(f.at)+'.':(m?'Uses the '+m.products+' converted products.':'Uses the converted menu, so do that first.'),b:'Find photos'},
    {k:'setup',t:'Pre-configure Oolio One',done:pre.total>0&&pre.done===pre.total,s:pre.done+' of '+pre.total+' pre-config steps done'+(late?' · '+late+' overdue':'')+'. Business details, payments, devices, printers, menu and users.',b:'Open checklist'},
    {k:'training',t:'Run the training session',done:!!(tp&&tp.finished),s:tp&&tp.finished?'Finished '+day(tp.finished)+(tp.open?' · '+tp.open+' action item'+(tp.open===1?'':'s')+' still open':'')+'.':a.training?'Booked for '+fd(a.training)+(tp&&tp.done?' · '+tp.done+' of '+tp.total+' topics covered':'')+'.':'No training date yet. Add it in the checklist.',b:'Training session'},
    {k:'golive',t:'Go live',done:a.stage==='done'||!!(a.golive&&dTo(a.golive)<=0&&tp&&tp.finished),s:a.golive?(dTo(a.golive)>0?'Go-live '+fd(a.golive)+', in '+dTo(a.golive)+' day'+(dTo(a.golive)===1?'':'s')+'.':dTo(a.golive)===0?'Going live today.':'Went live '+fd(a.golive)+'.')+' The go-live pack has the devices, printers, staff and support details.':'No go-live date yet. Add it in the checklist.',b:'Go-live pack'},
    {k:'hypercare',t:'Hypercare',done:!!(a.hc&&a.hc.ended),s:(hst&&hst.k!=='none'?hst.label:'Starts at go-live')+(hopen?' · '+hopen+' open issue'+(hopen===1?'':'s'):'')+'. Log every issue for the first 14 days, then hand over to support.',b:'Open hypercare'}];
  if(H)steps.splice(1,0,{k:'intake',opt:true,t:'Send the customer intake link',done:!!(IK&&IK.submittedAt),s:IK===undefined?'Checking…':!IK?'Optional. The venue sends its menus, staff list and business details through one link, and signs off the menu and go-live.':IK.submittedAt?'Answers sent in '+day(IK.submittedAt)+'. Fill the checklist from them.':IK.live?'Link made; waiting for the venue to send the form.':'The link has '+(IK.revoked?'been turned off':'expired')+'.',b:!IK?'Make the link':IK.submittedAt?'Open answers':IK.live?'Copy the link':'Open checklist'});
  const next=steps.findIndex(s=>!s.done&&!s.opt);
  markNext(next<0?null:STEPTOOL[steps[next].k],a.name);
  const gr=OV.groupOf?OV.groupOf(a.id):null;
  el.innerHTML='<div class="lx-vhead"><div>'+(gr?'<p class="lx-org"><button type="button" class="lx-link" data-hub="org" data-id="'+esc(gr.id)+'">'+esc(gr.name||'Organisation')+'</button>'+(gr.venues.length>1?' · '+gr.venues.length+' venues':'')+'</p>':'')+'<h1>'+esc(a.name||'Untitled')+'</h1><p>'+esc([OV.address(a.id),OV.stage(a.id)].filter(Boolean).join(' · '))+'</p></div>'+
    '<div class="lx-prog"><span class="lx-bar2"><i style="width:'+(all.total?Math.round(all.done/all.total*100):0)+'%"></i></span>'+all.done+'/'+all.total+' steps</div></div>'+
    ((w=>w?'<p class="lx-wait'+(w.late?' late':'')+'">'+(w.never?'No customer update recorded since the venue was added':'Customer last updated '+(w.days===0?'today':w.days===1?'yesterday':w.days+' days ago'))+(w.late?': they’re waiting on us.':'.')+(OV.readOnly?'':' <button type="button" class="lx-link" data-hub="cu">I’ve updated them today</button>')+'</p>':'')(OV.wait?OV.wait(a.id):null))+
    '<ol class="lx-steps">'+steps.map((s,i)=>'<li class="lx-step t-'+STEPTOOL[s.k]+(s.done?' done':'')+(i===next?' next':'')+'"><span class="lx-num">'+(s.done?IC('check'):IC(STEPICON[s.k]))+'<span class="lx-sr">'+(s.done?'Done: ':'Step '+(i+1)+': ')+'</span></span><div><h2>'+esc(s.t)+(s.opt&&!s.done?' <span class="lx-opt">optional</span>':'')+'</h2><p>'+esc(s.s)+'</p></div>'+
      '<button type="button"'+(i===next?'':' class="lx-sec"')+' data-hub="'+s.k+'">'+esc(s.b)+'</button></li>').join('')+'</ol>'+
    '<p class="lx-muted lx-small">Working on another venue? Switch at the top, or <button type="button" class="lx-link" data-hub="none">clear the venue</button>.'+
    (OV.readOnly?'':' Finished with it? <button type="button" class="lx-link lx-bad" data-hub="del" data-id="'+esc(a.id)+'">Delete this venue</button>.')+'</p>'}

/* ---------- delete a venue ---------- */
// removes the venue for the whole team: checklist progress, the saved lookup and every menu version
function deleteVenue(id){const o=OV.get(id);if(!o||OV.readOnly)return;const d=g('lx-dlg'),n=(o.menuLog||[]).length;
  const what=['its setup checklist and progress',o.lookup?'the saved venue lookup':'',n?n+' saved menu version'+(n>1?'s':''):''].filter(Boolean);
  d.innerHTML='<form method="dialog" class="lx-form"><h2>Delete “'+esc(o.name||'Untitled')+'”?</h2>'+
    '<p class="lx-dtext">This deletes '+esc(what.length>1?what.slice(0,-1).join(', ')+' and '+what[what.length-1]:what[0])+(OV.mode==='local'?' from this browser':' for everyone on the team')+'. It can’t be undone.</p>'+
    '<label>Type the venue name to confirm<input id="lx-dn" autocomplete="off" placeholder="'+esc(o.name||'Untitled')+'"></label>'+
    '<p class="lx-dtext lx-bad" id="lx-derr" hidden></p>'+
    '<div class="lx-row"><button value="ok" class="lx-danger" id="lx-dok" disabled>Delete venue</button><button value="cancel" class="lx-sec" formnovalidate>Cancel</button></div></form>';
  d.showModal();const inp=g('lx-dn'),ok=g('lx-dok'),want=clean(o.name||'Untitled').toLowerCase();
  inp.addEventListener('input',()=>{ok.disabled=clean(inp.value).toLowerCase()!==want});inp.focus();
  d.querySelector('form').onsubmit=async e=>{if(!e.submitter||e.submitter.value!=='ok')return;e.preventDefault();
    ok.disabled=true;ok.textContent='Deleting…';
    try{await OV.remove(id);d.close();if(view()==='setup')OV.open(null);else if(view()&&view()!=='setup')go('')}
    catch(x){const m=g('lx-derr');m.hidden=false;m.textContent='Couldn’t delete it: '+((x&&(x.message||x.code))||'error')+'. Some of it may already be gone; try again.';ok.disabled=false;ok.textContent='Delete venue'}}}
window.lxDeleteVenue=deleteVenue;
document.addEventListener('click',e=>{const b=e.target.closest('[data-hub]');if(!b)return;const k=b.dataset.hub,a=OV.active();
  if(k==='new')newVenue();
  else if(k==='pick'){OV.setActive(b.dataset.id)}
  else if(k==='none'){OV.setActive('')}
  else if(k==='del'){deleteVenue(b.dataset.id)}
  else if(k==='org'){OV.openGroup(b.dataset.id);go('setup')}
  else if(k==='lookup'){if(!a)return;LK.for='';go('venue');if(!a.lookup){const q=queryOf(a);LK.for=a.id;window.dispatchEvent(new CustomEvent('oolio:lookup-fill',{detail:Object.assign(q,{force:true,clear:true,run:true})}))}}
  else if(k==='menu'){if(a&&!a.menu&&a.lookup&&estimate(a))findAll(a);else go('converter')}
  else if(k==='photos')go('photos');
  else if(k==='cu'){if(a&&OV.markUpdated){OV.markUpdated(a.id);setTimeout(drawHub,50)}}
  else if(k==='training')go('training');
  else if(k==='hypercare')go('hypercare');
  else if(k==='golive'){if(a&&OV.pack)OV.pack(a.id)}
  else if(k==='intake'){if(!a)return;const L=IKC[a.id];
    if(!L){if(!OV.makeIntake)return;b.disabled=true;OV.makeIntake(a.id).then(async url=>{IKC[a.id]=await OV.intake(a.id);try{await navigator.clipboard.writeText(url);if(window.mhToast)window.mhToast('Made the intake link and copied it. Send it to the venue owner.')}catch(x){if(window.mhToast)window.mhToast('Made the intake link. Copy it from the Setup Tracker.')}drawHub()}).catch(x=>{b.disabled=false;alert('Couldn’t make the link: '+(x.message||'error'))});return}
    if(L.submittedAt&&window.OolioIntakeOpen){go('setup');window.OolioIntakeOpen(a.id);return}
    if(L.live&&L.url){navigator.clipboard.writeText(L.url).then(()=>{if(window.mhToast)window.mhToast('Intake link copied.')},()=>prompt('Copy the intake link:',L.url));return}
    OV.open(a.id);go('setup')}
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
  else if(LK.attached)h='Saved with <b>'+esc(a.name)+'</b>. Its business details and links are in the checklist. <button type="button" class="lx-sec" data-rf="menu">Next: find all menus</button>';
  else h='This isn’t the lookup saved with <b>'+esc(a.name)+'</b>. <button type="button" data-rf="attach">Save it to '+esc(a.name)+'</button><button type="button" class="lx-sec" data-rf="new">Save as a new venue</button>';
  rfbar.innerHTML=h;rfbar.hidden=OV.readOnly&&!a}
rfbar.addEventListener('click',async e=>{const b=e.target.closest('[data-rf]');if(!b)return;const k=b.dataset.rf,P=LK.last,a=OV.active();
  if(k==='menu'){if(a&&estimate(a))findAll(a);else go('converter')}
  else if(k==='attach'&&a&&P){OV.attachLookup(a.id,P);LK.attached=true;LK.shown=a.id;drawRf()}
  else if(k==='new'&&P){b.disabled=true;try{const id=await OV.create({name:P.place.name,lookupQ:P.query||{name:P.place.name,loc:''}});OV.attachLookup(id,P);LK.attached=true;LK.shown=id}
    catch(x){alert('Couldn’t create the venue: '+((x&&(x.message||x.code))||'error'))}drawRf()}});

/* ---------- Menu Converter ---------- */
const cvbar=document.createElement('div');cvbar.className='lx-strip';cvbar.id='lx-cvbar';
{const m=g('lx-conv')&&g('lx-conv').querySelector('main');if(m){const h=m.querySelector('p.sub');m.insertBefore(cvbar,h?h.nextSibling:m.firstChild)}}
let cvSig=null,lastMenu=null,cvNote='';
function syncConv(){const a=OV.active(),pr=a?OV.printers(a.id):[];
  window.OOLIO_VENUE_NAME=a?a.name:'';const sig=pr.join('|');window.OOLIO_PRINTERS=pr;
  if(sig!==cvSig){cvSig=sig;if(window.convRefresh)window.convRefresh()}
  if(!a){cvNote='';cvbar.innerHTML='No venue selected. Pick one at the top and downloads are named after it and saved to its checklist.';return}
  const P=OV.lookup(a.id),links=P&&P.det?(P.det.menu||[]).slice(0,4):[],site=P&&P.place&&P.place.website,m=a.menu,est=estimate(a);
  cvbar.innerHTML='<div>Converting the menu for <b>'+esc(a.name)+'</b>. Files are named after it, and downloading the import saves a summary to its checklist'+(m?' (last: '+m.products+' products, '+day(m.at)+')':'')+'.</div>'+
    '<div>'+(pr.length?'Printers from its checklist: <b>'+esc(pr.join(', '))+'</b>. “Auto” picks from these.':'No printers in its checklist yet, so generic printer names are used. <button type="button" class="lx-link" data-cv="printers">Add the printers</button>')+'</div>'+
    (est?'<div class="lx-row"><button type="button" data-cv="all">Find all menus</button><span class="lx-muted lx-small">'+est.sources.length+' source'+(est.sources.length>1?'s':'')+' from the lookup, plus menu pictures on the site. Free reads first; at most '+est.max+' Firecrawl credits.</span></div>':
      '<div class="lx-muted lx-small">Look the venue up first and every menu it has can be found in one click.</div>')+
    (links.length||site?'<details><summary class="lx-small">Or read one source</summary><div class="lx-row" style="margin-top:6px">'+links.map((u,i)=>'<button type="button" class="lx-sec" data-cv="read" data-u="'+esc(u)+'">Read menu '+(links.length>1?i+1+' ':'')+(/\.pdf(\?|$)/i.test(u)?'(PDF)':'(page)')+'</button>').join('')+
      (site?'<button type="button" class="lx-sec" data-cv="read" data-u="'+esc(site)+'">Website</button>':'')+'</div></details>':'')+
    (cvNote?'<div><b>'+esc(cvNote)+'</b></div>':'')}
cvbar.addEventListener('click',e=>{const b=e.target.closest('[data-cv]');if(!b)return;
  if(b.dataset.cv==='all'){const a=OV.active();if(a&&window.convFindAll)window.convFindAll(menuCtx(a));return}
  if(b.dataset.cv==='printers'){const a=OV.active();if(a){OV.open(a.id);go('setup');setTimeout(()=>{const s=document.getElementById('st-prn');if(s)s.scrollIntoView()},60)}}
  else{const u=g('url'),r=g('urlb');if(u&&r){u.value=b.dataset.u;r.click()}}});
window.addEventListener('oolio:menu',async e=>{const d=e.detail;if(!d)return;lastMenu=d;const a=OV.active();
  if(a){const{items,sources,urls}=d,m=Object.assign({},d,{by:OV.me()});delete m.items;delete m.sources;delete m.urls;
    OV.save(a.id,{menu:m});OV.tick(a.id,'menu-import');
    // each download is kept as a menu version of the venue, with what changed since the last one
    try{const r=await OV.addMenuVersion(a.id,{kind:'export',file:d.file,items,sources,urls});
      cvNote=!r?'':r.same?'Same menu as version '+r.ver+', so no new version was saved.':
        'Saved as menu version '+r.ver+' of '+a.name+': +'+r.added+' new, −'+r.removed+' removed'+(r.renamed?', '+r.renamed+' renamed':'')+', '+(r.up+r.down)+' price change'+(r.up+r.down===1?'':'s')+'. See the history in its checklist.';
      if(cvNote&&!r.same&&r.ver===1)cvNote='Saved as the first menu version of '+a.name+'. Later downloads and monthly scans are compared with it.'}
    catch(x){cvNote='The menu version couldn’t be saved ('+((x&&(x.message||x.code))||'error')+').'}
    syncConv()}
  sendPF(true)});

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
