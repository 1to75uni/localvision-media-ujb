// Admin V1 - no build
const API_BASE = (new URLSearchParams(location.search).get("apiBase")) || "https://REPLACE_WITH_YOUR_WORKER_URL";
const api = (path) => (API_BASE ? API_BASE.replace(/\/$/, '') : '') + path;

const els = {
  apiBase: document.getElementById('apiBase'),
  btnRefresh: document.getElementById('btnRefresh'),
  createForm: document.getElementById('createForm'),
  name: document.getElementById('name'),
  storeId: document.getElementById('storeId'),
  storeList: document.getElementById('storeList'),
  detail: document.getElementById('detail'),
  detailSub: document.getElementById('detailSub'),
  mediaList: document.getElementById('mediaList'),
  fileInput: document.getElementById('fileInput'),
  uploadStatus: document.getElementById('uploadStatus'),
  btnReloadMedia: document.getElementById('btnReloadMedia'),
  playerUrl: document.getElementById('playerUrl'),
  btnCopyPlayer: document.getElementById('btnCopyPlayer'),
  btnShowQR: document.getElementById('btnShowQR'),
  qrWrap: document.getElementById('qrWrap'),
  qrCanvas: document.getElementById('qrCanvas'),
  statusBadge: document.getElementById('statusBadge'),
  lastSeen: document.getElementById('lastSeen'),
  btnPing: document.getElementById('btnPing'),
};

els.apiBase.textContent = API_BASE || '(same-origin)';

let currentStore = null;

function fmtTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toLocaleString();
}

function setStatus(status, lastSeenMs) {
  els.statusBadge.textContent = status || 'UNKNOWN';
  els.statusBadge.className = 'px-2 py-1 rounded-lg ' + (status === 'ONLINE' ? 'bg-green-200' : status === 'OFFLINE' ? 'bg-rose-200' : 'bg-slate-200');
  els.lastSeen.textContent = fmtTime(lastSeenMs);
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || 'Invalid JSON' }; }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadStores() {
  const data = await fetchJSON(api('/api/stores'));
  els.storeList.innerHTML = '';
  data.items.forEach(s => {
    const li = document.createElement('li');
    li.className = 'border rounded-xl p-3 hover:bg-slate-50 cursor-pointer';
    li.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold">${s.name}</div>
          <div class="text-xs text-slate-500 font-mono">${s.storeId}</div>
        </div>
        <span class="text-xs px-2 py-1 rounded-lg ${s.status === 'ONLINE' ? 'bg-green-200' : s.status === 'OFFLINE' ? 'bg-rose-200' : 'bg-slate-200'}">${s.status || 'UNKNOWN'}</span>
      </div>
    `;
    li.onclick = () => selectStore(s.storeId);
    els.storeList.appendChild(li);
  });
}

async function selectStore(storeId) {
  const data = await fetchJSON(api('/api/stores/' + encodeURIComponent(storeId)));
  currentStore = data.store;
  els.detailSub.textContent = `${currentStore.name} (${currentStore.storeId})`;
  els.detail.classList.remove('hidden');
  els.btnCopyPlayer.classList.remove('hidden');
  els.btnShowQR.classList.remove('hidden');

  els.playerUrl.textContent = data.playerUrl;
  els.btnCopyPlayer.onclick = async () => {
    await navigator.clipboard.writeText(data.playerUrl);
    alert('복사 완료!');
  };
  els.btnShowQR.onclick = async () => {
    els.qrWrap.classList.toggle('hidden');
    if (!els.qrWrap.classList.contains('hidden')) {
      QRCode.toCanvas(els.qrCanvas, data.playerUrl, { width: 220 });
    }
  };

  setStatus(data.status?.status, data.status?.lastSeen);

  await loadMedia();
}

async function loadMedia() {
  if (!currentStore) return;
  const data = await fetchJSON(api(`/api/stores/${encodeURIComponent(currentStore.storeId)}/media?side=left`));
  els.mediaList.innerHTML = '';
  if (!data.items.length) {
    els.mediaList.innerHTML = '<div class="text-sm text-slate-500">아직 업로드된 콘텐츠가 없습니다.</div>';
    return;
  }
  data.items.forEach(m => {
    const row = document.createElement('div');
    row.className = 'border rounded-xl p-3 flex items-center justify-between gap-2';
    row.innerHTML = `
      <div>
        <div class="font-mono text-sm">left_${m.slot}</div>
        <div class="text-xs text-slate-500">${m.mime}</div>
      </div>
      <a class="text-xs px-3 py-2 rounded-xl border" href="${m.url}" target="_blank">열기</a>
    `;
    els.mediaList.appendChild(row);
  });
}

async function uploadFileMultipart(file) {
  // 1) init -> key/uploadId/slot/url
  els.uploadStatus.textContent = `초기화 중... (${file.name})`;
  const init = await fetchJSON(api(`/api/stores/${encodeURIComponent(currentStore.storeId)}/upload/init`), {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ side:'left', filename: file.name, mime: file.type || 'application/octet-stream', size: file.size })
  });

  const { key, uploadId, slot, url } = init;
  const chunkSize = 10 * 1024 * 1024; // 10MB
  const totalParts = Math.ceil(file.size / chunkSize);

  const parts = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber-1) * chunkSize;
    const end = Math.min(partNumber * chunkSize, file.size);
    const blob = file.slice(start, end);

    els.uploadStatus.textContent = `업로드 중... left_${slot} (파트 ${partNumber}/${totalParts})`;

    const partRes = await fetch(api(`/api/stores/${encodeURIComponent(currentStore.storeId)}/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob
    });
    if (!partRes.ok) {
      const t = await partRes.text();
      throw new Error(`파트 업로드 실패: ${t}`);
    }
    const partJson = await partRes.json();
    parts.push({ partNumber, etag: partJson.etag });
  }

  els.uploadStatus.textContent = `완료 처리 중... left_${slot}`;
  await fetchJSON(api(`/api/stores/${encodeURIComponent(currentStore.storeId)}/upload/complete`), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ key, uploadId, parts, side:'left', slot, mime: file.type || 'application/octet-stream', url })
  });

  els.uploadStatus.textContent = `업로드 완료: left_${slot}`;
}

els.btnRefresh.onclick = () => loadStores().catch(e => alert(e.message));

els.createForm.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const payload = { name: els.name.value.trim(), storeId: els.storeId.value.trim() };
    await fetchJSON(api('/api/stores'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    els.name.value = ''; els.storeId.value = '';
    await loadStores();
  } catch (err) {
    alert(err.message);
  }
};

els.btnReloadMedia.onclick = () => loadMedia().catch(e => alert(e.message));

els.fileInput.onchange = async () => {
  if (!currentStore) return;
  const files = Array.from(els.fileInput.files || []);
  if (!files.length) return;
  try {
    for (const f of files) {
      await uploadFileMultipart(f);
    }
    await loadMedia();
  } catch (err) {
    alert(err.message);
  } finally {
    els.fileInput.value = '';
  }
};

els.btnPing.onclick = async () => {
  if (!currentStore) return;
  try {
    const data = await fetchJSON(api(`/api/status?storeId=${encodeURIComponent(currentStore.storeId)}`));
    setStatus(data.status, data.lastSeen);
    await loadStores();
  } catch (e) {
    alert(e.message);
  }
};

// boot
loadStores().catch(e => alert(e.message));
