/* Menu Hauler: Team tab. Two views of every venue the team has saved:
   - Workload: who has which venues, their go-live and training dates over the next six weeks, and clashes
     (one person with two go-lives, or a go-live and a training, on the same or the next day).
   - Metrics: time from adding a venue to go-live, where venues get stuck (overdue and open checklist steps),
     post-go-live issues per venue (Hypercare), the menu linter's results, and (admins, on the website) this month's
     AI and Firecrawl spend per tool.
   Nothing here costs anything: it reads the records already loaded. build_apps.py puts it after hypercare.js. Ids/classes tm-. */
(()=>{
const g=id=>document.getElementById(id),OV=window.OolioVenues,root=g('tm-root');if(!OV||!root)return;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const IC=n=>window.mhIcon?window.mhIcon(n):'';
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=()=>iso(new Date());
const dd=(a,b)=>Math.round((new Date(b+'T00:00')-new Date(a+'T00:00'))/864e5);
const fmt=d=>d?new Date(d+'T00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'}):'';
const med=L=>{if(!L.length)return null;const s=L.slice().sort((a,b)=>a-b);return s[s.length>>1]};
const KEY='tm.view';let V='workload';try{V=localStorage.getItem(KEY)||'workload'}catch(e){}
const HC=()=>window.OolioHypercare;
function person(o){return clean(o.owner)||'Unassigned'}
function active(){return OV.list().filter(o=>o.stage!=='done')}
function draw(){if(location.hash.slice(1)!=='team')return;
  root.innerHTML='<h1>Team</h1><div class="tm-switch" role="tablist">'+[['workload','users','Workload'],['metrics','chart-column','Metrics']].map(([k,i,t])=>'<button type="button" role="tab" aria-selected="'+(V===k)+'" data-tv="'+k+'">'+IC(i)+t+'</button>').join('')+'</div><div id="tm-body"></div>';
  g('tm-body').innerHTML=V==='metrics'?metrics():workload();if(V==='metrics')spend()}

/* ---------- workload ---------- */
function workload(){const A=active(),t=today(),W=6,start=new Date(t+'T00:00');start.setDate(start.getDate()-((start.getDay()+6)%7));
  const people=new Map();A.forEach(o=>{const p=person(o);(people.get(p)||people.set(p,[]).get(p)).push(o)});
  // the dates each person is busy: go-lives and trainings
  const ev=[];A.forEach(o=>{if(o.golive)ev.push({p:person(o),d:o.golive,k:'golive',o});if(o.training)ev.push({p:person(o),d:o.training,k:'training',o})});
  const clash=[];const byP=new Map();ev.forEach(e=>(byP.get(e.p)||byP.set(e.p,[]).get(e.p)).push(e));
  byP.forEach((L,p)=>{if(p==='Unassigned')return;L.sort((a,b)=>a.d.localeCompare(b.d));for(let i=1;i<L.length;i++){const a=L[i-1],b=L[i];
    if(dd(t,b.d)>=0&&dd(a.d,b.d)<=1&&a.o.id!==b.o.id&&(a.k==='golive'||b.k==='golive'))clash.push({p,a,b})}});
  const lab=e=>(e.k==='golive'?'go-live':'training')+' at '+(e.o.name||'Untitled')+' '+fmt(e.d);
  const weeks=Array.from({length:W},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i*7);return iso(d)});
  const names=[...people.keys()].sort((a,b)=>(a==='Unassigned')-(b==='Unassigned')||people.get(b).length-people.get(a).length);
  const cell=(p,w)=>{const L=ev.filter(e=>e.p===p&&dd(w,e.d)>=0&&dd(w,e.d)<7).sort((a,b)=>a.d.localeCompare(b.d));
    return '<td>'+L.map(e=>'<button type="button" class="tm-ev '+e.k+'" data-o="'+esc(e.o.id)+'" title="'+esc(lab(e))+'">'+(e.k==='golive'?IC('zap'):IC('presentation'))+esc(new Date(e.d+'T00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric'}))+' '+esc(e.o.name||'')+'</button>').join('')+'</td>'};
  const soon=o=>o.golive&&dd(t,o.golive)>=0&&dd(t,o.golive)<=14;
  // waiting on us: venues with no customer update for 2+ days (Setup Tracker → "I've updated them today")
  const wait=A.map(o=>({o,w:OV.wait?OV.wait(o.id):null})).filter(x=>x.w&&x.w.late).sort((a,b)=>b.w.days-a.w.days);
  return (wait.length?'<div class="tm-clash" role="status">'+IC('clock')+'<div><b>'+wait.length+' venue'+(wait.length===1?' is':'s are')+' waiting on us</b> (no customer update for '+2+'+ days)<ul>'+wait.map(x=>'<li><button type="button" class="lx-link" data-o="'+esc(x.o.id)+'">'+esc(x.o.name||'Untitled')+'</button>: '+x.w.days+' days'+(x.w.never?' since it was added':'')+' · '+esc(person(x.o))+'</li>').join('')+'</ul></div></div>':'')+
    (clash.length?'<div class="tm-clash" role="alert">'+IC('triangle-alert')+'<div><b>'+clash.length+' clash'+(clash.length===1?'':'es')+'</b><ul>'+clash.map(c=>'<li>'+esc(c.p)+': '+esc(lab(c.a))+' and '+esc(lab(c.b))+'</li>').join('')+'</ul></div></div>':'')+
    (A.length?'<div class="tm-cal"><table><thead><tr><th>Person</th>'+weeks.map(w=>'<th>Week of '+esc(new Date(w+'T00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'}))+'</th>').join('')+'</tr></thead><tbody>'+
      names.map(p=>'<tr><th>'+esc(p)+'<small>'+people.get(p).length+' venue'+(people.get(p).length===1?'':'s')+'</small></th>'+weeks.map(w=>cell(p,w)).join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="lx-muted">No venues in progress.</p>')+
    '<div class="tm-cols">'+names.map(p=>{const L=people.get(p).sort((a,b)=>(a.golive||'9999').localeCompare(b.golive||'9999'));
      return '<section class="tm-col"><h2>'+IC(p==='Unassigned'?'user-x':'user')+esc(p)+' <span class="lx-muted lx-small">'+L.length+' active · '+L.filter(soon).length+' live in 14 days</span></h2><ul>'+L.map(o=>{const pr=OV.progress(o.id),late=OV.late(o.id),open=HC()?HC().issues(o).filter(x=>x.status!=='closed').length:0;
        return '<li><button type="button" class="tm-v" data-o="'+esc(o.id)+'"><b>'+esc(o.name||'Untitled')+'</b><span>'+esc(OV.stage(o.id))+(o.golive?' · go-live '+esc(fmt(o.golive)):' · no go-live date')+'</span>'+
          '<span class="tm-mini"><i style="width:'+pr.pct+'%"></i></span><span class="tm-tags">'+(late?'<em class="bad">'+late+' overdue</em>':'')+((w=>w&&w.late?'<em class="warn">'+w.days+'d no update</em>':'')(OV.wait?OV.wait(o.id):null))+(open?'<em class="warn">'+open+' open issue'+(open===1?'':'s')+'</em>':'')+(soon(o)?'<em class="on">soon</em>':'')+'</span></button></li>'}).join('')+'</ul></section>'}).join('')+'</div>'+
    '<p class="lx-muted lx-small">The person is the venue’s owner in the Setup Tracker. Set it on the venue’s checklist page.</p>'}

