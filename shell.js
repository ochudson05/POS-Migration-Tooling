/* Menu Hauler shell: the parts every view shares. Icons, light/dark theme, the settings panel (account details and
   this device's settings, open to everyone), toasts, the sliding tab marker, view animations and the start page.
   build_apps.py runs it in the launcher before the launcher's own script; theme-boot.js has already applied the theme.
   Settings live in localStorage "mh.settings" on this device (see theme-boot.js). Account details come from
   /api/account on the website, from claude.ai's user capability on claude.ai, and there are none in a local file. */
(()=>{
const g=id=>document.getElementById(id),esc=t=>String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const ic=(n,c)=>'<svg class="ic'+(c?' '+c:'')+'" aria-hidden="true" focusable="false"><use href="#i-'+n+'"/></svg>';
window.mhIcon=ic;
const TOOLS=[{k:'converter',n:'Menu Converter',i:'file-spreadsheet'},{k:'photos',n:'Photo Finder',i:'images'},{k:'venue',n:'Restaurant Lookup',i:'store'},
  {k:'setup',n:'Setup Tracker',i:'list-checks'},{k:'word',n:'Image to Word',i:'scan-text'}];
window.mhTools=TOOLS;
const KEY='mh.settings';let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};
const root=document.documentElement,HOST=root.getAttribute('data-mh-host')||'',mq=matchMedia('(prefers-color-scheme: dark)');
const HOSTED=!!window.OOLIO_HOSTED,ONCLAUDE=!HOSTED&&!!(window.claude&&window.claude.use);
const still=()=>root.classList.contains('mh-still')||matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- toasts ---------- */
let tw=null;
function toast(text,kind){if(!tw){tw=document.createElement('div');tw.className='mh-toasts';tw.setAttribute('role','status');tw.setAttribute('aria-live','polite');document.body.appendChild(tw)}
  const el=document.createElement('div');el.className='mh-toast'+(kind?' '+kind:'');el.innerHTML=ic(kind==='err'?'info':'circle-check')+'<span></span>';el.querySelector('span').textContent=text;
  tw.appendChild(el);setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),400)},3400)}
window.mhToast=toast;

/* ---------- theme ---------- */
const effective=()=>{const t=root.getAttribute('data-theme');return t==='dark'||t==='light'?t:(mq.matches?'dark':'light')};
function applyTheme(){const t=S.theme;
  if(t==='light'||t==='dark')root.setAttribute('data-theme',t);else if(HOST)root.setAttribute('data-theme',HOST);else root.removeAttribute('data-theme');
  syncFrame();drawQuick()}
// the Photo Finder runs in its own frame; give it the same theme
function syncFrame(){const f=g('lx-pfframe');try{const d=f&&f.contentDocument;if(d&&d.documentElement){const t=root.getAttribute('data-theme');if(t)d.documentElement.setAttribute('data-theme',t);else d.documentElement.removeAttribute('data-theme');d.documentElement.classList.toggle('mh-still',root.classList.contains('mh-still'))}}catch(e){}}
// switching themes grows the new one out of the button that was pressed (where the browser can animate it)
// t is a theme, or a function that picks one when the change actually happens (so quick repeated toggles stay in step)
let vtBusy=false;
function setTheme(t,from){const run=()=>{S.theme=typeof t==='function'?t():t;save();applyTheme();drawSettings()};
  if(!document.startViewTransition||still()||vtBusy||document.hidden){run();return}
  vtBusy=true;setTimeout(()=>{vtBusy=false},700);
  const r=from&&from.getBoundingClientRect?from.getBoundingClientRect():null,x=r?r.left+r.width/2:innerWidth-40,y=r?r.top+r.height/2:30;
  const rad=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
  document.startViewTransition(run).ready.then(()=>{document.documentElement.animate({clipPath:['circle(0 at '+x+'px '+y+'px)','circle('+rad+'px at '+x+'px '+y+'px)']},{duration:450,easing:'cubic-bezier(.2,.8,.2,1)',pseudoElement:'::view-transition-new(root)'})}).catch(()=>{})}
function drawQuick(){const b=g('mh-theme');if(!b)return;const d=effective()==='dark';b.innerHTML=ic(d?'sun':'moon');b.setAttribute('aria-label',d?'Switch to light mode':'Switch to dark mode');b.title=d?'Light mode':'Dark mode'}
mq.addEventListener('change',()=>{if(!S.theme||S.theme==='system'){drawQuick();drawSettings()}});
function applySize(){const z=+S.size||1;if(z===1)root.style.removeProperty('--mh-zoom');else root.style.setProperty('--mh-zoom',String(z));requestAnimationFrame(moveInd)}
function applyMotion(){root.classList.toggle('mh-still',S.motion==='reduce');syncFrame()}

