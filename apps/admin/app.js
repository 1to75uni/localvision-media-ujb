// LocalVision Admin (V3)
// - 공통 right 타겟(targets) + 전체패널(fullPanel) 설정
// - Player URL에 apiBase 자동 포함
// - Player 기본 restart=07:00

const $ = (id) => document.getElementById(id);

const state = {
  apiBase: "",
  playerBase: "https://localvision-media-ujb-player.pages.dev",
  r2PublicBase: "",
  stores: [],
  selected: null,
};

function qp(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function setApiUi(ok) {
  $("apiDot").className = "status-dot " + (ok ? "online" : "offline");
  $("apiBaseLabel").textContent = `API: ${state.apiBase || "-"}`;
}

function normalizeApiBase(v) {
  if (!v) return "";
  v = v.trim();
  return v.replace(/\/+$/, "");
}

async function api(path, options = {}) {
  if (!state.apiBase) throw new Error("apiBase가 비어있어요.");
  const url = state.apiBase + path;
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${t || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

function storeApiBase(v) {
  localStorage.setItem("lv_apiBase", v);
}

function loadStoredApiBase() {
  return qp("apiBase") || localStorage.getItem("lv_apiBase") || "";
}

async function testApi() {
  try {
    const meta = await api("/meta");
    state.playerBase = meta.playerBase || state.playerBase;
    state.r2PublicBase = meta.r2PublicBase || "";
    setApiUi(true);
    return true;
  } catch (e) {
    console.error(e);
    setApiUi(false);
    return false;
  }
}

function safeStoreId(v) {
  return (v || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildPlayerUrl(storeId) {
  const u = new URL(state.playerBase);
  u.searchParams.set("store", storeId);
  u.searchParams.set("apiBase", state.apiBase);
  // 기본 운영 옵션
  u.searchParams.set("restart", "07:00");
  u.searchParams.set("restartMode", "reload");
  u.searchParams.set("restartJitterSec", "0");
  u.searchParams.set("cacheMax", "20");
  return u.toString();
}

function copy(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function fmtTs(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function setTvStatus(status, lastSeen) {
  $("tvStatus").textContent = status || "UNKNOWN";
  $("tvLastSeen").textContent = lastSeen ? fmtTs(lastSeen) : "-";
  $("tvDot").className = "status-dot " + (status === "ONLINE" ? "online" : status === "OFFLINE" ? "offline" : "");
}

async function loadStores() {
  const stores = await api("/stores");
  state.stores = stores;
  renderStores();
}

function renderStores() {
  const wrap = $("storesList");
  wrap.innerHTML = "";
  if (!state.stores.length) {
    wrap.innerHTML = `<div class="muted">업체가 없습니다.</div>`;
    return;
  }
  for (const s of state.stores) {
    const div = document.createElement("div");
    div.className = "item" + (state.selected?.storeId === s.storeId ? " active" : "");
    div.innerHTML = `<div class="name">${escapeHtml(s.name || s.storeId)}</div><div class="id mono">${escapeHtml(s.storeId)}</div>`;
    div.onclick = () => selectStore(s.storeId);
    wrap.appendChild(div);
  }
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

async function selectStore(storeId) {
  state.selected = state.stores.find((x) => x.storeId === storeId) || { storeId };
  $("storeHint").textContent = `${state.selected.name || storeId} (${storeId})`;
  $("leftCard").style.display = "";
  $("statusCard").style.display = "";
  $("linksCard").style.display = "";
  $("playerUrl").textContent = buildPlayerUrl(storeId);
  renderStores();
  await Promise.all([loadLeftList(), loadStatus()]);
}

async function createStore() {
  const name = $("newName").value.trim();
  const storeIdRaw = $("newId").value.trim();
  const storeId = safeStoreId(storeIdRaw);
  if (!name || !storeId) {
    alert("업체명 / storeId를 입력해 주세요.");
    return;
  }
  await api("/stores", { method: "POST", body: JSON.stringify({ name, storeId }) });
  $("newName").value = "";
  $("newId").value = "";
  await loadStores();
  await selectStore(storeId);
}

async function loadLeftList() {
  if (!state.selected?.storeId) return;
  const res = await api(`/stores/${encodeURIComponent(state.selected.storeId)}/left`);
  const items = res.items || [];
  const tbody = $("leftList");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="muted">left 콘텐츠가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="mono">${escapeHtml(item.file)}</td><td class="right"><button class="danger small">삭제</button></td>`;
    tr.querySelector("button").onclick = async () => {
      if (!confirm(`${item.file} 삭제할까요?`)) return;
      await api(`/stores/${encodeURIComponent(state.selected.storeId)}/left/${encodeURIComponent(item.file)}`, { method: "DELETE" });
      await loadLeftList();
    };
    tbody.appendChild(tr);
  }
}

async function uploadLeft() {
  if (!state.selected?.storeId) return;
  const f = $("leftUpload").files?.[0];
  if (!f) return alert("업로드할 파일을 선택해 주세요.");
  const fd = new FormData();
  fd.append("file", f, f.name);
  await api(`/stores/${encodeURIComponent(state.selected.storeId)}/left`, { method: "POST", body: fd });
  $("leftUpload").value = "";
  await loadLeftList();
}

async function loadStatus() {
  if (!state.selected?.storeId) return;
  try {
    const s = await api(`/tv/status?store=${encodeURIComponent(state.selected.storeId)}`);
    setTvStatus(s.status, s.lastSeen);
  } catch (e) {
    console.warn(e);
    setTvStatus("UNKNOWN", null);
  }
}

function parseTargets(v) {
  return (v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function loadCommonRightList() {
  const res = await api("/common/right");
  const items = res.items || [];
  const tbody = $("rightList");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">공통 right 콘텐츠가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  for (const item of items) {
    const targetsStr = (item.targets || []).join(",");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(item.file)}<br/><a class="miniLink" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">열기</a></td>
      <td><input class="targetsInput" type="text" value="${escapeHtml(targetsStr)}" placeholder="ex) goobne,sbflower" /></td>
      <td class="nowrap"><label class="row" style="gap:8px;justify-content:flex-start"><input type="checkbox" ${item.fullPanel ? "checked" : ""}/> <span class="muted">ON</span></label></td>
      <td class="nowrap"><button class="small">저장</button></td>
      <td class="right nowrap"><button class="danger small">삭제</button></td>
    `;

    const targetsInput = tr.querySelector("input.targetsInput");
    const fullChk = tr.querySelector("input[type=checkbox]");
    const saveBtn = tr.querySelectorAll("button")[0];
    const delBtn = tr.querySelectorAll("button")[1];

    saveBtn.onclick = async () => {
      const payload = {
        file: item.file,
        targets: parseTargets(targetsInput.value),
        fullPanel: !!fullChk.checked,
      };
      await api("/common/right/meta", { method: "PUT", body: JSON.stringify(payload) });
      await loadCommonRightList();
      alert("저장됨!");
    };

    delBtn.onclick = async () => {
      if (!confirm(`${item.file} 삭제할까요?`)) return;
      await api(`/common/right/${encodeURIComponent(item.file)}`, { method: "DELETE" });
      await loadCommonRightList();
    };

    tbody.appendChild(tr);
  }
}

async function uploadCommonRight() {
  const f = $("rightUpload").files?.[0];
  if (!f) return alert("업로드할 파일을 선택해 주세요.");
  const fd = new FormData();
  fd.append("file", f, f.name);
  await api(`/common/right`, { method: "POST", body: fd });
  $("rightUpload").value = "";
  await loadCommonRightList();
}

function showQr(url) {
  const dlg = $("qrDialog");
  const canvas = $("qrCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  window.QRCode.toCanvas(canvas, url, { margin: 1, width: 280 }, (err) => {
    if (err) console.error(err);
  });
  dlg.showModal();
}

function wire() {
  $("apiBaseInput").value = state.apiBase;

  $("saveApiBtn").onclick = async () => {
    state.apiBase = normalizeApiBase($("apiBaseInput").value);
    if (!state.apiBase) return alert("apiBase를 입력해 주세요.");
    storeApiBase(state.apiBase);
    const ok = await testApi();
    if (!ok) return alert("API 테스트 실패. URL을 확인해 주세요.");
    await Promise.all([loadStores(), loadCommonRightList()]);
  };

  $("testApiBtn").onclick = async () => {
    state.apiBase = normalizeApiBase($("apiBaseInput").value);
    if (!state.apiBase) return alert("apiBase를 입력해 주세요.");
    storeApiBase(state.apiBase);
    const ok = await testApi();
    alert(ok ? "API OK" : "API 실패");
  };

  $("refreshStoresBtn").onclick = () => loadStores().catch(alertErr);
  $("createStoreBtn").onclick = () => createStore().catch(alertErr);

  $("leftRefreshBtn").onclick = () => loadLeftList().catch(alertErr);
  $("leftUploadBtn").onclick = () => uploadLeft().catch(alertErr);

  $("statusRefreshBtn").onclick = () => loadStatus().catch(alertErr);

  $("copyUrlBtn").onclick = () => {
    if (!state.selected?.storeId) return;
    const url = buildPlayerUrl(state.selected.storeId);
    copy(url);
    alert("복사됨!");
  };

  $("showQrBtn").onclick = () => {
    if (!state.selected?.storeId) return;
    const url = buildPlayerUrl(state.selected.storeId);
    showQr(url);
  };

  $("closeQrBtn").onclick = () => $("qrDialog").close();

  $("rightRefreshBtn").onclick = () => loadCommonRightList().catch(alertErr);
  $("rightUploadBtn").onclick = () => uploadCommonRight().catch(alertErr);
}

function alertErr(e) {
  console.error(e);
  alert(e?.message || String(e));
}

async function boot() {
  state.apiBase = normalizeApiBase(loadStoredApiBase());
  $("apiBaseInput").value = state.apiBase;

  if (!state.apiBase) {
    setApiUi(false);
    return;
  }

  const ok = await testApi();
  setApiUi(ok);

  if (ok) {
    await Promise.all([loadStores(), loadCommonRightList()]);
  }
}

wire();
boot().catch(alertErr);
