// The landing + dashboard page, served at /. Single-page vanilla JS:
// signup issues a personal token; the dashboard shows the connect steps and
// a live view of that user's memory.
export function renderPage() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shared Memory — one memory for all your AI assistants</title>
<style>
  :root{--ink:#161616;--muted:#6b6b6b;--line:#e8e8e8;--accent:#1769ff;--bg:#fff;--chip:#f4f4f5}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;color:var(--ink);background:var(--bg)}
  .wrap{max-width:760px;margin:0 auto;padding:40px 22px 80px}
  h1{font-size:34px;letter-spacing:-.02em;margin:.2em 0}
  h2{font-size:18px;margin:28px 0 10px}
  p.lede{font-size:18px;color:var(--muted);margin-top:0}
  .card{border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
  button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 20px;background:var(--ink);color:#fff;cursor:pointer}
  button.ghost{background:var(--chip);color:var(--ink)}
  button:active{transform:translateY(1px)}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
  .field{display:flex;gap:8px;align-items:center;background:var(--chip);border-radius:10px;padding:10px 12px;margin:8px 0;word-break:break-all}
  .field .mono{flex:1}
  .copy{padding:6px 12px;font-size:13px}
  ol{padding-left:20px} li{margin:8px 0}
  .fact{border-bottom:1px solid var(--line);padding:9px 0}
  .fact .tags{color:var(--accent);font-size:12px}
  .muted{color:var(--muted)} .small{font-size:13px}
  .hidden{display:none}
  .pill{display:inline-block;background:var(--chip);border-radius:999px;padding:2px 10px;font-size:12px;margin-right:6px}
</style></head>
<body><div class="wrap">
  <h1>One memory for all your AI&nbsp;assistants</h1>
  <p class="lede">Connect ChatGPT, Claude, and Muse to a single memory they all read and write. Tell one thing once — the rest already know.</p>

  <div id="signup" class="card">
    <h2 style="margin-top:0">Create your shared memory</h2>
    <p class="muted small">No email needed. You get a private memory and a secret key. Keep the key safe — anyone with it can read your memory.</p>
    <button id="create">Create my memory →</button>
  </div>

  <div id="dash" class="hidden">
    <div class="card">
      <h2 style="margin-top:0">Activity <span class="pill" id="live">● live</span></h2>
      <p class="small muted">Things as they happen — what your assistants learn and do, in real time.</p>
      <div id="feed"><p class="muted small">Waiting for activity…</p></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Your connection</h2>
      <p class="small muted">Paste these into each assistant once. The behavior (search memory, save facts) is built in — you don't configure anything else.</p>
      <div class="field"><span class="muted small">URL</span><span class="mono" id="url"></span><button class="ghost copy" data-c="url">Copy</button></div>
      <div class="field"><span class="muted small">Token</span><span class="mono" id="tok"></span><button class="ghost copy" data-c="tok">Copy</button></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Connect your assistants</h2>
      <ol>
        <li><b>Muse</b> — in a chat, say: <i>"Build a custom connector to the MCP server at <span class="mono" id="m1"></span> using the Authorization header <span class="mono">Bearer &lt;your token&gt;</span>."</i></li>
        <li><b>ChatGPT</b> (Plus/Pro) — Settings → Connectors → add a custom connector with the URL above and the bearer token.</li>
        <li><b>Claude</b> — Settings → Connectors → add a custom connector with the URL above and the bearer token.</li>
      </ol>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Your memory <span class="pill" id="count">0</span></h2>
      <div id="facts"><p class="muted small">Empty for now — it fills as your assistants learn about you.</p></div>
      <button class="ghost small" id="refresh" style="margin-top:12px">Refresh</button>
    </div>
    <p class="small muted">Lost this page? Your key is saved in this browser. <a href="#" id="forget">Forget key</a> to start fresh.</p>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
const base=location.origin, mcp=base+'/mcp';
let token=localStorage.getItem('sm_token');

async function signup(){
  const r=await fetch('/api/signup',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const j=await r.json(); token=j.token; localStorage.setItem('sm_token',token); show();
}
async function load(){
  const r=await fetch('/api/me',{headers:{Authorization:'Bearer '+token}});
  if(!r.ok){localStorage.removeItem('sm_token');token=null;show();return;}
  const j=await r.json();
  $('#count').textContent=j.stats.total;
  const el=$('#facts');
  if(!j.facts.length){el.innerHTML='<p class="muted small">Empty for now — it fills as your assistants learn about you.</p>';return;}
  el.innerHTML=j.facts.map(f=>'<div class="fact">'+esc(f.text)+' <span class="tags">'+(f.tags||[]).map(t=>'#'+esc(t)).join(' ')+'</span></div>').join('');
}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
let es=null;
const ago=t=>{const s=(Date.now()-new Date(t))/1000;if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';};
function evHtml(e){const ic={learned:'🧠',action:'⚡',email:'✉️',calendar:'📅',deadline:'⏰',status:'🔔'}[e.type]||'•';
  return '<div class="fact"><span>'+ic+'</span> '+esc(e.text)+' <span class="tags">'+esc(e.source||'')+' · '+ago(e.ts)+'</span></div>';}
async function loadEvents(){
  const r=await fetch('/api/events',{headers:{Authorization:'Bearer '+token}}); if(!r.ok)return;
  const j=await r.json(); const el=$('#feed');
  el.innerHTML=j.events.length?j.events.map(evHtml).join(''):'<p class="muted small">No activity yet — it appears here the moment an assistant learns or does something.</p>';
}
function streamEvents(){
  if(es)es.close();
  es=new EventSource('/api/events/stream?token='+encodeURIComponent(token));
  es.onmessage=ev=>{try{const e=JSON.parse(ev.data);const el=$('#feed');
    if(el.querySelector('p'))el.innerHTML='';
    el.insertAdjacentHTML('afterbegin',evHtml(e));}catch{}};
  es.onerror=()=>{$('#live').textContent='● reconnecting';};
  es.onopen=()=>{$('#live').textContent='● live';};
}
function show(){
  if(token){$('#signup').classList.add('hidden');$('#dash').classList.remove('hidden');
    $('#url').textContent=mcp;$('#m1').textContent=mcp;$('#tok').textContent=token;load();loadEvents();streamEvents();}
  else{$('#signup').classList.remove('hidden');$('#dash').classList.add('hidden');if(es)es.close();}
}
$('#create').onclick=signup;
$('#refresh').onclick=load;
$('#forget').onclick=e=>{e.preventDefault();localStorage.removeItem('sm_token');token=null;show();};
document.querySelectorAll('.copy').forEach(b=>b.onclick=()=>{
  const map={url:mcp,tok:token}; navigator.clipboard.writeText(map[b.dataset.c]); b.textContent='Copied'; setTimeout(()=>b.textContent='Copy',1200);
});
show();
</script></body></html>`;
}
