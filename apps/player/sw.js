// LocalVision Service Worker (patched)
// 목표
// - 이미지(포스터 등)는 오프라인 대비로 MEDIA 캐시에 cache-first 유지
// - playlist.json만 네트워크 우선(network-first)으로 받아서 즉시 업데이트 반영
// - 영상(mp4 등)은 서비스워커가 개입하지 않음(206/Range/캐시 이슈 예방)

const STATIC_CACHE = "lv-static-v15"; // ✅ 버전 올려서 업데이트 강제 // ✅ 버전 올려서 업데이트 강제
const MEDIA_CACHE  = "lv-media-v3"; // ✅ 미디어 캐시는 유지

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(["./", "./index.html", "./app.js", "./sw.js", "./version.json"]);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith("lv-") && ![STATIC_CACHE, MEDIA_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isImageUrl(req) {
  const u = new URL(req.url);
  return /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(u.pathname);
}
function isVideoUrl(req) {
  const u = new URL(req.url);
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(u.pathname);
}
function isPlaylistUrl(req) {
  const u = new URL(req.url);
  return /\/playlist\.json$/i.test(u.pathname);
}

function isVersionUrl(req) {
  const u = new URL(req.url);
  return /\/version\.json$/i.test(u.pathname);
}

async function versionNetworkOnly(req) {
  try {
    // no-store로 항상 최신 확인
    const r = new Request(req.url, { method: 'GET', cache: 'no-store' });
    return await fetch(r);
  } catch (e) {
    return Response.error();
  }
}
function playlistCacheKey(req) {
  // ?v=... 같은 쿼리는 무시하고, 같은 경로의 playlist는 1개만 캐시되게
  const u = new URL(req.url);
  u.search = "";
  u.hash = "";
  return new Request(u.toString(), { method: "GET" });
}

async function playlistNetworkFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const key = playlistCacheKey(req);

  try {
    const res = await fetch(req, { cache: "no-store" });
    if (res && res.ok) {
      cache.put(key, res.clone()).catch(() => {});
      return res;
    }
    // 200이 아니면(예: 404) 캐시가 있으면 캐시로
    const cached = await cache.match(key);
    if (cached) return cached;
    return res;
  } catch {
    const cached = await cache.match(key);
    return cached || Response.error();
  }
}



async function staticNetworkFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(req, { cache: "no-store" });
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      return res;
    }
    const cached = await cache.match(req);
    if (cached) return cached;
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || Response.error();
  }
}

function isStaticAsset(req) {
  // 문서/스크립트/스타일은 업데이트가 자주 일어나므로 network-first로 처리
  if (req.mode === "navigate") return true;
  const dest = req.destination;
  if (dest === "script" || dest === "style" || dest === "document") return true;
  const u = new URL(req.url);
  return /\.(html|js|css)(\?|#|$)/i.test(u.pathname) || u.pathname === "/" || u.pathname.endsWith("/index.html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // ✅ version.json: network-only (자동 업데이트 체크용)
  if (isVersionUrl(req)) {
    event.respondWith(versionNetworkOnly(req));
    return;
  }

  // ✅ playlist.json: network-first (업데이트 즉시 반영)
  if (isPlaylistUrl(req)) {
    event.respondWith(playlistNetworkFirst(req));
    return;
  }

  // ✅ 영상은 SW가 개입하지 않음(브라우저 기본 처리)
  if (isVideoUrl(req)) return;

  // ✅ 이미지: cache-first (오프라인 대비)
  if (isImageUrl(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // ✅ 정적 파일(index/app/sw 등): network-first (배포 후 자동 업데이트)
  if (isStaticAsset(req)) {
    event.respondWith(staticNetworkFirst(req));
    return;
  }

  // 그 외 요청: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    cache.put(req, res.clone()).catch(() => {});
    return res;
  })());
});
