/* Menu Hauler: Venues tab. Finds a venue the team has already saved (the Setup Tracker's shared records) by
   name, organisation, suburb or address, ABN or legal name, owner, phone or email, and jumps straight to it.
   Filters: stage, mine only, go-live soon, overdue steps. Each result shows where the venue is up to and opens it
   in any tool. Nothing here costs anything: it only reads the records already loaded. Venues not found can be
   looked up (Restaurant Lookup) or added. build_apps.py puts this after venue-link.js. */
(()=>{
const g=id=>document.getElementById(id),OV=window.OolioVenues,root=g('vs-root');if(!OV||!root)return;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const fold=s=>clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ');
const digits=s=>String(s||'').replace(/\D/g,'');
const IC=n=>window.mhIcon?window.mhIcon(n):'';
const go=v=>{if(location.hash.slice(1)===v)window.dispatchEvent(new HashChangeEvent('hashchange'));else location.hash=v};
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const daysTo=d=>Math.round((new Date(d+'T00:00')-new Date(today()+'T00:00'))/864e5);
const day=t=>t?new Date(t).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:new Date(t).getFullYear()===new Date().getFullYear()?undefined:'numeric'}):'';
const fmtDate=d=>d?new Date(d+'T00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'';
const F=(id,s,k)=>OV.field?clean(OV.field(id,s,k)):'';
const STG=[['','Any stage'],['pre','Pre-config'],['ready','Ready for training'],['trained','Training done'],['follow','Follow-ups'],['done','Complete']];
const KEY='vs.view';let V={q:'',stage:'',mine:false,when:'',sort:'updated'};
try{Object.assign(V,JSON.parse(localStorage.getItem(KEY)||'{}'));V.q=''}catch(e){}
const keep=()=>{try{const{q,...rest}=V;localStorage.setItem(KEY,JSON.stringify(rest))}catch(e){}};

root.innerHTML='<h1>Find a venue</h1>'+
  '<p class="vs-sub">Search every venue the team has saved: by name, organisation, suburb, ABN, legal name, owner, phone or email. Pick one to work on it in any tool.</p>'+
  '<div class="vs-bar"><label class="vs-q">'+IC('search')+'<input id="vs-q" type="search" placeholder="Search venues (press /)" autocomplete="off" aria-label="Search venues"></label>'+
  '<select id="vs-stage" aria-label="Stage">'+STG.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select>'+
  '<select id="vs-when" aria-label="Go-live and overdue"><option value="">Any date</option><option value="soon">Going live in the next 14 days</option><option value="late">Has overdue steps</option><option value="nodate">No go-live date</option></select>'+
  '<select id="vs-sort" aria-label="Sort"><option value="updated">Recently changed</option><option value="name">Name A–Z</option><option value="golive">Go-live date</option><option value="progress">Least done first</option></select>'+
  '<label class="vs-ck"><input type="checkbox" id="vs-mine"> Mine only</label></div>'+
  '<div id="vs-count" class="vs-count" aria-live="polite"></div><ul id="vs-list" class="vs-list"></ul><div id="vs-none"></div>';
const q=g('vs-q');g('vs-stage').value=V.stage;g('vs-when').value=V.when;g('vs-sort').value=V.sort;g('vs-mine').checked=!!V.mine;

// what each venue can be found by (rebuilt when the records change)
let IDX=[];
function index(){const me=OV.me&&OV.me(),G=OV.groups?OV.groups():[];
  IDX=OV.list().map(o=>{const grp=G.find(x=>x.venues.includes(o.id)),biz=(grp&&grp.biz)||{};
    const abn=F(o.id,'biz-abn','abn')||biz.abn||'',legal=F(o.id,'biz-abn','legal')||biz.legal||'',addr=OV.address(o.id)||'',
      phone=F(o.id,'biz-contact','phone'),email=F(o.id,'biz-contact','email'),site=OV.website(o.id)||'';
    const p=OV.progress(o.id)||{done:0,total:0,pct:0};
    const text=fold([o.name,grp&&grp.name,addr,legal,o.owner,email,site,o.contact,(o.lookupQ||{}).loc].join(' | '));
    return{o,id:o.id,grp,abn,legal,addr,phone,email,site,p,text,num:digits(abn)+' '+digits(phone),
      late:OV.late?OV.late(o.id):0,mine:OV.isMine?OV.isMine(o.id):!!me&&o.ownerId===me,stage:o.stage||'pre'}})}
function score(r,words){let s=0;const nm=fold(r.o.name);
  for(const w of words){if(!r.text.includes(w))return-1;s+=nm.startsWith(w)?3:(' '+nm).includes(' '+w)?2:1}
  return s}
function results(){const words=fold(V.q).split(/\s+/).filter(w=>w&&!/^\d+$/.test(w));
  const numQ=/^[\d\s()+-]{3,}$/.test(V.q.trim())?digits(V.q):'';
  let L=IDX.map(r=>({r,s:numQ?(r.num.includes(numQ)?5:-1):score(r,words)})).filter(x=>x.s>=0).map(x=>Object.assign(x.r,{s:x.s}));
  if(V.stage)L=L.filter(r=>r.stage===V.stage);
  if(V.mine)L=L.filter(r=>r.mine);
  if(V.when==='soon')L=L.filter(r=>r.o.golive&&daysTo(r.o.golive)>=0&&daysTo(r.o.golive)<=14);
  if(V.when==='late')L=L.filter(r=>r.late>0);
  if(V.when==='nodate')L=L.filter(r=>!r.o.golive);
  const by={updated:(a,b)=>(b.o.updatedAt||0)-(a.o.updatedAt||0),name:(a,b)=>(a.o.name||'').localeCompare(b.o.name||''),
    golive:(a,b)=>(a.o.golive||'9999').localeCompare(b.o.golive||'9999'),progress:(a,b)=>a.p.pct-b.p.pct}[V.sort]||(()=>0);
  return L.sort((a,b)=>(words.length||numQ?b.s-a.s:0)||by(a,b))}
function mark(s){const ws=fold(V.q).split(/\s+/).filter(w=>w.length>1);let h=esc(s);if(!ws.length)return h;
  ws.forEach(w=>{h=h.replace(new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>')});return h}
function card(r){const o=r.o,a=OV.activeId===o.id,stg=OV.stage(o.id),gl=o.golive,dt=gl?daysTo(gl):null,m=o.menu,ph=o.photos;
  const facts=[r.addr&&IC('map-pin')+'<span>'+mark(r.addr)+'</span>',
    r.abn&&'<span>ABN '+mark(r.abn)+(r.legal&&fold(r.legal)!==fold(o.name)?' · '+mark(r.legal):'')+'</span>',
    o.owner&&IC('user')+'<span>'+mark(o.owner)+'</span>',
    (r.phone||r.email)&&'<span>'+[r.phone&&esc(r.phone),r.email&&mark(r.email)].filter(Boolean).join(' · ')+'</span>'].filter(Boolean);
  const tags=['<span class="vs-tag s-'+esc(r.stage)+'">'+esc(stg)+'</span>',
    gl&&'<span class="vs-tag'+(dt<0&&o.stage!=='done'?' bad':dt<=14&&o.stage!=='done'?' warn':'')+'">'+IC('clock')+'Go-live '+esc(fmtDate(gl))+(o.stage!=='done'&&dt!=null?(dt===0?' (today)':dt>0?' (in '+dt+' day'+(dt===1?'':'s')+')':' ('+(-dt)+' day'+(dt===-1?'':'s')+' ago)'):'')+'</span>',
    r.late&&'<span class="vs-tag bad">'+r.late+' overdue step'+(r.late===1?'':'s')+'</span>',
    '<span class="vs-tag">'+(m?esc((m.products||0)+' products'):'No menu yet')+'</span>',
    ph&&ph.saved?'<span class="vs-tag">'+esc(ph.saved)+' photos</span>':'',
    o.lookup?'':'<span class="vs-tag">Not looked up</span>'].filter(Boolean);
  return '<li class="vs-item'+(a?' on':'')+'"><div class="vs-head"><button type="button" class="vs-name" data-a="open" data-id="'+esc(o.id)+'">'+mark(o.name||'Untitled')+'</button>'+
    (r.grp&&fold(r.grp.name)!==fold(o.name)?'<span class="vs-org">'+mark(r.grp.name)+'</span>':'')+(a?'<span class="vs-tag on">Working on it</span>':'')+
    '<span class="vs-prog" title="'+r.p.done+' of '+r.p.total+' checklist steps done"><span class="vs-bar2"><i style="width:'+r.p.pct+'%"></i></span>'+r.p.pct+'%</span></div>'+
    (facts.length?'<div class="vs-facts">'+facts.join('')+'</div>':'')+'<div class="vs-tags">'+tags.join('')+'</div>'+
    '<div class="vs-acts"><button type="button" data-a="open" data-id="'+esc(o.id)+'">Work on this venue</button>'+
    '<button type="button" class="lx-sec" data-a="setup" data-id="'+esc(o.id)+'">'+IC('list-checks')+'Checklist</button>'+
    '<button type="button" class="lx-sec" data-a="converter" data-id="'+esc(o.id)+'">'+IC('file-spreadsheet')+'Menu</button>'+
    '<button type="button" class="lx-sec" data-a="venue" data-id="'+esc(o.id)+'">'+IC('store')+'Lookup</button>'+
    (r.site?'<a class="lx-sec vs-site" href="'+esc(/^https?:\/\//.test(r.site)?r.site:'https://'+r.site)+'" target="_blank" rel="noopener">'+IC('external-link')+'Website</a>':'')+'</div></li>'}
let SHOWN=[];
function draw(){if(!OV.ready){g('vs-count').textContent='Loading the team’s venues…';g('vs-list').innerHTML='';g('vs-none').innerHTML='';return}
  const L=results();SHOWN=L;const n=IDX.length,filtered=V.q||V.stage||V.mine||V.when;
  g('vs-count').textContent=!n?'':filtered?L.length+' of '+n+' venue'+(n===1?'':'s')+' match':n+' venue'+(n===1?'':'s')+' saved';
  g('vs-list').innerHTML=L.slice(0,200).map(card).join('')+(L.length>200?'<li class="vs-more">Showing the first 200. Search to narrow it down.</li>':'');
  const name=clean(V.q);
  g('vs-none').innerHTML=L.length?'':'<div class="vs-empty"><p>'+(!n?'No venues saved yet.':'No saved venue matches'+(name?' “'+esc(name)+'”':' these filters')+'.')+'</p>'+
    '<div class="lx-row">'+(OV.readOnly?'':'<button type="button" data-a="new">'+IC('plus')+'Add '+(name&&!/^\d/.test(name)?'“'+esc(name)+'”':'a venue')+'</button>')+
    (name&&!/^\d/.test(name)?'<button type="button" class="lx-sec" data-a="look">'+IC('store')+'Look up “'+esc(name)+'”</button>':'')+
    (filtered?'<button type="button" class="lx-sec" data-a="clear">Clear search and filters</button>':'')+'</div></div>'}
function act(a,id){
  if(a==='open'){OV.setActive(id);go('');return}
  if(a==='setup'){OV.setActive(id);go('setup');setTimeout(()=>OV.open(id),0);return}
  if(a==='converter'||a==='venue'){OV.setActive(id);go(a);return}
  if(a==='new'){const name=/^\d/.test(clean(V.q))?'':clean(V.q);if(window.mhNewVenue)window.mhNewVenue({name});return}
  if(a==='look'){go('venue');window.dispatchEvent(new CustomEvent('oolio:lookup-fill',{detail:{name:clean(V.q),loc:'',force:true,clear:true}}));return}
  if(a==='clear'){V={q:'',stage:'',mine:false,when:'',sort:V.sort};q.value='';g('vs-stage').value='';g('vs-when').value='';g('vs-mine').checked=false;keep();draw()}}
root.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(!b||!root.contains(b))return;act(b.dataset.a,b.dataset.id)});
let tm;q.addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(()=>{V.q=q.value;draw()},120)});
// Enter opens the top result
q.addEventListener('keydown',e=>{if(e.key==='Enter'&&SHOWN.length){e.preventDefault();act('open',SHOWN[0].id)}});
[['vs-stage','stage'],['vs-when','when'],['vs-sort','sort']].forEach(([id,k])=>g(id).addEventListener('change',()=>{V[k]=g(id).value;keep();draw()}));
g('vs-mine').addEventListener('change',()=>{V.mine=g('vs-mine').checked;keep();draw()});
// "/" anywhere jumps to the search (unless typing in a box)
document.addEventListener('keydown',e=>{if(e.key!=='/'||e.ctrlKey||e.metaKey||e.altKey)return;const t=e.target;if(t&&(/^(input|textarea|select)$/i.test(t.tagName)||t.isContentEditable))return;
  if(document.querySelector('dialog[open]'))return;e.preventDefault();if(location.hash.slice(1)!=='venues')go('venues');setTimeout(()=>{q.focus();q.select()},30)});
let dq=false;const redraw=()=>{if(dq)return;dq=true;requestAnimationFrame(()=>{dq=false;index();if(!g('lx-vs')||!g('lx-vs').hidden)draw()})};
OV.on(redraw);
window.addEventListener('hashchange',()=>{if(location.hash.slice(1)==='venues'){index();draw();setTimeout(()=>q.focus(),30)}});
index();draw();
})();
