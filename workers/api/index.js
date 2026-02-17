// Cloudflare Worker API (V1) - No framework
// Bindings: env.DB (D1), env.MEDIA (R2), env.R2_PUBLIC_BASE, env.RIGHT_PREFIX, env.ONLINE_TTL_SEC

function json(data, status=200, extraHeaders={}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

function err(message, status=400) {
  return json({ error: message }, status);
}

function nowMs(){ return Date.now(); }

function isValidStoreId(id){
  return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(id);
}

function guessTypeFromMime(mime){
  return (mime && mime.startsWith('video/')) ? 'video' : 'image';
}

async function getStatus(env, storeId){
  const row = await env.DB.prepare(
    'SELECT MAX(last_seen) as last_seen FROM devices WHERE store_id=?'
  ).bind(storeId).first();

  const lastSeen = row?.last_seen || 0;
  const ttl = Number(env.ONLINE_TTL_SEC || 120) * 1000;
  const status = lastSeen && (nowMs() - lastSeen <= ttl) ? 'ONLINE' : 'OFFLINE';
  return { status, lastSeen };
}

function buildPublicUrl(env, objectKey){
  const base = String(env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
  return base + '/' + objectKey;
}

async function listStores(env){
  const res = await env.DB.prepare('SELECT store_id as storeId, name, created_at as createdAt FROM stores ORDER BY created_at DESC').all();
  const items = [];
  for (const s of res.results || []) {
    const st = await getStatus(env, s.storeId);
    items.push({ ...s, status: st.status });
  }
  return items;
}

async function getStore(env, storeId){
  return await env.DB.prepare('SELECT store_id as storeId, name, created_at as createdAt FROM stores WHERE store_id=?')
    .bind(storeId).first();
}

async function nextSlot(env, storeId, side){
  const row = await env.DB.prepare('SELECT MAX(slot) as max_slot FROM media WHERE store_id=? AND side=?')
    .bind(storeId, side).first();
  const max = row?.max_slot ?? 0;
  return Number(max) + 1;
}

// Multipart Upload helpers using R2 Multipart API
async function initUpload(env, storeId, side, filename, mime){
  const slot = await nextSlot(env, storeId, side);
  const ext = (filename && filename.includes('.')) ? filename.split('.').pop().toLowerCase() : (mime?.split('/')[1] || 'bin');
  const safeExt = (ext || 'bin').replace(/[^a-z0-9]/g,'').slice(0,10) || 'bin';
  const objectKey = `stores/${storeId}/${side}/${side}_${slot}.${safeExt}`;

  const mp = await env.MEDIA.createMultipartUpload(objectKey, { httpMetadata: { contentType: mime || 'application/octet-stream' } });
  const url = buildPublicUrl(env, objectKey);
  return { slot, key: objectKey, uploadId: mp.uploadId, url };
}

async function uploadPart(env, key, uploadId, partNumber, body){
  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, body);
  // part.etag
  return { etag: part.etag };
}

async function completeUpload(env, key, uploadId, parts){
  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const result = await upload.complete(parts);
  return result;
}

async function recordMedia(env, storeId, side, slot, key, mime, url){
  await env.DB.prepare(
    'INSERT INTO media (store_id, side, slot, object_key, mime, url, created_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(storeId, side, slot, key, mime, url, nowMs()).run();
}

async function listMedia(env, storeId, side){
  const res = await env.DB.prepare(
    'SELECT slot, object_key as objectKey, mime, url, created_at as createdAt FROM media WHERE store_id=? AND side=? ORDER BY slot ASC'
  ).bind(storeId, side).all();
  return (res.results || []).map(r => ({ ...r, type: guessTypeFromMime(r.mime) }));
}

async function playerConfig(env, storeId){
  const left = await listMedia(env, storeId, 'left');
  // right는 공통 prefix에서 playlist를 DB가 아니라 "하드코딩"으로 가져오거나, 추후 DB로 확장
  // V1: right는 비워둠 (원하면 right도 같은 방식으로 확장)
  const right = [];
  return { left, right };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }});
    }

    try {
      // Routes
      if (url.pathname === '/api/stores' && request.method === 'GET') {
        const items = await listStores(env);
        return json({ items });
      }

      if (url.pathname === '/api/stores' && request.method === 'POST') {
        const body = await request.json();
        const name = String(body.name || '').trim();
        const storeId = String(body.storeId || '').trim();
        if (!name) return err('name required');
        if (!isValidStoreId(storeId)) return err('storeId invalid (lowercase a-z0-9_-), 2~32 chars');
        const exists = await getStore(env, storeId);
        if (exists) return err('storeId already exists', 409);

        await env.DB.prepare('INSERT INTO stores (store_id, name, created_at) VALUES (?,?,?)')
          .bind(storeId, name, nowMs()).run();
        return json({ ok: true });
      }

      // /api/stores/:storeId
      const mStore = url.pathname.match(/^\/api\/stores\/([a-z0-9_-]+)$/);
      if (mStore && request.method === 'GET') {
        const storeId = mStore[1];
        const store = await getStore(env, storeId);
        if (!store) return err('store not found', 404);
        const status = await getStatus(env, storeId);
        let base = env.PLAYER_BASE || 'https://YOUR_PLAYER_PAGES_DOMAIN';
        base = String(base).replace(/\/$/, '');
        const sep = base.includes('?') ? '&' : '?';
        const playerUrl = `${base}${sep}store=${encodeURIComponent(storeId)}`;
        return json({ store, status, playerUrl });
      }

      const mMedia = url.pathname.match(/^\/api\/stores\/([a-z0-9_-]+)\/media$/);
      if (mMedia && request.method === 'GET') {
        const storeId = mMedia[1];
        const side = url.searchParams.get('side') || 'left';
        const store = await getStore(env, storeId);
        if (!store) return err('store not found', 404);
        const items = await listMedia(env, storeId, side);
        return json({ items });
      }

      // Upload init/part/complete
      const mInit = url.pathname.match(/^\/api\/stores\/([a-z0-9_-]+)\/upload\/init$/);
      if (mInit && request.method === 'POST') {
        const storeId = mInit[1];
        const store = await getStore(env, storeId);
        if (!store) return err('store not found', 404);

        const body = await request.json();
        const side = String(body.side || 'left');
        const filename = String(body.filename || 'file.bin');
        const mime = String(body.mime || 'application/octet-stream');

        const init = await initUpload(env, storeId, side, filename, mime);
        return json(init);
      }

      const mPart = url.pathname.match(/^\/api\/stores\/([a-z0-9_-]+)\/upload\/part$/);
      if (mPart && request.method === 'PUT') {
        const key = url.searchParams.get('key');
        const uploadId = url.searchParams.get('uploadId');
        const partNumber = Number(url.searchParams.get('partNumber') || '0');
        if (!key || !uploadId || !partNumber) return err('missing key/uploadId/partNumber');
        const body = request.body; // ReadableStream
        const res = await uploadPart(env, key, uploadId, partNumber, body);
        return json(res);
      }

      const mComplete = url.pathname.match(/^\/api\/stores\/([a-z0-9_-]+)\/upload\/complete$/);
      if (mComplete && request.method === 'POST') {
        const storeId = mComplete[1];
        const store = await getStore(env, storeId);
        if (!store) return err('store not found', 404);

        const body = await request.json();
        const key = String(body.key || '');
        const uploadId = String(body.uploadId || '');
        const parts = body.parts || [];
        const side = String(body.side || 'left');
        const slot = Number(body.slot || 0);
        const mime = String(body.mime || 'application/octet-stream');
        const urlPublic = String(body.url || buildPublicUrl(env, key));

        if (!key || !uploadId || !Array.isArray(parts) || !slot) return err('missing key/uploadId/parts/slot');
        const formattedParts = parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }));
        await completeUpload(env, key, uploadId, formattedParts);
        await recordMedia(env, storeId, side, slot, key, mime, urlPublic);
        return json({ ok: true });
      }

      // Player config
      if (url.pathname === '/api/player/config' && request.method === 'GET') {
        const storeId = url.searchParams.get('storeId');
        if (!storeId) return err('storeId required');
        const store = await getStore(env, storeId);
        if (!store) return err('store not found', 404);
        const cfg = await playerConfig(env, storeId);
        return json(cfg);
      }

      // Heartbeat
      if (url.pathname === '/api/heartbeat' && request.method === 'POST') {
        const body = await request.json();
        const storeId = String(body.storeId || '');
        const deviceId = String(body.deviceId || '');
        const role = String(body.role || 'tv');
        if (!storeId || !deviceId) return err('storeId/deviceId required');
        const store = await getStore(env, storeId);
        if (!store) return err('store not found', 404);

        const ua = String(body.ua || '');
        const ip = request.headers.get('CF-Connecting-IP') || '';
        await env.DB.prepare(
          'INSERT INTO devices (device_id, store_id, role, ua, ip, last_seen) VALUES (?,?,?,?,?,?) ' +
          'ON CONFLICT(device_id) DO UPDATE SET store_id=excluded.store_id, role=excluded.role, ua=excluded.ua, ip=excluded.ip, last_seen=excluded.last_seen'
        ).bind(deviceId, storeId, role, ua, ip, nowMs()).run();

        return json({ ok:true });
      }

      if (url.pathname === '/api/status' && request.method === 'GET') {
        const storeId = url.searchParams.get('storeId');
        if (!storeId) return err('storeId required');
        const st = await getStatus(env, storeId);
        return json(st);
      }

      return err('not found', 404);
    } catch (e) {
      return err(e.message || String(e), 500);
    }
  }
};
