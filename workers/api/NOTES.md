## IMPORTANT
- Worker가 playerUrl 만들 때 `PLAYER_BASE` 변수를 사용합니다.
- Cloudflare Worker > Settings > Variables 에 `PLAYER_BASE`를 **Player Pages 주소**로 넣어주세요.
  - 예: https://your-player.pages.dev
  - (이미 쿼리파라미터를 붙여 쓰고 싶으면 그대로 넣어도 됩니다. Worker가 자동으로 ?store=를 붙입니다.)
- `R2_PUBLIC_BASE`는 이미 이 프로젝트에 기본값으로 들어가 있습니다:
  - https://pub-c2364f607cc54d6d9efbb3d24cfaec29.r2.dev
