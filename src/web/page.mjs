// Landing + dashboard, styled to match the Sprock app: dark navy canvas,
// cream text, amber accent, Fraunces display + JetBrains Mono eyebrows,
// cards with a 2pt category-colored top strip.
export function renderPage() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shared Memory — one board for all your AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#1f2530;--card:#2a303d;--deep:#171c26;--elev:#333a49;
    --cream:#f6ecd0;--dim:rgba(246,236,208,.65);--dim2:rgba(246,236,208,.50);--dim3:rgba(246,236,208,.35);
    --line:rgba(246,236,208,.14);--line2:rgba(246,236,208,.20);
    --amber:#e8b84a;--orange:#d96c3e;--pink:#c94a7a;--green:#8fcfae;--blue:#3f6fd1;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--cream);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
  .wrap{max-width:720px;margin:0 auto;padding:44px 22px 90px}
  .serif{font-family:"Fraunces",Georgia,serif}
  h1{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:40px;line-height:1.05;letter-spacing:-.01em;margin:.1em 0}
  h2{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:19px;margin:0 0 12px}
  p.lede{font-size:18px;color:var(--dim);margin:.4em 0 0}
  .eyebrow{font-family:"JetBrains Mono",monospace;font-weight:500;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim2)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:16px 0}
  button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 20px;background:var(--amber);color:#1b1b1b;cursor:pointer}
  button.ghost{background:var(--elev);color:var(--cream)}
  button:active{transform:translateY(1px)}
  code,.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:12.5px}
  .field{display:flex;gap:8px;align-items:center;background:var(--deep);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;word-break:break-all}
  .field .mono{flex:1;color:var(--cream)}
  .copy{padding:6px 12px;font-size:13px}
  ol{padding-left:20px} li{margin:10px 0;color:var(--dim)}
  li b{color:var(--cream)}
  .muted{color:var(--dim)} .small{font-size:13px} .hidden{display:none}
  .pill{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.1em;background:var(--elev);border-radius:999px;padding:3px 10px;color:var(--amber)}
  /* activity cards — Sprock style: 2pt category top strip */
  .ci{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;margin:10px 0;overflow:hidden;
    display:flex;gap:14px;align-items:flex-start;padding:16px 18px 15px}
  .ci::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:var(--strip,var(--amber))}
  .ci-ic{font-size:18px;line-height:1.2;margin-top:1px}
  .ci-body{flex:1;min-width:0}
  .ci-ey{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--strip,var(--dim2));margin-bottom:5px}
  .ci-tx{font-family:"Fraunces",Georgia,serif;font-size:16px;line-height:1.4;color:var(--cream)}
  .ci-meta{font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.04em;color:var(--dim3);margin-top:7px;text-transform:uppercase}
  .ci-acts{display:flex;gap:7px;flex-shrink:0}
  .act{width:32px;height:32px;padding:0;border-radius:50%;font-size:14px;background:var(--elev);color:var(--cream)}
  .act.done:hover{background:rgba(143,207,174,.22);color:var(--green)}
  .act.dismiss:hover{background:rgba(217,108,62,.22);color:var(--orange)}
  .fact{border-bottom:1px solid var(--line);padding:9px 0;color:var(--dim)}
  .fact .tags{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--amber)}
  a{color:var(--amber)}
  .live{color:var(--green)}
</style></head>
<body><div class="wrap">
  <div class="eyebrow">Shared Memory</div>
  <h1>One board for all your&nbsp;AI</h1>
  <p class="lede">Muse, Claude, and ChatGPT on one surface. What they flag shows up as cards — tap to clear, and every assistant knows it's done.</p>

  <div id="signup" class="card">
    <h2>Create your board</h2>
    <p class="muted small">No email. You get a private board and a secret key — keep it safe.</p>
    <button id="create">Create my board →</button>
    <p class="small muted" style="margin-top:14px">Already have a key? <a href="#" id="havekey">Enter it</a></p>
    <div id="keyin" class="hidden"><div class="field"><input class="mono" id="keyval" placeholder="sm_… or your token" style="flex:1;border:0;background:transparent;outline:none;color:var(--cream)"><button class="copy" id="usekey">Use</button></div></div>
  </div>

  <div id="dash" class="hidden">
    <div class="card">
      <h2>Activity <span class="pill live" id="live">● LIVE</span></h2>
      <p class="small muted" style="margin-top:-4px">Things as they happen. Tap ✓ done or ✕ dismiss — it clears for every assistant.</p>
      <div id="feed"><p class="muted small">Waiting for activity…</p></div>
    </div>

    <div class="card">
      <h2>Your connection</h2>
      <div class="field"><span class="eyebrow">URL</span><span class="mono" id="url"></span><button class="ghost copy" data-c="url">Copy</button></div>
      <div class="field"><span class="eyebrow">Token</span><span class="mono" id="tok"></span><button class="ghost copy" data-c="tok">Copy</button></div>
      <ol style="margin-top:14px">
        <li><b>Muse</b> — say: <i>"Build a custom connector to the MCP server at <span class="mono" id="m1"></span> with Authorization header Bearer &lt;token&gt;."</i></li>
        <li><b>ChatGPT / Claude</b> — Settings → Connectors → add the URL + bearer token.</li>
      </ol>
    </div>

    <div class="card">
      <h2>Knowledge <span class="pill" id="count">0</span></h2>
      <p class="small muted" style="margin-top:-4px">The durable facts your assistants share about you.</p>
      <div id="facts"><p class="muted small">Empty for now.</p></div>
    </div>
    <p class="small muted">Key saved in this browser. <a href="#" id="forget">Forget key</a>.</p>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