/* ---------- start page, tab marker and view animation (the launcher calls mhAfterShow after each view change) ---------- */
const allowed=k=>{const m=window.MH_ME;return!(m&&m.tools&&!m.tools.includes(k))};
if(!location.hash){const st=S.start||'home',t=st==='last'?S.last:st;if(t&&t!=='home'&&TOOLS.some(x=>x.k===t)&&allowed(t)){try{history.replaceState(null,'','#'+t)}catch(e){}}}
function moveInd(){const tabs=document.querySelector('.lx-tabs');if(!tabs)return;let ind=tabs.querySelector('.lx-ind');
  if(!ind){ind=document.createElement('span');ind.className='lx-ind';ind.setAttribute('aria-hidden','true');tabs.prepend(ind)}
  const a=tabs.querySelector('.lx-tab[aria-current="page"]');if(!a||a.hidden||!a.offsetWidth){ind.style.opacity='0';return}
  ind.style.opacity='1';ind.style.width=a.offsetWidth+'px';ind.style.height=a.offsetHeight+'px';ind.style.transform='translate('+a.offsetLeft+'px,'+a.offsetTop+'px)';
  if(tabs.scrollWidth>tabs.clientWidth)tabs.scrollTo({left:a.offsetLeft-tabs.clientWidth/2+a.offsetWidth/2,behavior:still()?'auto':'smooth'})}
window.mhAfterShow=(v,el)=>{moveInd();
  if(TOOLS.some(x=>x.k===v)){S.last=v;save()}
  if(el&&!still()){el.classList.remove('mh-enter');void el.offsetWidth;el.classList.add('mh-enter')}};
addEventListener('resize',()=>requestAnimationFrame(moveInd));
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(moveInd);
// each tool's own heading gets its icon (again whenever a tool redraws its page)
const HEADS=[['lx-conv','file-spreadsheet','converter'],['lx-rf','store','venue'],['lx-st','list-checks','setup'],['lx-iw','scan-text','word']];
function heads(){HEADS.forEach(([id,i,k])=>{const h=g(id)&&g(id).querySelector('h1');if(h&&!h.querySelector('.mh-hico'))h.insertAdjacentHTML('afterbegin','<span class="mh-hico t-'+k+'">'+ic(i)+'</span>')})}
heads();let headQ=false;
const mo=new MutationObserver(()=>{if(!headQ){headQ=true;requestAnimationFrame(()=>{headQ=false;heads()})}});
HEADS.forEach(([id])=>{if(g(id))mo.observe(g(id),{childList:true,subtree:true})});

/* ---------- the person (website: /api/me via hosted.js; claude.ai: the user capability, when settings open) ---------- */
let ACC=null;
const initials=n=>String(n||'').split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'?';
function drawMe(){const b=g('mh-open');if(!b)return;const m=window.MH_ME||ACC;
  b.innerHTML=m&&m.name?'<span class="mh-av" aria-hidden="true">'+esc(initials(m.name))+'</span>':ic('settings');
  b.setAttribute('aria-label','Settings and account'+(m&&m.name?' ('+m.name+')':''))}
addEventListener('mh:me',()=>{drawMe();moveInd()});

/* ---------- settings panel ---------- */
let open=false;
function sheet(){let d=g('mh-set');if(d)return d;d=document.createElement('dialog');d.id='mh-set';d.className='mh-sheet';d.setAttribute('aria-labelledby','mh-set-h');
  d.innerHTML='<div class="mh-sh-head"><h2 id="mh-set-h">'+ic('settings')+' Settings</h2><button type="button" class="mh-x" data-s="close" aria-label="Close settings">'+ic('x')+'</button></div><div class="mh-sh-body" id="mh-set-body"></div>';
  document.body.appendChild(d);
  d.addEventListener('click',e=>{if(e.target===d){close();return}const b=e.target.closest('[data-s]');if(b)act(b.dataset.s,b)});
  d.addEventListener('change',e=>{const t=e.target;
    if(t.name==='mh-theme')setTheme(t.value,t.closest('label'));
    else if(t.name==='mh-size'){S.size=+t.value;save();applySize()}
    else if(t.id==='mh-motion'){S.motion=t.checked?'reduce':'system';save();applyMotion()}
    else if(t.id==='mh-start'){S.start=t.value;save();toast('Start page saved.')}});
  d.addEventListener('cancel',e=>{e.preventDefault();close()});
  return d}
