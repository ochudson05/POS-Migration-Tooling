/* Menu Hauler on its own website (menuhauler.com, the menurunner Worker, behind its own email-code sign-in).
   The tools were written for claude.ai, where they reach shared data, sign-in and Firecrawl through window.claude.use(name).
   This file provides the same interface from the website's own API (relay-worker.js), so the tools run unchanged:
     db    -> /api/db/*  (D1), with changes from teammates picked up every 10 seconds
     user  -> /api/me    (the signed-in email)
     mcp   -> /api/fc    (Firecrawl with the team key; the Claude app's browser isn't needed, see /api/fetch)
     sample, downloads -> not available: each tool falls back (built-in readers and OCR, normal downloads)
   build_apps.py puts this first in public/index.html. */
(()=>{
window.OOLIO_HOSTED=true;
document.documentElement.classList.add('oolio-hosted');
const qs=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!==''&&v!=null)).toString();
async function call(path,body){
  let r;try{r=await fetch('/api/'+path,body===undefined?{credentials:'same-origin',redirect:'manual'}:{method:'POST',credentials:'same-origin',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
  catch(e){const x=new Error('The website couldn’t be reached. Check the connection.');x.code='unavailable';throw x}
  // a redirect means the sign-in has run out
  if(r.type==='opaqueredirect'||(r.status>=300&&r.status<400)){const x=new Error('Your sign-in session has ended. Reload the page to sign in again.');x.code='not_granted';signinBanner(x.message);throw x}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok){const x=new Error(j.error||('The website answered '+r.status+'.'));x.code=j.code||(r.status===401?'not_granted':r.status>=500?'unavailable':'invalid_argument');if(x.code==='not_granted')signinBanner(x.message);throw x}
  return j}
let ME=null;const me=()=>ME||(ME=call('me').catch(e=>{ME=null;throw e}));
const nameOf=e=>e.split('@')[0].split(/[._-]+/).filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');

/* ---------- shared records ---------- */
const META={fromCache:false,hasPendingWrites:false};
const snap=(id,data)=>({id,exists:data!=null,data:()=>data==null?undefined:data,metadata:META});
const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const POLLS=new Set(),nudge=()=>POLLS.forEach(f=>f(400));
class Query{constructor(path,o){this.path=path;this.o=o||{}}
  orderBy(f,d){return new Query(this.path,Object.assign({},this.o,{order:f,dir:d||'asc'}))}
  limit(n){return new Query(this.path,Object.assign({},this.o,{limit:n}))}
  where(){return this}
  doc(id){return new Doc(this.path,id||rid())}
  async add(d){const x=this.doc();await x.set(d);return x}
  async get(){const r=await call('db/list?'+qs({coll:this.path,order:this.o.order||'',dir:this.o.dir||'',limit:this.o.limit||''}));
    const docs=r.docs.map(d=>snap(d.id,d.data));return{docs,size:docs.length,empty:!docs.length,docChanges:()=>docs.map((d,i)=>({type:'added',doc:d,oldIndex:-1,newIndex:i})),metadata:META}}
  // the first answer is everything; after that only what changed since, plus the ids that still exist (to see deletions)
  onSnapshot(next,err){const coll=this.path,cur=new Map();let since=0,stop=false,t=null,first=true,busy=false;
    const tick=async()=>{if(stop||busy)return;busy=true;
      try{const r=await call('db/list?'+qs({coll,since:since||''})),ch=[];
        r.docs.forEach(d=>{const had=cur.get(d.id);if(had&&JSON.stringify(had.data())===JSON.stringify(d.data))return;const s=snap(d.id,d.data);cur.set(d.id,s);ch.push({type:had?'modified':'added',doc:s})});
        if(r.ids){const live=new Set(r.ids);[...cur.keys()].forEach(id=>{if(!live.has(id)){ch.push({type:'removed',doc:cur.get(id)});cur.delete(id)}})}
        since=Math.max(since,r.now||0);
        if(first||ch.length){first=false;const docs=[...cur.values()];next({docs,size:docs.length,empty:!docs.length,docChanges:()=>ch,metadata:META})}}
      catch(e){if(e.code==='not_granted'){stop=true;POLLS.delete(soon);if(err)err(e)}}
      busy=false;if(!stop){clearTimeout(t);t=setTimeout(tick,document.hidden?60000:10000)}};
    const soon=ms=>{clearTimeout(t);t=setTimeout(tick,ms)};POLLS.add(soon);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!stop)soon(200)});
    tick();return()=>{stop=true;clearTimeout(t);POLLS.delete(soon)}}}
