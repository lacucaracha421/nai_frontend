# 캐릭터 찾기 구현 기록 — 2026-09-27

승인된 방향 A를 기존 레이아웃 A 및 0.6.9 변경 위에 구현했다. 커밋, 스테이징, stash, reset, checkout, 의존성 설치, APK 빌드·설치는 실행하지 않았다.

## 동작

- 캐릭터 탭의 기존 도감 버튼과 타이핑 행을 `캐릭터 찾기`로 바꾸고 검색 아이콘을 적용했다.
- 캐릭터 행의 ＋는 찾기를 새 캐릭터 대상으로 연다. 선택 완료 때 슬롯을 만들므로 취소하면 빈 슬롯이 생기지 않는다.
- 찾기/내 도감 탭, 마지막 탭·시리즈 위치, 삽입 모드를 기억한다.
- 찾기 첫 화면은 도감에 저장한 캐릭터가 있는 시리즈를 먼저 보여주고 캐릭터 수 기준 인기 시리즈와 전체 시리즈 목록을 제공한다.
- 영어 태그·이름, 밑줄/띄어쓰기/대소문자 정규화, 한국어 시리즈 별칭 검색을 지원한다. 시리즈 이름이 비어 있는 신규 캐릭터도 이름의 괄호에 시리즈가 있으면 한국어 별칭으로 찾을 수 있다.
- 캐릭터 타일은 4열, 이미지 영역 3:4, `object-fit: contain`, 밝은 회색 배경이다. ★는 즉시 저장/삭제한다. 신규 123개는 신규 배지와 썸네일 없음 상태이며 선택할 수 있다.
- 찾기에서는 삽입 패널을 연다. 외형/의상 칩 제외, 세 가지 모드, 현재 슬롯 교체/새 슬롯 추가, 최종 프롬프트 미리보기를 제공한다. 자료가 없는 항목은 이름만 모드로 넣는다.
- `finderTags`는 찾기가 실제로 추가한 태그만 기록한다. 다음 선택 때 그 태그의 수정되지 않은 값만 제거한다. 원래 있던 태그나 사용자가 가중치 등을 수정한 값은 유지한다.
- 내 도감에서는 기억한 모드로 바로 삽입한다. 기존 항목과 시리즈 폴더를 유지하고, 폴더 안을 같은 4열 타일로 표시한다. 길게 눌러 기존/새 폴더로 이동할 수 있다.
- 랜덤 기본 범위는 도감 전체이며, 선택한 시리즈만 사용하도록 바꿀 수 있다. 시리즈 스위치, 이름만/이름+외형 모드, 화면의 인원 수와 실제 생성 요청이 같은 풀을 사용한다. 새로 저장한 항목도 선택 폴더에 속하면 자동으로 포함된다.
- 신규 캐릭터가 기존 자동완성 DB에 없더라도 삽입한 이름이 프롬프트에 남아 있으면 캐릭터 이름을 지우지 않는다.

## 데이터와 캐시

- 제공된 `src-tauri/resources/prombot-characters.csv.gz`와 `characters-extra.json`을 수정 없이 사용하고 `tauri.conf.json`의 번들 resources에 추가했다.
- Rust가 포함된 바이트를 `flate2`/`csv`/`serde_json`으로 읽는다. Android 리소스 파일 경로 접근에 의존하지 않도록 `include_bytes!`/`include_str!`를 사용한다. 첫 호출 후 `OnceLock`에 보관한다.
- 확인한 실제 데이터는 기존 19,193개 + 신규 123개 = 19,316개, 시리즈 1,916개(미분류 포함)다. CSV의 인용된 따옴표와 여러 줄 필드는 CSV 파서가 처리한다. 기존 북마크의 CSV 인용 표기와 정규 이름은 프런트엔드 식별자 정규화로 연결한다.
- 카탈로그나 웹사이트를 런타임에 다운로드하지 않는다. 캐릭터 찾기의 외부 네트워크는 지정된 Hugging Face 이미지 경로만 사용한다.
- 썸네일 URL은 이름의 `:`를 `_`로 바꾸고 첫 문자 폴더에 URL 경로 세그먼트로 인코딩한다. `2b_(nier:automata)` → `2/2b_(nier_automata).webp`, `37_(reverse:1999)` → `3/37_(reverse_1999).webp`와 따옴표/예약문자 인코딩을 테스트했다. 실제 저장소 응답 대조는 DNS/네트워크 제한으로 수행하지 못했다.
- Rust 명령은 카탈로그의 원본 이름만 허용한다. 호출자가 URL이나 파일 경로를 지정할 수 없다.
- 기기의 앱 데이터 디렉터리 아래 `character-thumbnails-v1/`에 WebP를 저장하고 매 요청에서 디스크를 먼저 읽는다. 현재 스냅샷의 항목 인덱스를 파일명으로 쓰므로 향후 스냅샷 순서를 바꿀 때 캐시 디렉터리 버전도 바꿔야 한다.
- 404는 별도의 missing 파일로 기억한다. 네트워크 실패는 missing으로 저장하지 않고 재시도 가능한 실패 상태로 표시한다. 신규 캐릭터는 이미지 요청을 하지 않는다. 응답은 WebP 헤더와 최대 4 MiB를 확인하고 임시 파일에서 rename한다.
- 프런트엔드 큐는 중복 요청을 합치고 동시 요청을 2개로 제한한다. 보이는 타일을 우선 처리한다. 도감 캐시는 앱 화면에서 백그라운드로 시작하여 찾기를 닫아도 계속되며 이미 저장된 파일은 오프라인에서 재사용한다.

