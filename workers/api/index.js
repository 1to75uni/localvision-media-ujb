/**
 * LocalVision Worker API (V3)
 * - Admin: store create + left upload/manage
 * - Common Right: upload/manage + meta(targets/fullPanel)
 * - TV status: /tv/heartbeat, /tv/status
 * - Playlist generator: stores/<store>/left/playlist.json + stores/_common/right/playlist.json (R2)
 */

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const text = (s, status = 200, headers = {}) =>
  new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

function safeStoreId(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseUrl(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  return { url, path };
}

function extFromType(type) {
  if (!type) return "";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpg") || type.includes("jpeg")) return "jpg";
  return "bin";
}

function mediaTypeFromKey(key) {
  const k = String(key || "").toLowerCase();
  return k.endsWith(".mp4") ? "video" : "image";
}

function guessDurationSecFromKey(key) {
  // 이미지 기본 10초, 영상은 null(ended 기준)
  return mediaTypeFromKey(key) === "image" ? 10 : null;
}

function baseName(key) {
  const parts = String(key).split("/");
  return parts[parts.length - 1];
}

async function ensureTables(env) {
  // D1: tv_status
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS tv_status (
      store_id TEXT PRIMARY KEY,
      last_seen INTEGER NOT NULL
    );
  `);
}

async function listStorePrefixes(env) {
  // stores/<store>/left/ 의 prefix 목록
  const res = await env.MEDIA.list({ prefix: "stores/", delimiter: "/" });
  const stores = [];
  for (const p of res.delimitedPrefixes || []) {
    const m = /^stores\/([^/]+)\/$/.exec(p);
    if (!m) continue;
    const id = m[1];
    if (id) stores.push(id);
  }
  // _common은 운영용이라 store 목록에서 제외
  return stores.filter((s) => s !== "_common").sort();
}

async function ensureStoreFolders(env, storeId) {
  // R2는 폴더가 없어도 되지만, 목록/가독성을 위해 placeholder를 둠
  const leftKey = `stores/${storeId}/left/.keep`;
  const exists = await env.MEDIA.head(leftKey);
  if (!exists) {
    await env.MEDIA.put(leftKey, "", { httpMetadata: { contentType: "text/plain" } });
  }
}

// -------- R2 JSON helpers --------
async function readJsonFromR2(env, key, fallback) {
  try {
    const obj = await env.MEDIA.get(key);
    if (!obj) return fallback;
    const txt = await obj.text();
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function writeJsonToR2(env, key, value) {
  await env.MEDIA.put(key, JSON.stringify(value, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

// -------- Right meta --------
const RIGHT_META_KEY = "stores/_common/right/meta.json";

function normalizeTargets(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

async function loadRightMeta(env) {
  const meta = await readJsonFromR2(env, RIGHT_META_KEY, { items: [] });
  if (!meta || !Array.isArray(meta.items)) return { items: [] };
  // normalize
  meta.items = meta.items
    .map((x) => ({
      file: String(x.file || "").trim(),
      targets: normalizeTargets(x.targets),
      fullPanel: !!x.fullPanel,
      durationSec: Number.isFinite(x.durationSec) ? x.durationSec : undefined,
    }))
    .filter((x) => x.file);
  return meta;
}

async function saveRightMeta(env, meta) {
  const safe = { items: Array.isArray(meta.items) ? meta.items : [] };
  await writeJsonToR2(env, RIGHT_META_KEY, safe);
}

async function syncRightMetaWithKeys(env, rightKeys) {
  const meta = await loadRightMeta(env);
  const files = rightKeys.map(baseName);
  const byFile = new Map(meta.items.map((x) => [x.file, x]));

  // add missing
  for (const f of files) {
    if (!byFile.has(f)) {
      byFile.set(f, { file: f, targets: [], fullPanel: false });
    }
  }

  // remove stale
  for (const f of Array.from(byFile.keys())) {
    if (!files.includes(f)) byFile.delete(f);
  }

  meta.items = Array.from(byFile.values()).sort((a, b) => a.file.localeCompare(b.file));
  await saveRightMeta(env, meta);
  return meta;
}

function metaForFile(meta, file) {
  const it = meta?.items?.find((x) => x.file === file);
  return it || { targets: [], fullPanel: false };
}

// -------- Playlist generator --------
async function listMediaKeys(env, storeId, side) {
  const prefix = `stores/${storeId}/${side}/`;
  const res = await env.MEDIA.list({ prefix });
  const out = [];
  for (const obj of res.objects || []) {
    if (!obj.key) continue;
    if (obj.key.endsWith(".keep")) continue;
    if (obj.key.endsWith("/playlist.json")) continue;
    if (obj.key.endsWith("/meta.json")) continue;
    if (!/\.(mp4|jpg|jpeg|png|webp)$/i.test(obj.key)) continue;
    out.push(obj.key);
  }
  // left_1, left_2 ... 정렬 / right_1 ... 정렬
  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return out;
}

async function writePlaylist(env, key, items) {
  const payload = { updatedAt: Date.now(), items };
  await writeJsonToR2(env, key, payload);
}

async function refreshPlaylists(env, storeId) {
  // left
  const leftKeys = await listMediaKeys(env, storeId, "left");
  const leftItems = leftKeys.map((k) => ({
    url: `${env.R2_PUBLIC_BASE}/${k}`,
    key: k,
    type: mediaTypeFromKey(k),
    durationSec: guessDurationSecFromKey(k),
  }));
  await writePlaylist(env, `stores/${storeId}/left/playlist.json`, leftItems);

  // right(common)
  const rightKeys = await listMediaKeys(env, "_common", "right");
  const meta = await syncRightMetaWithKeys(env, rightKeys);

  const rightItems = rightKeys.map((k) => {
    const file = baseName(k);
    const m = metaForFile(meta, file);
    return {
      url: `${env.R2_PUBLIC_BASE}/${k}`,
      key: k,
      file,
      type: mediaTypeFromKey(k),
      durationSec: Number.isFinite(m.durationSec) ? m.durationSec : guessDurationSecFromKey(k),
      targets: m.targets || [],
      fullPanel: !!m.fullPanel,
    };
  });
  await writePlaylist(env, `stores/_common/right/playlist.json`, rightItems);
}

async function nextSlot(env, storeId, side) {
  // left_1, left_2 ... or right_1...
  const keys = await listMediaKeys(env, storeId, side);
  const prefix = side === "left" ? "left_" : "right_";
  let max = 0;
  for (const k of keys) {
    const f = baseName(k);
    const m = new RegExp(`^${prefix}(\\d+)\\.`).exec(f);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

// -------- TV status --------
async function tvHeartbeat(env, storeId) {
  await ensureTables(env);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO tv_status(store_id,last_seen) VALUES(?,?)
    ON CONFLICT(store_id) DO UPDATE SET last_seen=excluded.last_seen`)
    .bind(storeId, now)
    .run();
  return now;
}