function openSettings(){const d=sheet();drawSettings();if(!d.open)d.showModal();open=true;d.classList.remove('closing');loadAccount()}
function close(){const d=g('mh-set');if(!d||!d.open)return;open=false;if(still()){d.close();return}d.classList.add('closing');setTimeout(()=>{d.classList.remove('closing');d.close()},220)}
window.mhSettings=openSettings;
async function loadAccount(){
  try{if(HOSTED){const r=await fetch('/api/account',{credentials:'same-origin'});if(r.ok)ACC=await r.json()}
    else if(ONCLAUDE){const u=await window.claude.use('user');const m=u&&await u.me();if(m)ACC={name:m.name||'',claude:true}}}catch(e){}
  drawMe();if(open)drawSettings()}
const when=t=>t?new Date(t).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const day=t=>t?new Date(t).toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'}):'—';
function cacheKeys(){const out=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^(menuRead:|rf1:|mpf1:)/.test(k))out.push(k)}}catch(e){}return out}
function seg(name,cur,opts){return'<div class="mh-seg" role="radiogroup">'+opts.map(([v,l,i])=>'<label class="'+(String(cur)===String(v)?'on':'')+'"><input type="radio" name="'+name+'" value="'+v+'"'+(String(cur)===String(v)?' checked':'')+'>'+(i?ic(i):'')+'<span>'+l+'</span></label>').join('')+'</div>'}
function drawSettings(){const body=g('mh-set-body');if(!body)return;const m=Object.assign({},window.MH_ME||{},ACC||{});
  let acct;
  if(HOSTED){const tools=m.tools?TOOLS.filter(t=>m.tools.includes(t.k)):TOOLS;
    acct='<div class="mh-who"><span class="mh-av big" aria-hidden="true">'+esc(initials(m.name||m.email))+'</span><div><b>'+esc(m.name||'Loading…')+'</b><span>'+esc(m.email||'')+'</span>'+
      (m.role?'<span class="mh-pill '+m.role+'">'+ic(m.role==='member'?'user':'shield-check')+(m.role==='owner'?'Owner':m.role==='admin'?'Admin':'Member')+'</span>':'')+'</div></div>'+
      '<form class="mh-name" data-form="name"><label for="mh-name">Display name</label><div class="mh-row"><input id="mh-name" maxlength="60" autocomplete="name" value="'+esc(m.name||'')+'"><button type="submit">Save</button></div><small>Shown to your team on the admin page and the records you change.</small></form>'+
      '<dl class="mh-dl">'+
        '<dt>'+ic('layout-grid')+'Tools</dt><dd>'+(tools.length===TOOLS.length?'All tools':tools.map(t=>t.n).join(', ')||'None')+'</dd>'+
        '<dt>'+ic(m.canEdit===false?'eye':'pencil')+'Venues</dt><dd>'+(m.canEdit===false?'View only':'Can add and change')+'</dd>'+
        '<dt>'+ic('flame')+'Firecrawl</dt><dd>'+(m.firecrawl===false?'Off for your account':'On (team credits)')+'</dd>'+
        '<dt>'+ic('log-in')+'Last sign-in</dt><dd>'+when(m.lastSignIn)+(m.previousSignIn?'<small>Before that: '+when(m.previousSignIn)+'</small>':'')+'</dd>'+
        '<dt>'+ic('laptop')+'Signed in on</dt><dd>'+(m.devices!=null?m.devices+' device'+(m.devices===1?'':'s')+'<small>Each sign-in lasts '+(m.sessionDays||30)+' days</small>':'—')+'</dd>'+
        '<dt>'+ic('clock')+'Member since</dt><dd>'+day(m.addedAt)+'</dd></dl>'+
      '<div class="mh-btns">'+(m.admin?'<a class="mh-btn" href="/admin">'+ic('shield-check')+'Admin page</a>':'')+
        '<a class="mh-btn sec" href="/auth/logout">'+ic('log-out')+'Sign out</a><button type="button" class="mh-btn sec" data-s="signout-all">'+ic('laptop')+'Sign out everywhere</button></div>'+
      '<p class="mh-note">Need more access? Ask an admin. Your access is set by the team, not here.</p>'}
  else if(ONCLAUDE)acct='<div class="mh-who"><span class="mh-av big" aria-hidden="true">'+esc(initials(m.name))+'</span><div><b>'+esc(m.name||'Your claude.ai account')+'</b><span>Using Menu Hauler on claude.ai</span></div></div><p class="mh-note">You’re signed in through claude.ai. Who can open this page is set by whoever shared it with you.</p>';
  else acct='<div class="mh-who"><span class="mh-av big" aria-hidden="true">'+ic('laptop')+'</span><div><b>Opened from this computer</b><span>Not signed in</span></div></div><p class="mh-note">Nothing you do here is shared with the team. Use menuhauler.com to work on shared venues.</p>';
  const theme=S.theme==='light'||S.theme==='dark'?S.theme:'system',ck=cacheKeys();
  const legal=[...document.querySelectorAll('#lx-legal .lg-doc')].map(a=>'<a href="#'+a.id.slice(3)+'" data-s="close">'+esc(a.dataset.title)+'</a>').join('');
  const avail=TOOLS.filter(t=>allowed(t.k));
  body.innerHTML=
    '<section><h3>'+ic('circle-user')+'Account</h3>'+acct+'</section>'+
    '<section><h3>'+ic('sun')+'Appearance</h3>'+
      '<div class="mh-field"><span class="mh-lbl">Theme</span>'+seg('mh-theme',theme,[['light','Light','sun'],['dark','Dark','moon'],['system','System','monitor']])+
        '<small>'+(theme==='system'?'Following your device: '+effective()+' right now.':'Always '+theme+' on this device.')+'</small></div>'+
      '<div class="mh-field"><span class="mh-lbl">Text size</span>'+seg('mh-size',+S.size||1,[[0.9,'Smaller'],[1,'Default'],[1.1,'Larger']])+'</div>'+
      '<label class="mh-sw"><input type="checkbox" id="mh-motion" role="switch"'+(S.motion==='reduce'?' checked':'')+'><span class="mh-track" aria-hidden="true"></span><span>Reduce animations<small>Turns off slides, fades and the theme reveal.</small></span></label></section>'+
    '<section><h3>'+ic('layout-grid')+'Start page</h3><div class="mh-field"><label class="mh-lbl" for="mh-start">When I open Menu Hauler, show</label><select id="mh-start">'+
      [['home','Home (my venues)'],['last','The last tool I used']].concat(avail.map(t=>[t.k,t.n])).map(([v,l])=>'<option value="'+v+'"'+((S.start||'home')===v?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></div></section>'+
    '<section><h3>'+ic('hard-drive')+'Data on this device</h3><div class="mh-line"><div><b>Saved lookups and page reads</b><small>'+(ck.length?ck.length+' saved, so repeat lookups are free. Clearing them doesn’t touch shared venues.':'Nothing saved yet.')+'</small></div><button type="button" class="mh-btn sec" data-s="clear"'+(ck.length?'':' disabled')+'>'+ic('trash-2')+'Clear</button></div>'+
      '<div class="mh-line"><div><b>These settings</b><small>Theme, text size, motion and start page are kept in this browser only.</small></div><button type="button" class="mh-btn sec" data-s="reset">'+ic('rotate-ccw')+'Reset</button></div></section>'+
    '<section><h3>'+ic('info')+'About</h3><p class="mh-note">Menu Hauler'+(m.version?' · version '+esc(m.version):'')+'. Press <kbd>Ctrl</kbd> + <kbd>,</kbd> to open these settings.</p><nav class="mh-links" aria-label="Policies">'+legal+'</nav></section>';
  body.querySelectorAll('.mh-seg input').forEach(i=>i.addEventListener('change',()=>i.closest('.mh-seg').querySelectorAll('label').forEach(l=>l.classList.toggle('on',l.contains(i)))));
  const f=body.querySelector('[data-form=name]');if(f)f.addEventListener('submit',saveName)}
async function saveName(e){e.preventDefault();const v=g('mh-name').value.trim(),b=e.target.querySelector('button');b.disabled=true;
  try{const r=await fetch('/api/account',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({name:v})});const j=await r.json();if(!r.ok)throw new Error(j.error||'error');
    if(ACC)ACC.name=j.name;if(window.MH_ME)window.MH_ME.name=j.name;drawMe();drawSettings();toast('Display name saved.')}
  catch(err){toast('Couldn’t save your name ('+err.message+').','err')}b.disabled=false}
async function act(a,b){
  if(a==='close')return close();
  if(a==='clear'){const ks=cacheKeys();ks.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});toast('Cleared '+ks.length+' saved lookups and page reads.');drawSettings();return}
  if(a==='reset'){const last=S.last;S={last};save();applyTheme();applySize();applyMotion();drawSettings();toast('Settings reset to the defaults.');return}
  if(a==='signout-all'){if(!confirm('Sign out on every device, including this one?'))return;b.disabled=true;
    try{await fetch('/api/account/signout-all',{method:'POST',credentials:'same-origin'});location.href='/login'}catch(e){toast('Couldn’t sign out everywhere. Try again.','err');b.disabled=false}}}

/* ---------- the bar's buttons ---------- */
document.addEventListener('click',e=>{const t=e.target.closest('#mh-theme,#mh-open');if(!t)return;
  if(t.id==='mh-theme')setTheme(()=>effective()==='dark'?'light':'dark',t);else openSettings()});
addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key===','){e.preventDefault();open?close():openSettings()}});
const fr=g('lx-pfframe');if(fr)fr.addEventListener('load',syncFrame);
drawQuick();drawMe();
})();