## 저장 데이터 마이그레이션

Zustand 저장 키 `nai-v5-character-library-v1`은 그대로 두고 persist 버전을 1에서 2로 올렸다. 모든 항목의 `raw`, `display`, `series`, `addedAt`을 순서대로 복사하며 필터링·중복 제거·폴더 재지정을 하지 않는다. 이전 가져오기 플래그와 요약은 저장 대상에서 제외한다. 기존 즐겨찾기 마이그레이션 완료 여부도 보존한다.

379개 항목과 사용자 폴더를 사용한 순수 마이그레이션 테스트 및 실제 persist 재수화/버전 2 재저장 테스트가 통과했다. 사용자 기기의 실데이터를 읽거나 수정한 것은 아니다.

## 목업과의 대응 및 차이

탭 구조, 시리즈 목록, 3열 도감 폴더, 4열 3:4 타일, 전체 이미지 표시, 별 토글, 신규/없음/로딩/실패 상태, 하단 삽입 패널, 칩 제외, 대상 선택, 랜덤 범위 스위치를 구현했다. 앱의 기존 Material 3 토큰을 사용했고 목업 CSS는 가져오지 않았다.

사용자 결정에 따라 내 도감은 패널 없이 바로 삽입한다. 한국어 시리즈 라벨도 검색 및 표시한다. 캐릭터의 기본 정렬은 CSV 순서 뒤에 신규 목록이 이어지는 `목록순`이다. 기존 CSV에는 개별 게시물 수가 없으므로 신규 posts와 억지로 합쳐 전체 인기도 순위를 만들지 않았다. 도감 먼저/신규 먼저/이름순을 별도로 제공한다. 목록은 80개씩 추가 렌더링한다. 다운로드 중에는 그리드 위에 얇은 진행선, 하단에 도감 저장 진행을 표시한다. 목업의 예시 저장 용량 수치는 표시하지 않는다.

픽셀 단위 시각 비교 및 실제 터치 동작은 브라우저/기기 확인이 필요하다.

## 변경 파일

추가:

- `src-tauri/src/character_catalog.rs`
- `src/features/prompt/CharacterFinderSheet.tsx`, `characterFinder.css`
- `src/features/prompt/CharacterCatalogPrefetch.tsx`, `characterCatalogClient.ts`, `characterCatalog.ts`, `characterThumbnails.ts`
- `src/features/prompt/CharacterFinderSheet.test.tsx`, `characterCatalog.test.ts`, `characterThumbnails.test.ts`, `characterFinderRemoval.test.mjs`
- `src/stores/characterLibraryStore.test.ts`
- 이 구현 기록 문서

수정:

- `src/features/generator/V5Studio.tsx`, 기존 미추적 `V5Studio.test.tsx`
- `src/components/Icon.tsx`
- `src/features/prompt/PromptSheet.tsx`, `PromptSheet.test.tsx`, `characterLibrary.css`, `characterTag.ts`, `randomCharacter.ts`, `randomCharacter.test.ts`
- `src/stores/characterLibraryStore.ts`, `generationStore.ts`, `generationStore.test.ts`
- `src/types/generation.ts`, `src/styles/global.css`, `src/styles/m3.css`
- `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/tauri.conf.json`
- `src-tauri/gen/android/app/src/main/AndroidManifest.xml`

삭제:

- `src-tauri/src/prombot.rs` — 카탈로그 전용 모듈로 교체
- `src-tauri/gen/android/app/src/main/java/local/nai/v5studio/PrombotActivity.kt`
- `src/features/tags/PrombotSheet.tsx`, `PrombotSheet.test.tsx`, `prombotBridge.test.mjs`
- `src/features/prompt/prombotFavorites.ts`, `prombotFavorites.test.ts`
- `src/features/prompt/CharacterLibrarySheet.tsx` — 새 시트의 내 도감 탭으로 통합

제공된 데이터 두 파일은 새로 번들에 포함했다. 기존 `package.json`, `studio.css`, `CharacterSheet.tsx` 변경은 그대로 두었다. `gradlew`, Linux schema, `docs/prototypes/**`는 직접 수정하지 않았다.

## 검사 결과

- `npx tsc -b`: 통과.
- `npx vitest run`: 36개 파일 통과, 2개 파일 건너뜀. 186개 테스트 통과, 기존 6개 건너뜀.
- `cargo check`: 통과.
- `cargo test character_catalog --lib`: 3개 통과. 실제 번들 수량, CSV/JSON 파싱, 썸네일 경로/인코딩 검사.
- `git diff --check`: 통과.
- `grep -ri prombot src src-tauri/src`: 카탈로그 출처 주석, 번들 CSV 파일명, 필수 Hugging Face 이미지 원본 URL의 3개 참조만 남음. 제거 회귀 테스트도 통과.
- 브라우저 스크린샷: 개발 서버의 `127.0.0.1:1420` 바인딩이 `listen EPERM: operation not permitted`로 차단되어 생성하지 못함.
- 실제 썸네일 요청: `curl`에서 `Could not resolve host: huggingface.co`; 웹 조회 도구도 저장소에 접근하지 못함.

Galaxy Tab S11의 터치/키보드/Android 뒤로가기, 실제 네트워크 이미지 경로, 앱 재시작 후 기기 디스크 캐시 재사용은 미검증이다. APK 빌드·설치를 하지 않았다.
