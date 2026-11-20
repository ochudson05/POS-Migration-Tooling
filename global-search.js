/* Menu Hauler: search everything from the app bar (the search button, or Ctrl+K / Cmd+K anywhere).
   Finds tools, venues (name, organisation, suburb, owner), menu items from each venue's last converted menu,
   help.oolio.com guides (baked into the Setup Tracker), checklist steps, and, for people with the knowledge graph,
   vault note titles (/api/kg/index: paths only, no note text). Free: it only reads what is already loaded,
   plus one small index request per page load for the vault. Ids and classes start gs-. */
(()=>{
const g=id=>document.getElementById(id),OV=window.OolioVenues;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/\s+/g,' ').trim();
const IC=n=>window.mhIcon?window.mhIcon(n):'';
const acts=document.querySelector('.lx-acts');if(!acts)return;
const btn=document.createElement('button');btn.type='button';btn.className='lx-ib gs-open';btn.id='gs-open';btn.setAttribute('aria-label','Search everything (Ctrl+K)');btn.title='Search everything (Ctrl+K)';btn.innerHTML=IC('search');
acts.prepend(btn);
const dlg=document.createElement('dialog');dlg.className='gs-dlg';dlg.setAttribute('aria-label','Search everything');
dlg.innerHTML='<div class="gs-box"><label class="gs-q">'+IC('search')+'<input id="gs-q" type="search" placeholder="Search venues, menu items, guides, tools…" autocomplete="off" aria-controls="gs-list" aria-autocomplete="list"><kbd>Esc</kbd></label>'+
  '<ul id="gs-list" class="gs-list" role="listbox"></ul><p class="gs-foot"><span>↑↓ to move · Enter to open</span><span id="gs-n"></span></p></div>';
document.body.append(dlg);
const q=g('gs-q'),list=g('gs-list');let R=[],SEL=0,VAULT=null;
const EXTRA=[{k:'hypercare',n:'Hypercare',i:'life-buoy'},{k:'team',n:'Team: workload and metrics',i:'users'},{k:'routing',n:'Routing map',i:'route'},{k:'map',n:'Tool map',i:'map'}];
async function vault(){if(VAULT||!window.OOLIO_HOSTED||!(window.MH_ME&&window.MH_ME.knowledge))return;VAULT=[];
  try{const r=await fetch('/api/kg/index',{credentials:'same-origin'}),j=await r.json();VAULT=(j.notes||[]).map(n=>({path:n.path,t:n.path.split('/').pop().replace(/\.md$/,''),dir:n.path.split('/').slice(0,-1).join(' / ')}));if(dlg.open)run()}catch(e){}}
function sources(){const out=[];
  (window.mhTools||[]).concat(EXTRA).forEach(t=>{if(t.k&&!document.querySelector('.lx-tab[data-go="'+t.k+'"][hidden]'))out.push({type:'Tool',icon:t.i,t:t.n,s:'',key:fold(t.n),go:()=>{location.hash=t.k}})});
  if(OV){OV.list().forEach(o=>{const gr=OV.groupOf&&OV.groupOf(o.id),addr=OV.address(o.id)||'';
      out.push({type:'Venue',icon:'store',t:o.name||'Untitled',s:[gr&&gr.name!==o.name?gr.name:'',addr,OV.stage(o.id),o.owner].filter(Boolean).join(' · '),key:fold([o.name,gr&&gr.name,addr,o.owner].join(' ')),go:()=>{OV.setActive(o.id);location.hash=''}});
      ((o.menu&&o.menu.names)||[]).forEach(([n,c])=>out.push({type:'Menu item',icon:'utensils',t:n,s:(c?c+' · ':'')+(o.name||''),key:fold(n+' '+(c||'')),w:0.8,go:()=>{OV.setActive(o.id);location.hash='converter'}}))});
    if(OV.guides)OV.guides().forEach(x=>out.push({type:'Guide',icon:'book-open',t:x.title,s:x.cat+' · help.oolio.com',key:fold(x.title+' '+x.desc+' '+x.heads.join(' ')),w:0.9,url:'https://help.oolio.com/'+x.slug}));
    const a=OV.active();if(a&&OV.steps)OV.steps(a.id).forEach(x=>out.push({type:'Checklist step',icon:'list-checks',t:x.t,s:x.sec+' · '+(a.name||'')+(x.s==='done'?' · done':''),key:fold(x.t+' '+x.sec),w:0.85,go:()=>{location.hash='setup';OV.open(a.id)}}))}
  (VAULT||[]).forEach(n=>out.push({type:'Vault note',icon:'share-2',t:n.t,s:n.dir,key:fold(n.t+' '+n.dir),w:0.85,url:'/knowledge#/search/'+encodeURIComponent(n.t)}));
  return out}
function score(x,ws){let s=0;const t=fold(x.t);for(const w of ws){if(!x.key.includes(w))return-1;s+=t.startsWith(w)?4:(' '+t).includes(' '+w)?3:1}if(t===ws.join(' '))s+=5;return s*(x.w||1)}
function run(){const ws=fold(q.value).split(' ').filter(Boolean);let L;
  if(!ws.length){const a=OV&&OV.active();L=sources().filter(x=>x.type==='Tool'||(x.type==='Venue'&&a&&x.t===a.name)).slice(0,14)}
  else{L=sources().map(x=>[x,score(x,ws)]).filter(x=>x[1]>=0).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    // a few of each kind, so one venue's 400 menu items don't push out everything else
    const per={};L=L.filter(x=>(per[x.type]=(per[x.type]||0)+1)<=(x.type==='Menu item'?8:6)).slice(0,30)}
  R=L;SEL=0;const mk=s=>{const ws2=fold(q.value).split(' ').filter(w=>w.length>1);let h=esc(s);ws2.forEach(w=>{h=h.replace(new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>')});return h};
  list.innerHTML=R.length?R.map((x,i)=>'<li role="option" id="gs-'+i+'" aria-selected="'+(i===SEL)+'" data-i="'+i+'">'+IC(x.icon)+'<span><b>'+mk(x.t)+'</b>'+(x.s?'<small>'+esc(x.s)+'</small>':'')+'</span><em>'+esc(x.type)+(x.url?' '+IC('external-link'):'')+'</em></li>').join(''):'<li class="gs-none">Nothing matches “'+esc(q.value)+'”.</li>';
  g('gs-n').textContent=ws.length?R.length+(R.length===30?'+':'')+' results':'';q.setAttribute('aria-activedescendant',R.length?'gs-0':'')}
function pick(i){const x=R[i];if(!x)return;dlg.close();if(x.url)window.open(x.url,/^https?:/.test(x.url)?'_blank':'_self','noopener');else if(x.go)x.go()}
function move(d){if(!R.length)return;SEL=(SEL+d+R.length)%R.length;list.querySelectorAll('[role=option]').forEach((li,i)=>li.setAttribute('aria-selected',i===SEL));const el=g('gs-'+SEL);if(el){el.scrollIntoView({block:'nearest'});q.setAttribute('aria-activedescendant',el.id)}}
function open(){if(dlg.open)return;q.value='';dlg.showModal();run();q.focus();vault()}
btn.addEventListener('click',open);
q.addEventListener('input',run);
q.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();move(1)}else if(e.key==='ArrowUp'){e.preventDefault();move(-1)}else if(e.key==='Enter'){e.preventDefault();pick(SEL)}});
list.addEventListener('click',e=>{const li=e.target.closest('[data-i]');if(li)pick(+li.dataset.i)});
dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='k'){e.preventDefault();open()}});
})();