async function tvStatus(env, storeId) {
  await ensureTables(env);
  const row = await env.DB.prepare(`SELECT store_id,last_seen FROM tv_status WHERE store_id=?`).bind(storeId).first();
  const last = row?.last_seen || null;
  const ttl = parseInt(env.ONLINE_TTL_SEC || "120", 10) || 120;
  const now = Date.now();
  let status = "UNKNOWN";
  if (last) status = (now - last <= ttl * 1000) ? "ONLINE" : "OFFLINE";
  return { status, lastSeen: last };
}

// -------- HTTP handlers --------
export default {
  async fetch(req, env) {
    const { url, path: rawPath } = parseUrl(req);
    let path = rawPath;
    // legacy: allow API base to include "/api"
    if (path === "/api") path = "";
    if (path.startsWith("/api/")) path = path.slice(4);
    if (req.method === "OPTIONS") return withCors(new Response("", { status: 204 }));

    try {
      // health
      if (path === "" || path === "/") return withCors(text("ok"));

      // meta (admin/player가 base 얻을 때)
      if (path === "/meta" && req.method === "GET") {
        return withCors(json({
          ok: true,
          r2PublicBase: env.R2_PUBLIC_BASE,
          playerBase: env.PLAYER_BASE,
          onlineTtlSec: parseInt(env.ONLINE_TTL_SEC || "120", 10) || 120,
        }));
      }

      // stores list
      

// ------------------------------------------------------------
// Legacy compatibility routes (for older Player URLs)
// - /heartbeat (POST)  : alias of /tv/heartbeat
// - /status (GET)      : alias of /tv/status
// - /playlist.json     : serve left/right playlist from R2
// ------------------------------------------------------------

if (path === "/heartbeat" && req.method === "POST") {
  const body = await safeJson(req);
  const storeId = safeStoreId(body?.store || body?.storeId || "");
  if (!storeId) return withCors(json({ ok: false, error: "store is required" }, 400));
  const ts = await tvHeartbeat(env, storeId);
  return withCors(json({ ok: true, store: storeId, lastSeen: ts }));
}

if (path === "/status" && req.method === "GET") {
  const storeId = safeStoreId(url.searchParams.get("store") || "");
  if (!storeId) return withCors(json({ ok: false, error: "store is required" }, 400));
  const st = await tvStatus(env, storeId);
  // Player expects { online, lastSeen }
  return withCors(json({ online: st.status === "ONLINE", lastSeen: st.lastSeen }));
}

if (path === "/playlist.json" && req.method === "GET") {
  const storeId = safeStoreId(url.searchParams.get("store") || "");
  const sideRaw = (url.searchParams.get("side") || "left").toLowerCase();
  const side = sideRaw === "right" ? "right" : "left";
  if (!storeId) return withCors(json({ ok: false, error: "store is required" }, 400));

  // left  -> stores/<store>/left/playlist.json
  // right -> prefer stores/<store>/right/playlist.json, fallback to stores/_common/right/playlist.json
  if (side === "right") {
    const storeKey = `stores/${storeId}/right/playlist.json`;
    const storeObj = await env.MEDIA.get(storeKey);
    if (storeObj) {
      const txt = await storeObj.text();
      const payload = (() => { try { return JSON.parse(txt); } catch { return null; } })();
      const out = (payload && !Array.isArray(payload) && Array.isArray(payload.items)) ? JSON.stringify(payload.items) : txt;
      return withCors(new Response(out, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }
      }));
    }
    const commonObj = await env.MEDIA.get(`stores/_common/right/playlist.json`);
    if (!commonObj) {
      return withCors(new Response("[]", {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }
      }));
    }
    const txt = await commonObj.text();
    const payload = (() => { try { return JSON.parse(txt); } catch { return null; } })();
    const out = (payload && !Array.isArray(payload) && Array.isArray(payload.items)) ? JSON.stringify(payload.items) : txt;
    return withCors(new Response(out, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }
    }));
  }

  const obj = await env.MEDIA.get(`stores/${storeId}/left/playlist.json`);
  if (!obj) {
    return withCors(new Response("[]", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }
    }));
  }
  const txt = await obj.text();
  const payload = (() => { try { return JSON.parse(txt); } catch { return null; } })();
  const out = (payload && !Array.isArray(payload) && Array.isArray(payload.items)) ? JSON.stringify(payload.items) : txt;
  return withCors(new Response(out, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }
  }));
}
if (path === "/stores" && req.method === "GET") {
        const ids = await listStorePrefixes(env);
        const stores = ids.map((id) => ({ storeId: id, name: id }));
        return withCors(json(stores));
      }

      // create store
      if (path === "/stores" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const storeId = safeStoreId(body.storeId);
        const name = String(body.name || storeId);
        if (!storeId) return withCors(json({ ok: false, error: "invalid storeId" }, 400));
        await ensureStoreFolders(env, storeId);
        await refreshPlaylists(env, storeId);
        return withCors(json({ ok: true, storeId, name }));
      }

      // left list
      if (path.startsWith("/stores/") && path.endsWith("/left") && req.method === "GET") {
        const storeId = path.split("/")[2];
        const keys = await listMediaKeys(env, storeId, "left");
        const items = keys.map((k) => ({
          key: k,
          file: baseName(k),
          url: `${env.R2_PUBLIC_BASE}/${k}`,
          type: mediaTypeFromKey(k),
        }));
        return withCors(json({ ok: true, items }));
      }

      // left upload
      if (path.startsWith("/stores/") && path.endsWith("/left") && req.method === "POST") {
        const storeId = path.split("/")[2];
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return withCors(json({ ok: false, error: "file required" }, 400));

        const slot = await nextSlot(env, storeId, "left");
        const ext = extFromType(file.type) || "bin";
        const key = `stores/${storeId}/left/left_${slot}.${ext}`;
        await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

        await refreshPlaylists(env, storeId);
        return withCors(json({ ok: true, key }));
      }

      // left delete
      if (path.startsWith("/stores/") && path.includes("/left/") && req.method === "DELETE") {
        const [, , storeId, , fileName] = path.split("/"); // /stores/:id/left/:file
        if (!storeId || !fileName) return withCors(json({ ok: false }, 400));
        const key = `stores/${storeId}/left/${fileName}`;
        await env.MEDIA.delete(key);
        await refreshPlaylists(env, storeId);
        return withCors(json({ ok: true }));
      }

      // common right list
      if (path === "/common/right" && req.method === "GET") {
        const keys = await listMediaKeys(env, "_common", "right");
        const meta = await syncRightMetaWithKeys(env, keys);
        const items = keys.map((k) => {
          const file = baseName(k);
          const m = metaForFile(meta, file);
          return {
            key: k,
            file,
            url: `${env.R2_PUBLIC_BASE}/${k}`,
            type: mediaTypeFromKey(k),
            targets: m.targets || [],
            fullPanel: !!m.fullPanel,
          };
        });
        return withCors(json({ ok: true, items }));
      }

      // common right upload
      if (path === "/common/right" && req.method === "POST") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return withCors(json({ ok: false, error: "file required" }, 400));

        const slot = await nextSlot(env, "_common", "right");
        const ext = extFromType(file.type) || "bin";
        const key = `stores/_common/right/right_${slot}.${ext}`;
        await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

        // meta에 추가(없으면)
        const meta = await loadRightMeta(env);
        const f = baseName(key);
        if (!meta.items.find((x) => x.file === f)) meta.items.push({ file: f, targets: [], fullPanel: false });
        await saveRightMeta(env, meta);

        await refreshCommonRightOnly(env);

        return withCors(json({ ok: true, key }));
      }

      // common right meta update
      if (path === "/common/right/meta" && req.method === "PUT") {
        const body = await req.json().catch(() => ({}));
        const file = String(body.file || "").trim();
        if (!file) return withCors(json({ ok: false, error: "file required" }, 400));

        const targets = normalizeTargets(body.targets);
        const fullPanel = !!body.fullPanel;
        const meta = await loadRightMeta(env);
        const it = meta.items.find((x) => x.file === file);
        if (!it) return withCors(json({ ok: false, error: "file not found" }, 404));

        it.targets = targets;
        it.fullPanel = fullPanel;
        await saveRightMeta(env, meta);
        await refreshCommonRightOnly(env);

        return withCors(json({ ok: true }));
      }

      // common right delete
      if (path.startsWith("/common/right/") && req.method === "DELETE") {
        const fileName = decodeURIComponent(path.split("/")[3] || "");
        if (!fileName) return withCors(json({ ok: false }, 400));
        const key = `stores/_common/right/${fileName}`;
        await env.MEDIA.delete(key);

        const meta = await loadRightMeta(env);
        meta.items = meta.items.filter((x) => x.file !== fileName);
        await saveRightMeta(env, meta);

        await refreshCommonRightOnly(env);
        return withCors(json({ ok: true }));
      }

      // tv heartbeat
      if (path === "/tv/heartbeat" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const storeId = safeStoreId(body.store || body.storeId);
        if (!storeId) return withCors(json({ ok: false, error: "store required" }, 400));
        const ts = await tvHeartbeat(env, storeId);
        return withCors(json({ ok: true, storeId, lastSeen: ts }));
      }

      // tv status
      if (path === "/tv/status" && req.method === "GET") {
        const storeId = safeStoreId(url.searchParams.get("store") || "");
        if (!storeId) return withCors(json({ ok: false, error: "store required" }, 400));
        const st = await tvStatus(env, storeId);
  return withCors(json({ online: st.status === "ONLINE", lastSeen: st.lastSeen }));
      }

      // 404
      return withCors(json({ ok: false, error: "not found" }, 404));
    } catch (e) {
      return withCors(json({ ok: false, error: e.message || String(e) }, 500));
    }

    // ---- local helpers for this fetch ----
    async function refreshCommonRightOnly(env) {
      const rightKeys = await listMediaKeys(env, "_common", "right");
      const meta = await syncRightMetaWithKeys(env, rightKeys);
      const rightItems = rightKeys.map((k) => {
        const file = baseName(k);
        const m = metaForFile(meta, file);
        return {
          url: `${env.R2_PUBLIC_BASE}/${k}`,
          key: k,
          file,
          type: mediaTypeFromKey(k),
          durationSec: Number.isFinite(m.durationSec) ? m.durationSec : guessDurationSecFromKey(k),
          targets: m.targets || [],
          fullPanel: !!m.fullPanel,
        };
      });
      await writePlaylist(env, `stores/_common/right/playlist.json`, rightItems);
    }

  },
};
