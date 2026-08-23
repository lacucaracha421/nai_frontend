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