/* ---------- metrics ---------- */
function metrics(){const L=OV.list(),t=today(),live=L.filter(o=>o.golive&&o.golive<=t);
  const ttg=live.map(o=>({o,d:o.createdAt?dd(iso(new Date(o.createdAt)),o.golive):null})).filter(x=>x.d!=null&&x.d>=0);
  const m=med(ttg.map(x=>x.d));
  const stages=OV.stages().map(([k,n])=>[n,L.filter(o=>(o.stage||'pre')===k).length]);
  // stuck: overdue steps across venues in progress, and the steps most often still open
  const stuck=new Map(),open=new Map();active().forEach(o=>OV.steps(o.id).forEach(s=>{if(s.late)stuck.set(s.t,(stuck.get(s.t)||0)+1);if(!s.s)open.set(s.t,(open.get(s.t)||0)+1)}));
  const top=(M,n)=>[...M].sort((a,b)=>b[1]-a[1]).slice(0,n);
  const hc=HC(),issues=hc?L.map(o=>({o,n:hc.issues(o).length,open:hc.issues(o).filter(x=>x.status!=='closed').length})).filter(x=>x.n):[];
  const withHC=L.filter(o=>o.hc&&(o.hc.start||o.hc.issues)).length||live.length;
  const lint=L.filter(o=>o.menu&&o.menu.lint),clean0=lint.filter(o=>!o.menu.lint.block).length;
  const bars=(rows,unit)=>{const mx=Math.max(1,...rows.map(r=>r[1]));return '<ul class="hc-bars">'+rows.map(([k,n])=>'<li><span>'+esc(k)+'</span><i style="--w:'+Math.round(n/mx*100)+'%"></i><b>'+n+(unit||'')+'</b></li>').join('')+'</ul>'};
  const tile=(n,l,s)=>'<div class="tm-tile"><b>'+n+'</b><span>'+esc(l)+'</span>'+(s?'<small>'+esc(s)+'</small>':'')+'</div>';
  return '<div class="tm-tiles">'+tile(L.length,'venues saved',active().length+' in progress')+tile(m==null?'–':m+' d','to go-live (median)',ttg.length?'from '+ttg.length+' live venue'+(ttg.length===1?'':'s'):live.length?'needs go-live dates after the venue was added':'no live venues yet')+
      tile(issues.reduce((s,x)=>s+x.n,0),'hypercare issues',withHC?(Math.round(issues.reduce((s,x)=>s+x.n,0)/withHC*10)/10)+' per live venue':'')+tile(lint.length?Math.round(clean0/lint.length*100)+'%':'–','menus passed pre-flight',lint.length?clean0+' of '+lint.length+' checked':'none checked yet')+'</div>'+
    '<div class="tm-grid"><section class="tm-card"><h2>Where venues are</h2>'+bars(stages)+'</section>'+
      '<section class="tm-card"><h2>Overdue steps</h2>'+(stuck.size?bars(top(stuck,8),' venues'):'<p class="lx-muted lx-small">Nothing overdue.</p>')+'</section>'+
      '<section class="tm-card"><h2>Steps most often still open</h2>'+(open.size?bars(top(open,8)):'<p class="lx-muted lx-small">No venues in progress.</p>')+'</section>'+
      '<section class="tm-card"><h2>Time to go-live</h2>'+(ttg.length?bars(ttg.sort((a,b)=>b.d-a.d).slice(0,10).map(x=>[x.o.name||'Untitled',x.d]),' d'):'<p class="lx-muted lx-small">Shows once venues have gone live.</p>')+'</section>'+
      '<section class="tm-card"><h2>Hypercare issues per venue</h2>'+(issues.length?bars(issues.sort((a,b)=>b.n-a.n).slice(0,10).map(x=>[x.o.name+(x.open?' ('+x.open+' open)':''),x.n])):'<p class="lx-muted lx-small">No issues logged yet.</p>')+'</section>'+
      '<section class="tm-card" id="tm-spend"><h2>AI and Firecrawl spend</h2><p class="lx-muted lx-small">'+(window.OOLIO_HOSTED?'Admins see this month’s spend per tool here.':'Only on the website.')+'</p></section></div>'}
