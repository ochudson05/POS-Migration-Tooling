/* Menu Hauler on its own website (menuhauler.com, the menurunner Worker, behind its own email-code sign-in).
   The tools were written for claude.ai, where they reach shared data, sign-in and Firecrawl through window.claude.use(name).
   This file provides the same interface from the website's own API (relay-worker.js), so the tools run unchanged:
     db    -> /api/db/*  (D1), with changes from teammates picked up every 10 seconds
     user  -> /api/me    (the signed-in email)
     mcp   -> /api/fc    (Firecrawl with the team key; the Claude app's browser isn't needed, see /api/fetch)
     sample -> /api/claude, but only for people the owner has switched Claude on for (see /admin); everyone else gets
               nothing, so each tool falls back to its built-in readers and OCR exactly as before.
               json(prompt, {task:'light'}) asks for the cheaper model the owner picked for small jobs; {context} is
               fixed reference text sent first (Anthropic's prompt cache); a repeated question is answered from a
               saved reading unless {fresh:true}. On claude.ai these options are simply ignored.
     window.MH_SERVER -> the Menu Hauler server through /api/server/* (menu scraper, OCR), when the website has one
     downloads -> not available: normal downloads
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

/* ---------- Claude through the website (the same shape the tools use on claude.ai: limits() and json()) ---------- */
const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=()=>rej(r.error);r.readAsDataURL(blob)});
const err=(m,code)=>{const x=new Error(m);x.code=code;return x};
// Claude is asked for "only JSON"; take the JSON out of the answer even if it comes wrapped in a code block or a sentence
function parseJSON(t){t=String(t||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(t)}catch(e){}
  const a=t.search(/[{[]/),z=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']'));
  if(a>=0&&z>a){try{return JSON.parse(t.slice(a,z+1))}catch(e){}}
  return undefined}
const SAMPLE={
  async limits(){const m=await me(),l=m.claudeLimits||{};return{maxPromptBytes:Math.floor((l.maxPromptChars||200000)*0.9),images:{maxCount:l.maxImages||4}}},
  async json(prompt,o){o=o||{};const list=o.images?(Array.isArray(o.images)?o.images:[o.images]):[],images=[];
    for(const x of list){const blob=x instanceof Blob?x:await new Promise(r=>x.toBlob(r,'image/jpeg',0.9));
      images.push({type:blob.type==='image/jpg'?'image/jpeg':(blob.type||'image/jpeg'),data:await b64(blob)})}
    let r;try{r=await fetch('/api/claude',{method:'POST',credentials:'same-origin',redirect:'manual',signal:o.signal,headers:{'content-type':'application/json'},
      // task "light" = a small job for the cheaper model; context = fixed reference text (prompt-cached); fresh = skip saved readings
      body:JSON.stringify({prompt:String(prompt),images,tool:location.hash.slice(1),task:o.task==='light'?'light':undefined,context:typeof o.context==='string'?o.context:undefined,fresh:o.fresh===true||undefined})})}
    catch(e){if(o.signal&&o.signal.aborted)throw err('Stopped.','cancelled');throw err('The website couldn’t be reached. Check the connection.','unavailable')}
    if(r.type==='opaqueredirect'||r.status===401){signinBanner('Your sign-in session has ended. Reload the page to sign in again.');throw err('Your sign-in session has ended.','session_expired')}
    let j={};try{j=await r.json()}catch(e){}
    if(!r.ok)throw err(j.error||('The website answered '+r.status+'.'),j.code||'unavailable');
    const v=parseJSON(j.text);if(v===undefined)throw err(j.truncated?'Claude’s answer was too long and got cut off. Try a smaller part of the menu.':'Claude’s answer couldn’t be read. Try again.','invalid_json');
    return v}};

/* ---------- the Menu Hauler server: menu scraper and OCR (null when the website has none) ---------- */
window.MH_SERVER={
  async on(){try{const m=await me();return{scraper:!!m.scraper,ocr:!!m.ocr}}catch(e){return{scraper:false,ocr:false}}},
  scrape(url,signal){return fetch('/api/server/scrape',{method:'POST',credentials:'same-origin',signal,headers:{'content-type':'application/json'},body:JSON.stringify({url})})
    .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw err(j.error||('The Menu Hauler server answered '+r.status+'.'),j.code||'unavailable');return j})},
  ocr(blob,signal){return fetch('/api/server/ocr',{method:'POST',credentials:'same-origin',signal,headers:{'content-type':blob.type||'image/jpeg'},body:blob})
    .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw err(j.error||('The Menu Hauler server answered '+r.status+'.'),j.code||'unavailable');return j})}};

window.claude={use:async n=>{
  if(n==='db'){try{await me();return DB}catch(e){signinBanner(e.message);return null}}
  if(n==='user')return USER;
  if(n==='mcp')return MCP;
  // only offered when the website says this person may use Claude now; otherwise the tools carry on without it
  if(n==='sample'){try{return(await me()).claude?SAMPLE:null}catch(e){return null}}
  return null}};

/* ---------- what this person may use (set on /admin) ---------- */
// tabs and cards for tools they haven't been given are hidden, and opening one by its address goes back to the start;
// view-only and Firecrawl limits are also enforced by the website itself. Admins get a link to /admin in the footer.
let ME_NOW=null;
const TOOLKEYS=['venues','converter','photos','venue','setup','word'];
function applyAccess(m){ME_NOW=m;window.MH_ME=m;const ok=t=>!m.tools||m.tools.includes(t);
  // pages show their "read by Claude" notes instead of the OCR ones
  document.documentElement.classList.toggle('oolio-claude',!!m.claude);
  document.querySelectorAll('.lx-tab[data-go],.lx-card .lx-open[data-go]').forEach(b=>{const t=b.dataset.go;if(TOOLKEYS.includes(t)&&!ok(t))(b.closest('.lx-card')||b).hidden=true});
  const guard=()=>{const v=location.hash.slice(1);if(TOOLKEYS.includes(v)&&!ok(v)){try{history.replaceState(null,'',location.pathname+location.search)}catch(e){location.hash=''}window.dispatchEvent(new HashChangeEvent('hashchange'))}};
  window.addEventListener('hashchange',guard);guard();
  if(m.admin){const f=document.querySelector('.lx-foot .hosted-only');if(f&&!f.querySelector('a[href="/admin"]')){const a=document.createElement('a');a.href='/admin';a.innerHTML=(window.mhIcon?window.mhIcon('shield-check'):'')+'Admin';f.prepend(a,' · ')}}
  if(m.canEdit===false){const b=document.createElement('div');b.className='oh-banner';b.style.background='var(--accent)';b.innerHTML=(window.mhIcon?window.mhIcon('eye'):'')+'<span>Your access is view-only: you can look at venues but not change them.</span>';document.body.prepend(b)}
  // shell.js redraws the account button and the tab marker
  window.dispatchEvent(new CustomEvent('mh:me',{detail:m}))}
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
