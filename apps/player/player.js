// Player V1
const params = new URLSearchParams(location.search);
const storeId = params.get('store') || 'demo';
const deviceId = localStorage.getItem('lv_deviceId') || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
localStorage.setItem('lv_deviceId', deviceId);

const API_BASE = (new URLSearchParams(location.search).get("apiBase")) || "https://REPLACE_WITH_YOUR_WORKER_URL";
const api = (path) => (API_BASE ? API_BASE.replace(/\/$/, '') : '') + path;

const leftSlot = document.getElementById('leftSlot');
const rightSlot = document.getElementById('rightSlot');
const debug = document.getElementById('debug');

function log(s){ debug.textContent = s; }

async function fetchJSON(url, options){
  const res = await fetch(url, options);
  const t = await res.text();
  let d; try{ d = JSON.parse(t);}catch{ d={error:t}; }
  if(!res.ok) throw new Error(d.error || res.statusText);
  return d;
}

function showMedia(container, item){
  container.innerHTML = '';
  if (!item) return;
  if (item.type === 'video') {
    const v = document.createElement('video');
    v.src = item.url;
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.loop = false;
    v.preload = 'auto';
    v.onended = () => item._onEnded && item._onEnded();
    v.onerror = () => item._onEnded && item._onEnded();
    container.appendChild(v);
    v.play().catch(()=>{});
  } else {
    const im = document.createElement('img');
    im.src = item.url;
    im.onload = () => {};
    im.onerror = () => {};
    container.appendChild(im);
    // 이미지 기본 8초
    setTimeout(()=> item._onEnded && item._onEnded(), item.durationMs || 8000);
  }
}

function playlistRunner(container, list){
  let idx = 0;
  const next = () => {
    if (!list.length) return;
    const item = {...list[idx]};
    item._onEnded = () => { idx = (idx+1) % list.length; next(); };
    showMedia(container, item);
  };
  next();
}

async function heartbeat(){
  try{
    await fetch(api('/api/heartbeat'), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ storeId, deviceId, role:'tv', ua:navigator.userAgent })
    });
  }catch(e){}
}

async function boot(){
  log(`loading... store=${storeId}`);
  const cfg = await fetchJSON(api(`/api/player/config?storeId=${encodeURIComponent(storeId)}`));
  playlistRunner(leftSlot, cfg.left || []);
  playlistRunner(rightSlot, cfg.right || []);
  log(`store=${storeId} | device=${deviceId} | left=${(cfg.left||[]).length} right=${(cfg.right||[]).length}`);
  heartbeat();
  setInterval(heartbeat, 30_000);
  // config refresh 60s
  setInterval(async ()=>{
    try{
      const ncfg = await fetchJSON(api(`/api/player/config?storeId=${encodeURIComponent(storeId)}`));
      // V1: 간단하게 reload
      location.reload();
    }catch(e){}
  }, 600_000); // 10분
}

boot().catch(e => log('ERR: ' + e.message));