const base=location.origin, mcp=base+'/mcp';
const urlTok=new URLSearchParams(location.search).get('token');
let token=urlTok||localStorage.getItem('sm_token');
if(urlTok){localStorage.setItem('sm_token',urlTok);history.replaceState({},'',location.pathname);}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
const ago=t=>{const s=(Date.now()-new Date(t))/1000;if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';};
const STRIP={alert:'var(--orange)',deadline:'var(--amber)',email:'var(--orange)',calendar:'var(--blue)',payment:'var(--amber)',task:'var(--green)',action:'var(--amber)',status:'var(--blue)'};
const ICON={alert:'🚨',deadline:'⏰',email:'✉️',calendar:'📅',task:'✅',action:'⚡',status:'🔔',payment:'💳',event:'•'};

async function signup(){
  const r=await fetch('/api/signup',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const j=await r.json(); token=j.token; localStorage.setItem('sm_token',token); show();
}
async function load(){
  const r=await fetch('/api/me',{headers:{Authorization:'Bearer '+token}});
  if(!r.ok){localStorage.removeItem('sm_token');token=null;show();return;}
  const j=await r.json(); $('#count').textContent=j.stats.total;
  const el=$('#facts');
  el.innerHTML=j.facts.length?j.facts.slice(0,40).map(f=>'<div class="fact">'+esc(f.text)+' <span class="tags">'+(f.tags||[]).map(t=>'#'+esc(t)).join(' ')+'</span></div>').join(''):'<p class="muted small">Empty for now.</p>';
}
function cardHtml(e){const strip=STRIP[e.type]||'var(--dim2)';const ic=ICON[e.type]||'•';
  return '<div class="ci" data-id="'+e.id+'" style="--strip:'+strip+'">'
    +'<div class="ci-ic">'+ic+'</div>'
    +'<div class="ci-body"><div class="ci-ey">'+esc(e.type||'item')+'</div><div class="ci-tx">'+esc(e.text)+'</div>'
    +'<div class="ci-meta">'+esc(e.source||'')+' · '+ago(e.ts)+'</div></div>'
    +'<div class="ci-acts"><button class="act done" title="Done">✓</button><button class="act dismiss" title="Dismiss">✕</button></div></div>';}
async function loadEvents(){
  const r=await fetch('/api/events?open=1',{headers:{Authorization:'Bearer '+token}}); if(!r.ok)return;
  const items=(await r.json()).events.filter(e=>e.type!=='learned'&&e.type!=='resolved');
  const el=$('#feed');
  el.innerHTML=items.length?items.map(cardHtml).join(''):'<p class="muted small">All clear — nothing open.</p>';
  el.querySelectorAll('.ci').forEach(c=>{const id=c.dataset.id;
    c.querySelector('.done').onclick=()=>resolve(id,'done',c);
    c.querySelector('.dismiss').onclick=()=>resolve(id,'dismissed',c);});
}
async function resolve(id,status,el){
  el.style.opacity=.3;el.style.pointerEvents='none';
  await fetch('/api/events/'+id+'/resolve',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({status})});
  el.style.transition='all .25s';el.style.height='0';el.style.margin='0';el.style.padding='0';el.style.border='0';setTimeout(()=>el.remove(),260);
}
let es=null;
function streamEvents(){
  if(es)es.close();
  es=new EventSource('/api/events/stream?token='+encodeURIComponent(token));
  es.onmessage=()=>loadEvents();
  es.onerror=()=>{$('#live').textContent='● RECONNECTING';};
  es.onopen=()=>{$('#live').textContent='● LIVE';};
}
function show(){
  if(token){$('#signup').classList.add('hidden');$('#dash').classList.remove('hidden');
    $('#url').textContent=mcp;$('#m1').textContent=mcp;$('#tok').textContent=token;load();loadEvents();streamEvents();}
  else{$('#signup').classList.remove('hidden');$('#dash').classList.add('hidden');if(es)es.close();}
}
$('#create').onclick=signup;
$('#havekey').onclick=e=>{e.preventDefault();$('#keyin').classList.toggle('hidden');};
$('#usekey').onclick=()=>{const v=$('#keyval').value.trim();if(!v)return;token=v;localStorage.setItem('sm_token',v);show();};
$('#forget').onclick=e=>{e.preventDefault();localStorage.removeItem('sm_token');token=null;show();};
document.querySelectorAll('.copy[data-c]').forEach(b=>b.onclick=()=>{
  const map={url:mcp,tok:token}; navigator.clipboard.writeText(map[b.dataset.c]); b.textContent='Copied'; setTimeout(()=>b.textContent='Copy',1200);
});
show();
</script></body></html>`;
}