async function spend(){const el=g('tm-spend');if(!el||!window.OOLIO_HOSTED||!(window.MH_ME&&window.MH_ME.admin))return;
  try{const r=await fetch('/api/admin/spend',{credentials:'same-origin'}),j=await r.json();if(!r.ok)throw new Error(j.error||r.status);
    const T=(window.mhTools||[]).reduce((m,t)=>(m[t.k]=t.n,m),{});
    el.innerHTML='<h2>AI and Firecrawl spend <span class="lx-muted lx-small">'+esc(j.month)+'</span></h2><div class="tm-tiles tm-tiles-s">'+'<div class="tm-tile"><b>US$'+j.claudeUsd.toFixed(2)+'</b><span>AI this month</span><small>'+j.calls+' calls, '+j.cached+' free from saved answers</small></div><div class="tm-tile"><b>'+j.firecrawl.used+'</b><span>Firecrawl credits</span><small>of '+j.firecrawl.cap+' this month</small></div></div>'+
      (j.tools.length?'<ul class="hc-bars">'+j.tools.map(x=>{const mx=Math.max(...j.tools.map(y=>y.usd),0.01);return '<li><span>'+esc(T[x.tool]||x.tool||'Other')+'</span><i style="--w:'+Math.round(x.usd/mx*100)+'%"></i><b>$'+x.usd.toFixed(2)+'</b><small>'+x.calls+' calls</small></li>'}).join('')+'</ul>':'<p class="lx-muted lx-small">No AI calls this month.</p>')}
  catch(e){el.querySelector('p').textContent='Couldn’t load spend ('+e.message+').'}}
root.addEventListener('click',e=>{const v=e.target.closest('[data-tv]');if(v){V=v.dataset.tv;try{localStorage.setItem(KEY,V)}catch(x){}draw();return}
  const o=e.target.closest('[data-o]');if(o){OV.setActive(o.dataset.o);location.hash='setup';OV.open(o.dataset.o)}});
OV.on(()=>draw());window.addEventListener('hashchange',draw);draw();
})();
