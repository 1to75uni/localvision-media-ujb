# LocalVision V1 Starter (No-build: Admin/Player = static, API = Worker)
이 스타터는 **초등학생 버전**으로, 빌드/컴파일 없이도 Cloudflare Pages에 바로 올릴 수 있는 구조입니다.

## 목표(TO-BE)
- Admin 웹에서 **업체 만들기 버튼 1번**
- 업로드하면 **left_1, left_2… 자동 슬롯**
- Player 링크/QR 자동 생성 (V1에서는 QR은 Admin에서 생성)
- TV는 **QR 1번** → 이후 자동 재생
- Admin에서 ONLINE/OFFLINE 상태 확인

---

## 폴더 구조
- `apps/admin/` : 관리자 웹(정적 페이지)
- `apps/player/`: TV 플레이어(정적 페이지)
- `workers/api/` : Cloudflare Worker API + D1 + R2

---

## Cloudflare에서 해야 할 것(체크리스트)
### 1) R2 버킷 1개 만들기
- Bucket 이름 예: `localvision-media-ujb`
- Public access: ON (V1은 단순화를 위해 Public 사용)
- CORS: Pages 도메인(관리자/플레이어)을 AllowedOrigins에 추가

### 2) D1 DB 만들기
- DB 이름 예: `localvision-db`
- `workers/api/migrations/0001_init.sql` 적용

### 3) Worker 만들기
- Worker 이름 예: `localvision-api`
- Bindings:
  - D1: `DB`
  - R2: `MEDIA`
  - Variables:
    - `R2_PUBLIC_BASE` (예: https://pub-c2364f607cc54d6d9efbb3d24cfaec29.r2.dev)
    - `RIGHT_PREFIX` (기본: right/common)
    - `ONLINE_TTL_SEC` (기본: 120)

### 4) Pages 2개 만들기
- Admin Pages: `apps/admin` 폴더를 배포
  - 환경변수 `API_BASE` = Worker URL (예: https://localvision-api.<account>.workers.dev)
- Player Pages: `apps/player` 폴더를 배포
  - 환경변수 `API_BASE` = Worker URL 동일

---

## 로컬 테스트(선택)
- 그냥 파일을 더블클릭하면 CORS 때문에 API 호출이 막힐 수 있어요.
- 가장 쉬운 방법은 Pages로 올린 뒤 테스트입니다.

---

## 사용 순서
1) Admin 열기 → 업체 생성
2) 업체 상세 → 파일 업로드(영상/이미지)
3) Admin이 제공하는 Player URL을 TV(Fully) Start URL로 등록
4) TV가 재생 시작 + Heartbeat 전송
5) Admin에서 ONLINE/OFFLINE 확인

