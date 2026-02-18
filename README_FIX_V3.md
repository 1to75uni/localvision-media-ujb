# LocalVision Drop-in Fix (V3)

이 ZIP은 **Admin(Pages)** + **Player(Pages)** + **Worker(API)** 를 서로 호환되게 맞춘 "한 번에 교체" 패키지입니다.

## 포함된 경로(그대로 GitHub에 업로드)
- `apps/admin/` : Admin V3 (공통 Right 관리 + apiBase 저장)
- `apps/player/` : Player 7:3 (V7-like) + version.json 자동 업데이트 체크
- `workers/api/` : Worker API (CORS + /meta + /playlist.json + /api/* 호환)

## 가장 빠른 성공 체크
1) Worker가 살아있는지: `https://<YOUR_WORKER>.workers.dev/meta`
2) 플레이리스트가 나오는지:
   - `.../playlist.json?store=<store>&side=left`
   - `.../playlist.json?store=<store>&side=right`

`/meta`가 안 뜨면 **Worker 배포가 안 된 상태**입니다(아래 참고).

## 중요한 점 (Pages vs Worker)
- **Pages(Admin/Player)**: GitHub에 올리면 자동 배포(연동된 경우)
- **Worker(API)**: GitHub에 올리는 것만으로는 보통 배포가 안 됩니다.
  - Cloudflare 대시보드에서 Worker 코드로 붙여넣고 "Deploy" 하거나,
  - Wrangler로 `workers/api` 폴더에서 `wrangler deploy` 해야 합니다.
