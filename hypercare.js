/* Menu Hauler: Hypercare. The first days after a venue goes live (14 by default, changeable per venue): the team logs
   each issue (what it's about, how bad), closes it with what fixed it and its root cause, and the tab shows which
   setup steps keep causing problems across all venues, so they can be fixed upstream (converter, routing, hardware,
   training). Team only: venues don't log issues here. Saved on the venue record as o.hc
   {start:'YYYY-MM-DD', days, ended, issues:{<id>:{t, area, sev, status, note, cause, fix, by, at, closedAt, closedBy}}}.
   Reads and writes through window.OolioVenues; build_apps.py puts it after venue-link.js. Ids and classes start hc-. */
(()=>{
const g=id=>document.getElementById(id),OV=window.OolioVenues,root=g('hc-root');if(!OV||!root)return;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const IC=n=>window.mhIcon?window.mhIcon(n):'';
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const addDays=(d,n)=>{const x=new Date(d+'T00:00');x.setDate(x.getDate()+n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
const daysBetween=(a,b)=>Math.round((new Date(b+'T00:00')-new Date(a+'T00:00'))/864e5);
const fmt=d=>d?new Date(d+'T00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'}):'';
const when=t=>t?new Date(t).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';
const DAYS=14;
const AREAS=[['menu','Menu or prices'],['print','Printers or KDS'],['pay','Payments or EFTPOS'],['device','Devices or network'],['staff','Staff or training'],['online','Online ordering or delivery'],['reports','Reports or end of day'],['other','Something else']];
const SEV=[['blocker','Stops service'],['high','Slows service'],['normal','Annoying'],['low','Cosmetic']];
// root causes, and where each is fixed upstream so the next venue doesn't hit it
const CAUSES=[['menu','Menu built wrong (item, price, size, modifier)','Menu Converter: the pre-flight check and linter','converter'],
  ['routing','Printer or KDS routing set up wrong','Routing map before go-live','routing'],
  ['hardware','Hardware or network','Setup Tracker: hardware and network steps','setup'],
  ['config','Oolio One setting missed','Setup Tracker: the checklist step it belongs to','setup'],
  ['training','Staff weren’t shown how','Training Session run sheet','training'],
  ['request','Venue asked for a change','Nothing upstream: a new request',''],
  ['bug','Oolio product fault','Raise with product; nothing upstream',''],
  ['third','Third party (bank, delivery app, ISP)','Nothing upstream',''],
  ['unknown','Not sure','','']];
const NAME=(L,k)=>(L.find(x=>x[0]===k)||[k,k])[1];
const hcOf=o=>o&&o.hc||{};
const startOf=o=>hcOf(o).start||o.golive||'';
const issues=o=>Object.entries(hcOf(o).issues||{}).filter(([,x])=>x&&x.t).map(([id,x])=>Object.assign({id},x)).sort((a,b)=>(a.status==='closed')-(b.status==='closed')||SEV.findIndex(s=>s[0]===a.sev)-SEV.findIndex(s=>s[0]===b.sev)||b.at-a.at);
function state(o){const s=startOf(o),h=hcOf(o),n=h.days||DAYS,t=today(),open=issues(o).filter(x=>x.status!=='closed').length;
  if(h.ended)return{k:'ended',s,n,open,label:'Handed over '+fmt(h.ended)};
  if(!s)return{k:'none',s,n,open,label:'No go-live date'};
  const d=daysBetween(s,t);if(d<0)return{k:'soon',s,n,open,label:'Starts '+fmt(s)+' (in '+(-d)+' day'+(d===-1?'':'s')+')'};
  if(d<n)return{k:'on',s,n,open,day:d+1,label:'Day '+(d+1)+' of '+n};
  return{k:'over',s,n,open,label:'Window ended '+fmt(addDays(s,n))+(open?', issues still open':'')}}
let SEL='',SHOWALL=false;
function venues(){return OV.list().map(o=>({o,st:state(o)})).filter(x=>x.st.k==='on'||x.st.open||(x.st.k==='soon'&&daysBetween(today(),x.st.s)<=7)||(x.st.k==='over'&&!hcOf(x.o).ended&&daysBetween(addDays(x.st.s,x.st.n),today())<=14))
  .sort((a,b)=>b.st.open-a.st.open||(a.st.s||'').localeCompare(b.st.s||''))}
function draw(){if(location.hash.slice(1)!=='hypercare')return;const a=OV.active(),L=venues();
  if(!SEL||!OV.get(SEL))SEL=a?a.id:(L[0]?L[0].o.id:'');const o=OV.get(SEL);
  root.innerHTML='<h1>Hypercare</h1><p class="vs-sub">The first '+DAYS+' days after go-live. Log every issue the venue raises, close it with what fixed it and why it happened, and see which setup steps keep causing problems.</p>'+
    '<div class="hc-layout"><aside class="hc-side"><h2>In hypercare</h2>'+(L.length?'<ul class="hc-vlist">'+L.map(x=>'<li><button type="button" data-v="'+esc(x.o.id)+'"'+(x.o.id===SEL?' aria-current="true"':'')+'><b>'+esc(x.o.name||'Untitled')+'</b><span>'+esc(x.st.label)+(x.st.open?' · <em>'+x.st.open+' open</em>':'')+'</span></button></li>').join('')+'</ul>':
      '<p class="lx-muted lx-small">No venue is in its first '+DAYS+' days. Venues show here a week before go-live.</p>')+
    (a&&!L.some(x=>x.o.id===a.id)?'<p class="lx-small"><button type="button" class="lx-link" data-v="'+esc(a.id)+'">Show '+esc(a.name)+'</button></p>':'')+'</aside>'+
    '<section class="hc-main">'+(o?venueHtml(o):'<p class="lx-muted">Pick a venue at the top or from the list.</p>')+'</section></div>'+insights()}
function venueHtml(o){const st=state(o),L=issues(o),ro=OV.readOnly,open=L.filter(x=>x.status!=='closed');
  // with open issues, show when the venue last heard from us: long silences are what turn issues into escalations
  const cu=o.cu&&o.cu.at,cd=cu?Math.floor((Date.now()-cu)/864e5):null,cuLine=open.length?'<p class="lx-small hc-cu'+(cd==null||cd>=2?' late':'')+'">'+(cu?'Customer last updated '+(cd===0?'today':cd===1?'yesterday':cd+' days ago'):'No customer update recorded')+(cd==null||cd>=2?': they’re waiting on us.':'.')+(ro?'':' <button type="button" class="lx-link" data-a="cu">I’ve updated them today</button>')+'</p>':'';
  return '<div class="hc-vhead"><div><h2>'+esc(o.name||'Untitled')+'</h2><p class="lx-muted">'+esc(st.label)+(st.s?' · went live '+esc(fmt(st.s)):'')+'</p>'+cuLine+'</div>'+
    (st.k==='on'?'<div class="hc-days" aria-label="'+esc(st.label)+'">'+Array.from({length:st.n},(_,i)=>'<i class="'+(i<st.day?'on':'')+'"></i>').join('')+'</div>':'')+'</div>'+
    (ro?'':'<form class="hc-add" id="hc-add"><label class="hc-t">What happened<input id="hc-t" required maxlength="200" placeholder="e.g. Pizza dockets printing at the bar"></label>'+
      '<label>About<select id="hc-area">'+AREAS.map(([k,t])=>'<option value="'+k+'">'+esc(t)+'</option>').join('')+'</select></label>'+
      '<label>How bad<select id="hc-sev">'+SEV.map(([k,t])=>'<option value="'+k+'"'+(k==='normal'?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>'+
      '<button type="submit">'+IC('plus')+'Log issue</button></form>')+
    (L.length?'<ul class="hc-list">'+L.map(x=>issueHtml(x,ro)).join('')+'</ul>':'<p class="lx-muted">No issues logged'+(st.k==='soon'?' yet. Hypercare starts at go-live.':'. Log the first one above when the venue calls.')+'</p>')+
    (ro?'':'<div class="lx-row hc-foot">'+(st.k==='none'?'<label class="lx-small">Hypercare starts <input type="date" id="hc-start" value=""></label>':'<label class="lx-small">Starts <input type="date" id="hc-start" value="'+esc(st.s)+'"></label><label class="lx-small">for <input type="number" id="hc-days" min="1" max="90" value="'+st.n+'" style="width:4.5em"> days</label>')+
      (hcOf(o).ended?'<button type="button" class="lx-sec" data-a="reopen">Reopen hypercare</button>':'<button type="button" class="lx-sec" data-a="end"'+(open.length?' title="'+open.length+' issue'+(open.length===1?' is':'s are')+' still open"':'')+'>'+IC('send')+'End and hand over to support</button>')+'</div>')}
function issueHtml(x,ro){const c=x.status==='closed',cz=CAUSES.find(z=>z[0]===x.cause);
  return '<li class="hc-is sev-'+esc(x.sev||'normal')+(c?' closed':'')+'"><div class="hc-ih"><span class="hc-sev">'+esc(NAME(SEV,x.sev||'normal'))+'</span><b>'+esc(x.t)+'</b><span class="lx-muted lx-small">'+esc(NAME(AREAS,x.area||'other'))+' · '+esc(when(x.at))+(x.by?' · '+esc(OV.name(x.by)||'a teammate'):'')+'</span></div>'+
    (x.note?'<p class="lx-small">'+esc(x.note)+'</p>':'')+
    (c?'<p class="lx-small hc-fix">'+IC('circle-check')+'<span><b>Fixed '+esc(when(x.closedAt))+':</b> '+esc(x.fix||'(no note)')+(cz?' · Cause: '+esc(cz[1])+(cz[2]?' → fix upstream in '+esc(cz[2]):''):'')+'</span></p>'+(ro?'':'<button type="button" class="lx-link lx-small" data-a="reopenIssue" data-i="'+esc(x.id)+'">Reopen</button>'):
      ro?'':'<details class="hc-close"><summary>Close this issue</summary><div class="hc-cf"><label>What fixed it<input data-f="fix" maxlength="300"></label><label>Why it happened<select data-f="cause">'+CAUSES.map(([k,t])=>'<option value="'+k+'">'+esc(t)+'</option>').join('')+'</select></label>'+
        '<button type="button" data-a="close" data-i="'+esc(x.id)+'">Close issue</button><button type="button" class="lx-link lx-bad lx-small" data-a="del" data-i="'+esc(x.id)+'">Delete</button></div></details>')+'</li>'}
// across every venue: what keeps going wrong, and where to fix it
function insights(){const all=[];OV.list().forEach(o=>issues(o).forEach(x=>all.push(Object.assign({venue:o.name},x))));
  const since=Date.now()-120*864e5,L=all.filter(x=>x.at>since);if(!L.length)return'';
  const by=(k,list)=>{const m=new Map();list.forEach(x=>m.set(x[k]||'unknown',(m.get(x[k]||'unknown')||0)+1));return[...m].sort((a,b)=>b[1]-a[1])};
  const closed=L.filter(x=>x.status==='closed'),causes=by('cause',closed),areas=by('area',L),max=Math.max(...causes.map(c=>c[1]),1),venuesN=new Set(L.map(x=>x.venue)).size;
  const hrs=closed.filter(x=>x.closedAt).map(x=>(x.closedAt-x.at)/36e5).sort((a,b)=>a-b),med=hrs.length?hrs[hrs.length>>1]:null;
  return '<section class="hc-ins"><h2>'+IC('chart-column')+'What keeps going wrong <span class="lx-muted lx-small">last 120 days · '+L.length+' issue'+(L.length===1?'':'s')+' at '+venuesN+' venue'+(venuesN===1?'':'s')+(med!=null?' · half fixed within '+(med<1?Math.round(med*60)+' min':Math.round(med)+' h'):'')+'</span></h2>'+
    '<div class="hc-insg"><div><h3>Root causes (closed issues)</h3>'+(causes.length?'<ul class="hc-bars">'+causes.map(([k,n])=>{const z=CAUSES.find(c=>c[0]===k)||[k,k,'',''];
      return '<li><span>'+esc(z[1])+'</span><i style="--w:'+Math.round(n/max*100)+'%"></i><b>'+n+'</b>'+(z[2]?'<small>Fix upstream: '+(z[3]?'<button type="button" class="lx-link" data-go="'+z[3]+'">'+esc(z[2])+'</button>':esc(z[2]))+'</small>':'')+'</li>'}).join('')+'</ul>':'<p class="lx-muted lx-small">Close issues with a cause to see this.</p>')+'</div>'+
    '<div><h3>What issues are about</h3><ul class="hc-bars">'+areas.map(([k,n])=>'<li><span>'+esc(NAME(AREAS,k))+'</span><i style="--w:'+Math.round(n/Math.max(...areas.map(a=>a[1]))*100)+'%"></i><b>'+n+'</b></li>').join('')+'</ul></div></div></section>'}
function patch(id,p,text){OV.save(id,{hc:p},{text})}
root.addEventListener('submit',e=>{if(e.target.id!=='hc-add')return;e.preventDefault();const o=OV.get(SEL);if(!o)return;const t=clean(g('hc-t').value);if(!t)return;
  const iid='i'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),me=OV.me()||'';
  const p={issues:{[iid]:{t,area:g('hc-area').value,sev:g('hc-sev').value,status:'open',by:me,at:Date.now()}}};if(!hcOf(o).start&&o.golive)p.start=o.golive;
  patch(o.id,p,'Hypercare: logged “'+t+'”');g('hc-t').value=''});
root.addEventListener('click',e=>{const v=e.target.closest('[data-v]');if(v){SEL=v.dataset.v;OV.setActive(SEL);draw();return}
  const b=e.target.closest('[data-a]');if(!b)return;const o=OV.get(SEL);if(!o)return;const a=b.dataset.a,iid=b.dataset.i,x=iid&&(hcOf(o).issues||{})[iid];
  if(a==='close'&&x){const box=b.closest('.hc-cf'),fix=clean(box.querySelector('[data-f="fix"]').value),cause=box.querySelector('[data-f="cause"]').value;
    patch(o.id,{issues:{[iid]:{status:'closed',fix,cause,closedAt:Date.now(),closedBy:OV.me()||''}}},'Hypercare: closed “'+x.t+'”')}
  else if(a==='reopenIssue'&&x)patch(o.id,{issues:{[iid]:{status:'open',closedAt:null}}},'Hypercare: reopened “'+x.t+'”');
  else if(a==='del'&&x){if(confirm('Delete “'+x.t+'”? Use this for issues logged by mistake; close real ones instead.'))patch(o.id,{issues:{[iid]:{t:'',deleted:Date.now()}}},'Hypercare: deleted “'+x.t+'”')}
  else if(a==='cu'){if(OV.markUpdated)OV.markUpdated(o.id);draw()}
  else if(a==='end'){const n=issues(o).filter(z=>z.status!=='closed').length;if(n&&!confirm(n+' issue'+(n===1?' is':'s are')+' still open. End hypercare anyway?'))return;
    OV.save(o.id,{hc:{ended:today()},stage:'done'},{text:'Hypercare ended; handed over to support'});if(window.mhEmails&&confirm('Write the handover email now?'))setTimeout(()=>{if(OV.activeId!==o.id)OV.setActive(o.id);window.mhEmails()},50)}
  else if(a==='reopen')patch(o.id,{ended:null},'Hypercare reopened')});
root.addEventListener('change',e=>{const o=OV.get(SEL);if(!o)return;
  if(e.target.id==='hc-start'&&e.target.value)patch(o.id,{start:e.target.value},'Hypercare start set to '+e.target.value);
  if(e.target.id==='hc-days'){const n=Math.max(1,Math.min(90,parseInt(e.target.value,10)||DAYS));patch(o.id,{days:n},'Hypercare window set to '+n+' days')}});
OV.on(()=>{if(document.activeElement&&root.contains(document.activeElement)&&/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;draw()});
window.addEventListener('hashchange',draw);draw();
// for the metrics view and the venue record
window.OolioHypercare={issues,state,AREAS,CAUSES,SEV};
})();
