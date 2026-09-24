# Implementation status — v0.4 source prototype

## Implemented
- Galaxy Tab S11 portrait-first responsive shell
- NovelAI Diffusion V5 Full / Curated only
- V5 request builder with one-sample generation and character caption coordinates
- Artist / Character Prompts / Other / Quality / Negative prompt model
- Collapsible Quality / Negative
- Full-screen prompt editor sheet opened from prompt cards
- Numerical emphasis selection adjustment in ±0.1 steps
- Rust/SQLite/FTS5 Danbooru autocomplete with category color dots, favorites, underscore removal and alias search
- 125-entry local tag dictionary (118 composition entries + V5 additions)
- Multi-character editor with draggable free-position points
- Blank image stage after application restart while prompt/settings persist
- Current-session thumbnail strip backed by PNG files in app cache (no persistent base64 image history in JS)
- Save / Seed reuse / positive Prompt copy / standalone Upscale controls
- Rust/Tauri bridge for Persistent API Token connection, image generation, and upscale
- Local tag import helper for JSON / JSONL / CSV (+ gzip)

## Validation performed in this environment
- TypeScript source was checked with TypeScript 5.8.3 using local declaration stubs because package dependencies are not installed in this sandbox.
- The V5 request builder was separately compiled and smoke-tested. It produced one sample, `params_version: 4`, normalized underscores, character coordinates, seed and extra noise seed as expected.
- The Danbooru importer was smoke-tested against the included sample file.

## Not validated here
- Full `npm install && npm run build` because npm dependencies are not available offline in this sandbox.
- `cargo test` / Android APK build because a Rust/Android build toolchain is not installed in this sandbox.
- Live NovelAI generation because no user API token is available here.
- Galaxy Tab S11 physical-device keyboard, S Pen, WebView and gesture behavior.

## Before calling it an install-ready Android release
1. Build and run once on Windows/Tauri desktop to validate a real V5 request.
2. Add Android SAF folder selection and persisted URI permission for Save.
3. Add Android-backed secure persistent token storage.
4. Import the user's real Danbooru dataset and profile load/search latency on S11.
5. Run `tauri android init`, install on S11, then tune keyboard/insets/touch behavior.

## Danbooru production source update
- Canonical source: `NEXTAltair/genai-image-tag-db` (CC0).
- Latest build verified on 2026-08-23: `v2026.08.16.25`.
- Added `scripts/import-nextaltair.py` and `requirements-tags.txt`.
- Category JSON is now build input only; Tauri searches a bundled SQLite/FTS5 index and returns only top matches to the WebView.
- `npm run tags:sync` downloads/normalizes the newest dataset and rebuilds `src-tauri/resources/danbooru.sqlite.gz`.

## 2026-09-24 backlog pass (NAI-001 … NAI-005)
- One-tap Save to `Pictures/NAI V5 Studio` (desktop) and shared `Pictures/NAI V5 Studio` (Android), numeric suffix on name clashes, animated save button.
- Site-compatible NovelAI upscale request (V5 Curated, fixed 2×, 1 Anlas) with a mocked-HTTP Rust test; NovelAI error text is surfaced.
- V5 usage-limit pill and a conservative `estimateAnlas` (known Opus free case only, otherwise "비용 미확인").
- Prombot import excludes series-☆ expansions and unknown names, with a diagnostic summary line.
- Finish filter "마무리" (replaces the plain grain filter): 애니 마무리 / 수채화 종이 presets with detail sliders, Web Worker preview and full-resolution save as `…_finish.png` (alpha and PNG text metadata preserved). See BACKLOG NAI-001.
- Checked with `tsc -b`, `vitest run`, `cargo test --lib`, and `cargo check --target aarch64-linux-android`. Not yet checked: live upscale, live usage values, Android save on the S11, the finish filter in the running app.

## 2026-09-24 NAI-006 — WebP save
- Save defaults to verified lossy WebP q90 with NovelAI text fields as XMP (no EXIF); PNG remains a setting ("저장 형식"). Alpha/stealth metadata and XMP are verified after encoding, falling back to PNG with a toast. See BACKLOG NAI-006.
- Checked with `tsc -b`, `vitest run`, `cargo test --lib`, `cargo check`, and `cargo check --lib --target aarch64-linux-android`. Not yet checked: the WebView WebP encoder on the S11 / WebView2, and NovelAI-site recognition of an app-saved file.

## 2026-09-24 NAI-007 — Load settings from an image
- "불러오기" in the quick-settings row reads NovelAI metadata from a picked PNG/WebP (PNG text chunks → WebP XMP → stealth alpha) and applies prompts, characters/positions, exact seed and generation settings immediately, with a 6 s undo toast. See BACKLOG NAI-007.
- Checked with `tsc -b` and `vitest run` (including the user's real NovelAI PNG and WebP files F/D when present). Not yet checked: the Android picker and loading on the S11.

## 2026-09-24 NAI-010 — Tag-first main screen (B2-1)
- The main screen is now a compact top band (status pill, current thumbnail, other session images, 저장), section tabs 작가 · 캐릭터 · 장면 · 품질·제외, and a full-width chip editor with a tap bubble (weight ±0.1, move, 수정, 삭제), inline add with autocomplete, a tool row (태그사전, 번역, undo/redo, ⋯) and 생성 설정 + 생성 at the bottom. Typing collapses the band and puts ±0.1, 사전, 번역, undo and 생성 above the keyboard. Image actions (저장, 마무리, Seed, 업스케일, ⋯) moved to the full-screen viewer. Settings split into 생성 설정 and 앱 설정. See BACKLOG NAI-010.
- Checked with `tsc -b`, `vitest run` (chip operations, diff, viewport keyboard detection) and headless Chrome at 800×1280 with injected demo state (no API calls). Not yet checked: the S11 WebView keyboard behaviour and touch feel.