class Doc{constructor(coll,id){this.coll=coll;this.id=id;this.path=coll+'/'+id}
  async get(){const r=await call('db/get?'+qs({coll:this.coll,id:this.id}));return snap(this.id,r.data)}
  async set(data){await call('db/set',{coll:this.coll,id:this.id,data});nudge()}
  async update(data){await call('db/update',{coll:this.coll,id:this.id,data});nudge()}
  async delete(){await call('db/delete',{coll:this.coll,id:this.id});nudge()}
  collection(sub){return new Query(this.path+'/'+sub)}
  onSnapshot(next,err){let stop=false,t=null,last='';const tick=async()=>{if(stop)return;try{const s=await this.get(),k=JSON.stringify(s.data()||null);if(k!==last){last=k;next(s)}}catch(e){if(e.code==='not_granted'){stop=true;if(err)err(e);return}}t=setTimeout(tick,document.hidden?60000:10000)};tick();return()=>{stop=true;clearTimeout(t)}}}
const DB={collection:p=>new Query(p),doc:p=>{const i=p.lastIndexOf('/');return new Doc(p.slice(0,i),p.slice(i+1))}};

/* ---------- who is signed in ---------- */
const USER={async id(){try{return 'u:'+(await me()).email}catch(e){return null}},
  async me(){try{const m=await me();return{id:'u:'+m.email,name:m.name,email:m.email}}catch(e){return{id:'',name:''}}},
  isOwner:()=>!!(ME_NOW&&ME_NOW.role==='owner'),canEdit:()=>!ME_NOW||ME_NOW.canEdit!==false,async can(){try{return(await me()).canEdit!==false}catch(e){return false}},
  async profiles(ids){const o={};(ids||[]).forEach(id=>{const e=String(id).replace(/^u:/,'');o[id]={id,name:e.includes('@')?nameOf(e):''}});return o},
  async search(){return[]}};

/* ---------- Firecrawl through the website ---------- */
const MCP={async callTool(server,tool,input){
    if(server!=='Firecrawl'){const e=new Error('Not available on the website.');e.code='server_not_connected';throw e}
    const r=await call('fc',{tool,input});return{payload:r.payload}},
  async watchTool(){return()=>{}}};

window.claude={use:async n=>{
  if(n==='db'){try{await me();return DB}catch(e){signinBanner(e.message);return null}}
  if(n==='user')return USER;
  if(n==='mcp')return MCP;
  return null}};

/* ---------- what this person may use (set on /admin) ---------- */
// tabs and cards for tools they haven't been given are hidden, and opening one by its address goes back to the start;
// view-only and Firecrawl limits are also enforced by the website itself. Admins get a link to /admin in the footer.
let ME_NOW=null;
const TOOLKEYS=['converter','photos','venue','setup','word'];
function applyAccess(m){ME_NOW=m;const ok=t=>!m.tools||m.tools.includes(t);
  document.querySelectorAll('.lx-tab[data-go],.lx-card .lx-open[data-go]').forEach(b=>{const t=b.dataset.go;if(TOOLKEYS.includes(t)&&!ok(t))(b.closest('.lx-card')||b).hidden=true});
  const guard=()=>{const v=location.hash.slice(1);if(TOOLKEYS.includes(v)&&!ok(v)){try{history.replaceState(null,'',location.pathname+location.search)}catch(e){location.hash=''}window.dispatchEvent(new HashChangeEvent('hashchange'))}};
  window.addEventListener('hashchange',guard);guard();
  if(m.admin){const f=document.querySelector('.lx-foot .hosted-only');if(f&&!f.querySelector('a[href="/admin"]')){const a=document.createElement('a');a.href='/admin';a.textContent='Admin';f.prepend(a,' · ')}}
  if(m.canEdit===false){const b=document.createElement('div');b.className='oh-banner';b.style.background='var(--accent)';b.textContent='Your access is view-only: you can look at venues but not change them.';document.body.prepend(b)}}
// which tool is open, for the admin page's activity list
function report(){const t=location.hash.slice(1);if(TOOLKEYS.includes(t)&&!(ME_NOW&&ME_NOW.tools&&!ME_NOW.tools.includes(t)))fetch('/api/seen',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({tool:t})}).catch(()=>{})}
window.addEventListener('hashchange',report);
const start=()=>{me().then(applyAccess).catch(()=>{});report()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();

/* ---------- a page-wide note when sign-in fails ---------- */
let shown=false;
function signinBanner(msg){if(shown)return;shown=true;const go=()=>{const b=document.createElement('div');b.className='oh-banner';b.setAttribute('role','alert');
  b.innerHTML='<b>Not signed in.</b> <span></span> <button type="button">Sign in</button>';b.querySelector('span').textContent=msg||'';b.querySelector('button').onclick=()=>{location.href='/login?next='+encodeURIComponent(location.pathname+location.hash)};document.body.prepend(b)};
  if(document.body)go();else document.addEventListener('DOMContentLoaded',go)}
})();
