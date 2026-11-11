/* Menu Hauler: applies this device's appearance settings before the page draws, so it never flashes the wrong theme.
   build_apps.py puts it in the <head> of the launcher and the admin page. Settings are saved by shell.js in localStorage
   "mh.settings": {theme: system|light|dark, size: 0.9|1|1.1, motion: system|reduce, start: home|last|<tool>}. */
(()=>{let s={};try{s=JSON.parse(localStorage.getItem('mh.settings')||'{}')||{}}catch(e){}
const r=document.documentElement;
// claude.ai may set its own data-theme; keep it so "System" can go back to it
if(!r.hasAttribute('data-mh-host'))r.setAttribute('data-mh-host',r.getAttribute('data-theme')||'');
if(s.theme==='light'||s.theme==='dark')r.setAttribute('data-theme',s.theme);
if(s.motion==='reduce')r.classList.add('mh-still');
if(+s.size&&+s.size!==1)r.style.setProperty('--mh-zoom',String(+s.size));
})();
