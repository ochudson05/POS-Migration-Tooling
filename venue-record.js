/* Menu Hauler: the venue record. Under the home hub's four steps, one place shows everything saved for the active venue
   by every tool: menu (with the linter's result), hardware and routing, checklist, training, hypercare, the venue portal,
   and a timeline of who changed what (with undo). Also here:
   - the routing map (#routing): menu categories → printers → KDS screens, from the converter's last menu and the
     tracker's printers and devices, with what routes nowhere;
   - email templates (welcome, data request, go-live reminder, handover), filled in from the venue, to copy or open in
     the mail app (nothing is sent from the site).
   Reads window.OolioVenues only; build_apps.py puts it after venue-link.js. Ids and classes start vr-. */
(()=>{
const g=id=>document.getElementById(id),OV=window.OolioVenues;if(!OV)return;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const IC=n=>window.mhIcon?window.mhIcon(n):'';
const view=()=>location.hash.slice(1);
const go=v=>{if(view()===v)window.dispatchEvent(new HashChangeEvent('hashchange'));else location.hash=v};
const day=t=>t?new Date(t).toLocaleDateString('en-AU',{day:'numeric',month:'short'}):'';
const fmtDate=d=>d?new Date(d+'T00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'';
const ago=t=>{if(!t)return'';const s=(Date.now()-t)/1000;return s<60?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':day(t)};
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
const fold=s=>clean(s).toLowerCase();

/* ---------- the record panels on the home hub ---------- */
const hub=g('lx-hub');if(!hub)return;
const rec=document.createElement('section');rec.id='vr-rec';rec.className='vr-rec';rec.setAttribute('aria-label','Venue record');hub.after(rec);
let PORTAL=null,PORTAL_FOR='';
async function loadPortal(id){if(!window.OOLIO_HOSTED){PORTAL=null;return}PORTAL_FOR=id;
  try{const r=await fetch('/api/intake/status?venue='+encodeURIComponent(id),{credentials:'same-origin'});const j=await r.json();if(PORTAL_FOR===id){PORTAL=j.link||null;draw()}}catch(e){}}
function hcOf(o){const h=o.hc||{},iss=Object.entries(h.issues||{}).filter(([,x])=>x&&x.t).map(([k,x])=>Object.assign({id:k},x));
  const open=iss.filter(x=>x.status!=='closed');return{h,iss,open}}
function routing(o){const m=o.menu||{},P=(o.printers||[]),D=(o.devices||[]);
  const known=new Map(P.map(p=>[fold(p.name),p]));
  const cats=(m.cats||[]).map(([c,n,pr])=>({c,n,pr:String(pr||'').split(/\s*,\s*/).filter(Boolean)}));
  const none=cats.filter(c=>!c.pr.length),unknown=[...new Set(cats.flatMap(c=>c.pr).filter(p=>!/^auto/i.test(p)&&!known.has(fold(p))))];
  const used=new Set(cats.flatMap(c=>c.pr.map(fold)));
  const idle=P.filter(p=>p.use!=='Receipts'&&!used.has(fold(p.name))).map(p=>p.name);
  const nofb=P.filter(p=>p.use!=='Receipts'&&!clean(p.fb)).map(p=>p.name);
  const kds=D.filter(d=>/kds/i.test(d.role||''));
  return{cats,P,kds,none,unknown,idle,nofb,known,issues:none.length+unknown.length}}
function draw(){const a=OV.active();if(!a||view()!==''){rec.hidden=true;return}rec.hidden=false;const o=a,m=o.menu,pr=OV.progress(a.id),late=OV.late(a.id);
  const tp=window.OolioTraining&&window.OolioTraining.progress?window.OolioTraining.progress(o):null,hc=hcOf(o),rt=routing(o),devs=o.devices||[],prns=(o.printers||[]).filter(p=>p.use!=='Receipts');
  const card=(cls,icon,title,body,acts)=>'<article class="vr-card '+cls+'"><h3>'+IC(icon)+esc(title)+'</h3>'+body+(acts?'<div class="vr-acts">'+acts+'</div>':'')+'</article>';
  const btn=(a,t,sec)=>'<button type="button"'+(sec?' class="lx-sec"':'')+' data-vr="'+a+'">'+t+'</button>';
  const tag=(t,c)=>'<span class="vr-tag'+(c?' '+c:'')+'">'+t+'</span>';
  const L=[];
  L.push(card('t-converter','file-spreadsheet','Menu',m?'<p><b>'+m.products+'</b> products in <b>'+(m.cats||[]).length+'</b> categories'+(m.modifiers?', '+m.modifiers+' modifiers':'')+'. Saved '+esc(day(m.at))+((o.menuLog||[]).length>1?' · '+o.menuLog.length+' versions':'')+'.</p>'+
      (m.lint?'<p>'+(m.lint.block?tag(plural(m.lint.block,'problem')+' to fix','bad'):tag('Pre-flight passed','ok'))+(m.lint.warn?' '+tag(plural(m.lint.warn,'thing')+' to check','warn'):'')+'</p>':''):'<p class="lx-muted">No menu converted yet.</p>',
    btn('converter',m?'Open converter':'Convert menu',!!m)));
  L.push(card('t-setup','printer','Hardware and routing',(devs.length||prns.length?'<p><b>'+devs.length+'</b> device'+(devs.length===1?'':'s')+' · <b>'+prns.length+'</b> docket printer'+(prns.length===1?'':'s')+' · <b>'+rt.kds.length+'</b> KDS screen'+(rt.kds.length===1?'':'s')+'</p>':'<p class="lx-muted">No devices or printers listed yet.</p>')+
      (m&&prns.length?'<p>'+(rt.issues?tag(plural(rt.none.length+rt.unknown.length,'routing gap'),'warn'):tag('Every category prints somewhere','ok'))+(rt.nofb.length?' '+tag(plural(rt.nofb.length,'printer')+' without a fallback','warn'):'')+'</p>':''),
    btn('routing','Routing map',!m||!prns.length?1:0)+btn('hw','Devices',1)));
  L.push(card('t-setup','list-checks','Checklist','<p><b>'+pr.done+'</b> of '+pr.total+' steps done'+(late?' · '+tag(plural(late,'overdue step'),'bad'):'')+'</p><p class="lx-muted">'+esc(OV.stage(a.id))+(o.golive?' · go-live '+esc(fmtDate(o.golive)):'')+(o.owner?' · '+esc(o.owner):'')+'</p>',btn('setup','Open checklist',1)));
  L.push(card('t-training','presentation','Training',tp&&(tp.done||tp.finished)?'<p><b>'+(tp.done||0)+'</b> of '+(tp.total||0)+' run-sheet steps covered'+(tp.finished?', finished '+esc(day(tp.finished)):'')+'.</p>'+(tp.open?'<p>'+tag(plural(tp.open,'open action item'),'warn')+'</p>':''):
      '<p class="lx-muted">'+(o.training?'Training booked for '+esc(fmtDate(o.training))+'.':'No training session yet.')+'</p>',btn('training','Training session',1)+btn('cheat','Staff cheat sheet',1)));
  const hst=window.OolioHypercare?window.OolioHypercare.state(o):null,hon=hst&&hst.k!=='none'&&hst.k!=='soon';
  L.push(card('t-hypercare','life-buoy','Hypercare',hon||hc.iss.length?'<p>'+(hc.open.length?'<b>'+hc.open.length+'</b> open issue'+(hc.open.length===1?'':'s'):'No open issues')+' · '+plural(hc.iss.length,'issue')+' logged</p>'+
      (hst?'<p class="lx-muted">'+esc(hst.label)+'</p>':''):'<p class="lx-muted">'+(hst&&hst.k==='soon'?esc(hst.label)+'. ':'')+'Starts at go-live. Log issues from the first service on.</p>',btn('hypercare','Open hypercare',1)));
  if(window.OOLIO_HOSTED){const ap=(PORTAL&&PORTAL.approvals)||{},n=['menu','plan','golive'].filter(k=>ap[k]&&ap[k].decision==='approve').length;
    L.push(card('t-venues','send','Venue portal',PORTAL?'<p>'+(PORTAL.live?tag('Link live','ok'):tag(PORTAL.revoked?'Turned off':'Expired','warn'))+' '+(PORTAL.submittedAt?'Answers sent '+esc(day(PORTAL.submittedAt))+'.':'')+(PORTAL.files&&PORTAL.files.length?' '+plural(PORTAL.files.length,'file')+'.':'')+'</p><p>'+n+' of 3 sign-offs'+(['menu','plan','golive'].some(k=>ap[k]&&ap[k].decision==='changes')?' · '+tag('changes asked for','warn'):'')+'</p>':
      '<p class="lx-muted">No portal link yet. The venue tracks progress, uploads files and signs off through it.</p>',btn('portal',PORTAL?'Open portal page':'Make a portal link',1)));}
  L.push(card('t-venue','mail','Emails','<p class="lx-muted">Welcome, data request, go-live reminder and handover, filled in from this venue.</p>',btn('emails','Write an email',1)));
  rec.innerHTML='<h2 class="lx-toolsh">'+IC('book-open')+'Venue record</h2><div class="vr-grid">'+L.join('')+'</div>'+
    '<div class="vr-tl"><div class="vr-tlh"><h2 class="lx-toolsh">'+IC('history')+'Timeline</h2><span class="lx-muted lx-small">Every change to this venue, newest first. Undo puts the old values back.</span></div><ol id="vr-tl" class="vr-tlist" aria-live="polite"><li class="lx-muted">Loading…</li></ol></div>';
  drawTimeline(a.id)}
let TL=[],TLFOR='',TLSEQ=0;
async function drawTimeline(id){const seq=++TLSEQ;const L=await OV.log(id,40);if(seq!==TLSEQ)return;TL=L;TLFOR=id;const el=g('vr-tl');if(!el)return;
  const ids=[...new Set(L.map(e=>e.by).filter(Boolean))];if(OV.names)OV.names(ids);
  el.innerHTML=L.length?L.map(e=>'<li class="vr-ev'+(e.undone?' undone':'')+'"><span class="vr-when" title="'+esc(new Date(e.at).toLocaleString('en-AU'))+'">'+esc(ago(e.at))+'</span>'+
      '<span class="vr-what">'+esc(e.text)+'<small>'+esc([OV.name(e.by)||(e.by?'a teammate':''),e.tool].filter(Boolean).join(' · '))+(e.undone?' · undone':'')+'</small></span>'+
      (e.prev&&!e.undone&&!OV.readOnly?'<button type="button" class="lx-link vr-undo" data-undo="'+esc(e.id)+'">'+IC('undo-2')+'Undo</button>':'')+'</li>').join(''):
    '<li class="lx-muted">Nothing recorded yet. Changes made from now on show here.</li>'}
rec.addEventListener('click',e=>{const u=e.target.closest('[data-undo]');if(u){const ev=TL.find(x=>x.id===u.dataset.undo),a=OV.active();if(!ev||!a)return;
    const newer=TL.filter(x=>x.at>ev.at&&!x.undone&&x.key===ev.key).length;
    if(!confirm('Undo “'+ev.text+'”?'+(newer?'\n\n'+newer+' later change'+(newer>1?'s':'')+' to the same thing will be overwritten too.':'')))return;
    if(OV.undo(a.id,ev))setTimeout(()=>drawTimeline(a.id),400);return}
  const b=e.target.closest('[data-vr]');if(!b)return;const a=OV.active();if(!a)return;const k=b.dataset.vr;
  if(k==='converter'||k==='training'||k==='hypercare')go(k);
  else if(k==='setup'){go('setup');OV.open(a.id)}
  else if(k==='hw'){go('setup');OV.open(a.id);setTimeout(()=>{const s=g('st-prep-hw')||document.querySelector('[id^="st-prep-hw"]');if(s)s.scrollIntoView({behavior:'smooth'})},300)}
  else if(k==='routing')go('routing');
  else if(k==='emails')emails(a);
  else if(k==='cheat'){go('training');setTimeout(()=>{if(window.OolioTraining&&window.OolioTraining.cheatSheet)window.OolioTraining.cheatSheet()},100)}
  else if(k==='portal'){go('setup');OV.open(a.id);setTimeout(()=>{if(window.OolioIntakeOpen)window.OolioIntakeOpen(a.id)},200)}});
window.addEventListener('oolio:log',e=>{const a=OV.active();if(a&&e.detail&&e.detail.id===a.id&&view()===''){clearTimeout(drawTimeline.t);drawTimeline.t=setTimeout(()=>drawTimeline(a.id),700)}});
let last='',lastA='';
function sync(){const a=OV.active(),id=a?a.id:'';if(id!==lastA){lastA=id;PORTAL=null;if(id)loadPortal(id)}
  if(view()!=='')return void(rec.hidden=true);
  const sig=a?JSON.stringify([a.updatedAt,PORTAL&&PORTAL.submittedAt]):'';if(sig===last&&!rec.hidden)return;last=sig;draw()}
OV.on(()=>{last='';sync()});window.addEventListener('hashchange',()=>{last='';sync();drawRouting()});sync();

/* ---------- routing map (#routing) ---------- */
// the view's box (#lx-routing) is in the launcher's page (build_apps.py), so the launcher can show and hide it
const rv=g('lx-routing');
function drawRouting(){if(!rv)return;if(view()!=='routing')return;const el=g('vr-routing'),a=OV.active();
  if(!a){el.innerHTML='<h1>Routing map</h1><p class="vs-sub">Pick a venue at the top first.</p>';return}
  const r=routing(a),m=a.menu;
  if(!m){el.innerHTML='<h1>Routing map: '+esc(a.name)+'</h1><p class="vs-sub">Convert the venue’s menu first. The map uses the categories and printers from the last download.</p><div class="lx-row"><button type="button" data-rt="converter">Open the converter</button></div>';return}
  const pname=p=>/^auto/i.test(p)?'Auto (per item: food to the kitchen, drinks to the bar)':p;
  const kdsFor=p=>{const P=r.known.get(fold(p)),loc=fold((P&&(P._l||P.loc))||'').split('·')[0].trim(),n=fold(p);
    return r.kds.filter(d=>{const dl=fold(d.loc),dn=fold(d.name);return(loc&&(dl===loc||dn.includes(loc)))||dn.includes(n)||(dl&&n.includes(dl))})};
  const byP=new Map();r.cats.forEach(c=>{(c.pr.length?c.pr:['']).forEach(p=>{(byP.get(p)||byP.set(p,[]).get(p)).push(c)})});
  const lanes=[...byP].sort((x,y)=>(x[0]?0:1)-(y[0]?0:1)||x[0].localeCompare(y[0])).map(([p,cs])=>{const P=r.known.get(fold(p)),k=p?kdsFor(p):[],bad=!p||(!/^auto/i.test(p)&&!P);
    return '<li class="vr-lane'+(bad?' bad':'')+'"><div class="vr-cats">'+cs.map(c=>'<span class="vr-chip">'+esc(c.c||'(no category)')+' <small>'+c.n+'</small></span>').join('')+'</div>'+
      '<div class="vr-arrow" aria-hidden="true">'+IC('arrow-right')+'</div>'+
      '<div class="vr-dest"><b>'+IC('printer')+esc(p?pname(p):'No printer')+'</b>'+(P?'<small>'+esc([P.kind,P.loc,P.ip&&P.ip!=='1.1.1.1'?'IP '+P.ip:'',P.fb?'fallback → '+P.fb:'no fallback'].filter(Boolean).join(' · '))+'</small>':
        p&&!/^auto/i.test(p)?'<small class="vr-bad">Not a printer listed for this venue in the Setup Tracker</small>':!p?'<small class="vr-bad">These categories don’t print a docket anywhere</small>':'')+'</div>'+
      '<div class="vr-arrow" aria-hidden="true">'+(k.length?IC('arrow-right'):'')+'</div><div class="vr-dest">'+(k.length?k.map(d=>'<b>'+IC('monitor')+esc(d.name)+'</b><small>'+esc([d.profile,d.loc].filter(Boolean).join(' · '))+'</small>').join(''):p?'<small class="lx-muted">No KDS screen at this printer’s location</small>':'')+'</div></li>'}).join('');
  const prob=[[r.none.length,r.none.length===1?'category with no printer':'categories with no printer','They never reach the kitchen or bar. Set a printer for them in the converter (step 3).',r.none.map(c=>c.c)],
    [r.unknown.length,r.unknown.length===1?'printer in the menu that isn’t listed for the venue':'printers in the menu that aren’t listed for the venue','Add them to the Setup Tracker’s printers, or change the menu’s printer.',r.unknown],
    [r.idle.length,r.idle.length===1?'printer nothing is sent to':'printers nothing is sent to','Fine for a spare or receipt printer; otherwise route a category to it.',r.idle],
    [r.nofb.length,r.nofb.length===1?'printer without a fallback':'printers without a fallback','If one jams, its dockets are lost. Pair it with another printer.',r.nofb]].filter(x=>x[0]);
  el.innerHTML='<h1>Routing map: '+esc(a.name)+'</h1><p class="vs-sub">Where each menu category prints and which KDS screen shows it. From the menu saved '+esc(day(m.at))+' and the printers and devices in the Setup Tracker. KDS screens are matched to printers by location and name.</p>'+
    (prob.length?'<div class="vr-probs">'+prob.map(([n,t,h,l])=>'<details class="vr-prob"><summary><b>'+n+'</b> '+esc(t)+'</summary><p class="lx-muted">'+esc(h)+'</p><p>'+l.map(esc).join(', ')+'</p></details>').join('')+'</div>':'<p class="vr-okline">'+IC('circle-check')+'Every category prints somewhere and every printer has a fallback.</p>')+
    '<div class="vr-lanehead"><span>Menu categories</span><span></span><span>Printer</span><span></span><span>KDS</span></div><ol class="vr-lanes">'+lanes+'</ol>'+
    '<div class="lx-row" style="margin-top:12px"><button type="button" data-rt="converter" class="lx-sec">Change printers in the converter</button><button type="button" data-rt="hw" class="lx-sec">Edit printers and devices</button><button type="button" data-rt="copy" class="lx-sec">'+IC('copy')+'Copy as text</button></div>'}
if(rv)rv.addEventListener('click',async e=>{const b=e.target.closest('[data-rt]');if(!b)return;const a=OV.active(),k=b.dataset.rt;
  if(k==='converter')go('converter');else if(k==='hw'&&a){go('setup');OV.open(a.id)}
  else if(k==='copy'&&a){const r=routing(a),t=['Routing map: '+a.name,''].concat(r.cats.map(c=>c.c+' ('+c.n+') → '+(c.pr.join(', ')||'NO PRINTER'))).join('\n');try{await navigator.clipboard.writeText(t);b.lastChild.textContent='Copied'}catch(x){prompt('Copy:',t)}}});
OV.on(()=>drawRouting());

/* ---------- email templates ---------- */
const first=s=>clean(s).split(/\s+/)[0]||'there';
function fields(a){const o=OV.get(a.id)||a,c=o.contact||{},me=(window.MH_ME&&window.MH_ME.name)||'';
  const cname=OV.field(a.id,'biz-contact','name')||c.name||'',cmail=OV.field(a.id,'biz-contact','email')||c.email||'';
  return{venue:o.name||'your venue',contact:cname,first:first(cname),email:cmail,golive:o.golive?fmtDate(o.golive):'[go-live date]',training:o.training?fmtDate(o.training):'[training date]',
    me:me||'[your name]',owner:o.owner||me||'[your name]',portal:PORTAL&&PORTAL.live?PORTAL.url:'[portal link]',products:o.menu?o.menu.products:'',
    open:(OV.steps?OV.steps(a.id):[]).filter(s=>!s.s&&s.phase==='pre').slice(0,8).map(s=>s.t)}}
const TPL=[
  {k:'welcome',t:'Welcome',s:f=>'Welcome to Oolio, '+f.venue,b:f=>'Hi '+f.first+',\n\nWelcome to Oolio! I’m '+f.me+' and I’ll be looking after '+f.venue+'’s setup through to go-live'+(f.golive.startsWith('[')?'':' on '+f.golive)+'.\n\nHere’s how it will run:\n1. You send us your menus, logo, floor plan and staff list (link below).\n2. We build your menu, devices and printers in Oolio One.\n3. We book a training session with your team'+(f.training.startsWith('[')?'':' ('+f.training+')')+'.\n4. You go live, and we stay close for the first two weeks.\n\nYou can upload files, see where we’re up to and approve the menu here:\n'+f.portal+'\n\nAny questions, just reply to this email.\n\nThanks,\n'+f.me},
  {k:'data',t:'Data request',s:f=>'What we need for '+f.venue+'’s setup',b:f=>'Hi '+f.first+',\n\nTo build '+f.venue+' in Oolio we still need:\n- Your current menus (PDF, photos or a POS export) with prices and sizes\n- Your logo\n- A floor plan or table layout\n- Your staff list (name and role for each person)\n- Which printers and screens go where\n\nYou can upload everything here; it saves as you go:\n'+f.portal+'\n\nIf it’s easier, reply with attachments instead.\n\nThanks,\n'+f.me},
  {k:'golive',t:'Go-live reminder',s:f=>f.venue+' goes live on '+f.golive,b:f=>'Hi '+f.first+',\n\nA reminder that '+f.venue+' goes live on Oolio on '+f.golive+'.\n\nBefore then, please:\n- Check the menu and prices in the portal and approve them: '+f.portal+'\n- Make sure every staff member has their login\n- Have the devices and printers powered on and connected to the network\n'+(f.open.length?'\nStill open on our side:\n'+f.open.map(x=>'- '+x).join('\n')+'\n':'')+'\nWe’ll be on hand on the day. Reply here or call if anything comes up.\n\nThanks,\n'+f.me},
  {k:'handover',t:'Handover to support',s:f=>f.venue+': setup complete, handing over to Oolio Support',b:f=>'Hi '+f.first+',\n\nThanks for a smooth setup. '+f.venue+' is now live'+(f.products?' with '+f.products+' products':'')+', and our two weeks of hypercare are done.\n\nFrom here, Oolio Support looks after you day to day:\n- Help guides: https://help.oolio.com\n- Support: through the help centre or the number in your welcome pack\n\nIt’s been great working with you and the team.\n\nThanks,\n'+f.me}];
function emails(a){const d=g('lx-dlg'),f=fields(a);let cur=TPL[0];
  const fill=()=>{g('vr-es').value=cur.s(f);g('vr-eb').value=cur.b(f)};
  d.innerHTML='<form method="dialog" class="lx-form vr-mail"><h2>'+IC('mail')+'Email for '+esc(f.venue)+'</h2>'+
    '<div class="vr-tabs" role="tablist">'+TPL.map((t,i)=>'<button type="button" role="tab" class="lx-sec" aria-selected="'+(i?'false':'true')+'" data-t="'+t.k+'">'+esc(t.t)+'</button>').join('')+'</div>'+
    '<label>To<input id="vr-et" value="'+esc(f.email)+'" placeholder="venue contact’s email"></label><label>Subject<input id="vr-es"></label><label>Message<textarea id="vr-eb" rows="14"></textarea></label>'+
    '<p class="lx-cn">Gaps in [brackets] weren’t found on the venue. Fill them before sending. Nothing is sent from Menu Hauler: copy it, or open it in your mail app.</p>'+
    '<div class="lx-row"><button type="button" id="vr-ecopy">'+IC('copy')+'Copy</button><button type="button" id="vr-eopen" class="lx-sec">'+IC('send')+'Open in mail app</button><button value="cancel" class="lx-sec">Close</button></div></form>';
  d.classList.add('vr-wide');d.addEventListener('close',()=>d.classList.remove('vr-wide'),{once:true});d.showModal();fill();
  d.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{cur=TPL.find(t=>t.k===b.dataset.t);d.querySelectorAll('[data-t]').forEach(x=>x.setAttribute('aria-selected',x===b?'true':'false'));fill()});
  g('vr-ecopy').onclick=async()=>{const t='Subject: '+g('vr-es').value+'\n\n'+g('vr-eb').value;try{await navigator.clipboard.writeText(t);g('vr-ecopy').lastChild.textContent='Copied'}catch(e){prompt('Copy:',t)}};
  g('vr-eopen').onclick=()=>{const u='mailto:'+encodeURIComponent(g('vr-et').value.trim())+'?subject='+encodeURIComponent(g('vr-es').value)+'&body='+encodeURIComponent(g('vr-eb').value);if(u.length>1900){alert('This email is too long to open in the mail app. Use Copy instead.');return}location.href=u}}
window.mhEmails=()=>{const a=OV.active();if(a)emails(a)};
})();
