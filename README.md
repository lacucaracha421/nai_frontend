# NAI V5 Studio v0.4

Galaxy Tab S11 세로 화면을 우선으로 설계한 개인용 NovelAI Diffusion V5 프론트엔드 프로토타입입니다.

## 이번 구현
- V5 Full / V5 Curated만 지원
- 항상 1장 생성
- 앱 재실행 시 프롬프트/설정은 복구, 생성 이미지 세션은 비움
- Artist / Character Prompts / Other / Quality / Negative 분리
- Quality / Negative 접기
- 프롬프트 카드를 누르거나 위로 스와이프해 전체 화면 편집
- 선택 문자열 Numerical Emphasis ±0.1
- V5 Multi-Character Prompting + 자유 좌표 포지셔닝
- 로컬 Danbooru artist / character / general 자동완성
- 자동완성 삽입 시 underscore 제거
- 카테고리는 색상 점으로 표시
- 자동완성 즐겨찾기
- 기존 구도 태그사전 118개 + V5 전용 태그
- 세션 썸네일, 저장, Seed 재사용, Positive Prompt 복사, 전용 Upscale
- NovelAI Persistent API Token 연결은 Rust 메모리에만 보관

## 로컬 Danbooru 데이터
자동완성은 Tauri/Rust의 **SQLite + FTS5** 검색을 사용합니다. React/WebView에는 검색 결과만 전달하므로 Artist/Character 전체 JSON을 메모리에 올리지 않습니다.

원본 shard는 `public/data/danbooru/*.json`, 앱용 압축 DB는 `src-tauri/resources/danbooru.sqlite.gz`입니다.

```bash
# 이미 받은 shard로 SQLite만 다시 만들기
npm run tags:sqlite

# NEXTAltair 최신 shard 동기화 + SQLite 재생성
npm run tags:sync
```

한국어 사용자 별칭은 `public/data/tag-aliases.json`에 유지하며 DB 빌드 시 FTS 인덱스에 병합됩니다. 검색은 2글자부터 180ms debounce 후 Rust 명령으로 실행되고 같은 점수에서는 post_count가 높은 태그가 먼저 나옵니다. 브라우저-only `npm run dev`에서는 작은 sample index만 사용합니다.

## 실행
```bash
npm install
npm run dev
npm run tauri:dev
```

## Android
Tauri 2 Android 요구사항(Android Studio/SDK/NDK/Rust Android targets)을 설치한 뒤:
```bash
npm run android:init
npm run android:dev
# APK/AAB 빌드
npm run android:build
```

## 아직 다음 패스에서 다듬을 것
- Android SAF 기반 사용자 지정 저장 폴더 선택/권한 기억
- 토큰 Android secure storage 영구 보관
- Android SAF 기반 저장을 실제 기기에서 검증
- 생성 이미지 PNG 메타데이터 표시/복원
- S11 실기기 터치·키보드 동작 미세 조정

## V5 요청 구조 메모
- 기본 모델: `nai-diffusion-5-full`
- 생성 수: `n_samples: 1`
- V5 요청 파라미터 버전: `params_version: 4`
- Base positive: Artist + Other + Quality
- Character Prompt: `v4_prompt.caption.char_captions` + 자유 X/Y center 좌표
- 공식 API에 `Accept: application/json`을 보내 base64 이미지 JSON을 받도록 Rust 백엔드를 구성했습니다.

실제 Danbooru 파일을 받으면 `npm run tags:import -- <파일경로>`로 정규화할 수 있습니다. 포맷이 다르면 `scripts/import-danbooru.mjs`의 입력 어댑터만 고치면 됩니다.

## Danbooru autocomplete source

Production autocomplete is pinned to the newest CC0 build from `NEXTAltair/genai-image-tag-db` on Hugging Face. The latest build verified on 2026-08-23 is `v2026.08.16.25`.

Run `python -m pip install -r requirements-tags.txt` once, then `npm run tags:sync`. The sync step rebuilds the category source shards and then produces the bundled SQLite/FTS index used by Tauri.

