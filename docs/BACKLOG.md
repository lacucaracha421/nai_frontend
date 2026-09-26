# NAI Frontend Backlog

Active work for this app only. Implemented features are listed in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

Added 2026-09-24 from user requests; investigated the same day (read-only, no API calls). Open questions are listed per item.

## NAI-001 — Finish filter ("마무리 필터")

Status: `DONE` (2026-09-24) — replaces the earlier plain grain filter; not yet checked in the running app or on the S11.

- **Done:** `src/features/generator/finish/`. A pure `applyFinish` ported from the user-tuned grain-lab prototype (byte-identical output at 832×1216, checked against the prototype's own `render()`): sharpen → chromatic shift → white balance → tone curve → saturation → glow → cold-press paper → vignette → midtone-weighted monochrome grain. RGB only; alpha (NovelAI stealth metadata) is copied byte-for-byte.
  - Two presets with exact values, 애니 마무리 and 수채화 종이, plus neutral (off). Adjustable values: temperature, S-curve, shadow lift, saturation, glow strength/threshold/radius, chromatic shift, vignette, paper strength/scale, grain strength, sharpen. Grain size (1.5 px), monochrome, midtone weighting, sharpen radius (1 px) and paper type are fixed.
  - Pixel sizes are defined for a 1216 px long side and scale with the image, so previews and upscaled images get the same look.
  - The filter runs in a Web Worker: a ≤ 1200 px copy for the live stage preview (stale slider jobs are dropped) and full resolution only on Save.
  - UI: the stage chip "마무리" toggles on/off (remembered). Long-press it or tap the slider button next to it to open a bottom sheet with two preset cards (live thumbnails of the current image), a collapsible "세부 조절" with sliders, and a reset-to-preset button. Hold "원본" on the stage to compare.
  - Save writes the filtered full-resolution PNG with NovelAI's text chunks as `…_finish.png`; the cached original is never modified. The full-screen viewer still shows the original.
  - The old `grainEnabled` setting migrates to the filter: grain on → filter on with 애니 마무리.
- **Open:** whether the viewer should show the filtered image; full-resolution save time and memory on the S11 for upscaled images.

## NAI-002 — Save immediately

Status: `DONE` (2026-09-24) — Android save not yet verified on the device.

- **Done:** Save writes directly with no picker (`save_image` command, `src-tauri/src/save.rs`). No app-configured save folder existed in the code (the old flow only had the OS picker's own remembered folder), so the fixed folder is `Pictures/NAI V5 Studio` on desktop (`picture_dir()`) and the shared `Pictures/NAI V5 Studio` on Android (via `Environment.getExternalStoragePublicDirectory`). Duplicate names get `_2`, `_3`, …; nothing is overwritten. The button animates saving → ✓ → idle, or shows an error state plus the error toast. No "save as…" action existed, so none was added.
- **Open:** Android 10 and older need extra storage permission handling (the S11 runs a newer Android); optional folder choice.

- **Cause:** every save opens the system file picker (`client.ts:335-339`, plugin-dialog `save`). There is no Android SAF or MediaStore code yet. The "save folder" requirement is in IMPLEMENTATION_STATUS under the install-ready Android steps.
- **Proposal:** a Rust `save_session_image` command that reads only from the session cache and writes bytes unchanged.
  - Desktop: a remembered folder, defaulting to Pictures/NAI V5 Studio.
  - Android: a small Kotlin MediaStore save to `Pictures/NAI V5 Studio`. It needs no permission on Android 10+ and images appear in the gallery. A remembered SAF folder is an alternative.
  - Keep "save as…" (picker) as a secondary action.
- **Questions:** one-tap save, or auto-save after every generation? Is the gallery folder acceptable? Overwrite or add a suffix on name collisions?

## NAI-003 — Anlas cost and V5 usage limit

Status: `DONE` (2026-09-24) — usage display not yet checked against the live account.

- **Done:** `/user/subscription` `usage {percent, isNegative, timeUntilNextPercent}` is parsed (missing fields tolerated) and shown as a "사용 한도 N%" pill next to Anlas, with a recharge hint (`timeUntilNextPercent` assumed to be seconds). `estimateAnlas` (`adapters/novelai/anlas.ts`) answers only the known case (Opus, within the usage limit, one image ≤ 1024×1024 pixels, ≤ 28 steps → 0); everything else shows "비용 미확인". Upscale shows "1 Anlas".

- **Current state:** the balance is already shown. `GET image.novelai.net/user/subscription` sums fixed and purchased training steps (`novelai/mod.rs:491-538`), and the header pill refreshes every 60 s. There is no cost estimate.
- **Known** (NovelAI docs https://docs.novelai.net/en/subscription/ and https://docs.novelai.net/en/image/):
  - The Opus free tier (one image, ≤ normal size, ≤ 28 steps) applies only up to V4.5.
  - V5 uses a usage limit; past it, all images cost Anlas until the limit refills.
  - Subscription Anlas are spent before Paid Anlas.
- **Third-party** (https://dev.to/ilan_kim/novelai-v5-on-opus-usage-limits-the-2026-09-21-subscription-anlas-reset-and-the-apinovelainet-567l):
  - Opus costs: 832×1216/28 = 0; 1024×1536/28 = 45.
  - `/user/subscription` also returns `usage {percent, isNegative, timeUntilNextPercent}`.
  - Community cost formulas are outdated (https://github.com/zer0thgear/zer0-novel-utillities/pull/2).
- **Unknown:** the official V5 cost formula and whether the sampler or options change it.
- **Proposal:**
  - Parse `usage` and show the V5 usage-limit percentage next to Anlas.
  - Add a pure `estimateAnlas` calibrated from NovelAI's own cost preview for 3–5 size/step combinations, labelled "≈".
  - Show upscale as 1 Anlas.
- **Questions:** subscription tier? Show the usage-limit percentage? Show an estimate or hide it when unsure?
- **Blocked:** reading NovelAI's official OpenAPI spec (`https://api.novelai.net/docs-json`) was not permitted during the investigation.

## NAI-004 — NovelAI upscale (site upscaler)

Status: `DONE` (2026-09-24) — user reported an API 400; the new request is not yet verified live.

- **Done:** the guessing loop is replaced by the site request (multipart `image` PNG blob + `request` JSON blob `{"image":"image","model":"nai-diffusion-5-curated","declared_blur_sigma":0}`, Bearer, random `x-correlation-id`, ISO `x-initiated-at`, ZIP reply). NovelAI's error message is shown in the error toast. A local mocked-HTTP Rust test checks the exact form layout and headers.

- **Current state:** `novelai/mod.rs:355-475` tries up to 10 guessed request formats against `image.novelai.net/ai/upscale`. None of them sends the `request` JSON part or the V5 model.
- **Request NovelAI's site uses** (third-party: https://github.com/sunanakgo/NAIS3/issues/12, https://github.com/sunanakgo/NAIS3/pull/9):
  - Multipart with an `image` part (PNG) and a `request` part (JSON `{"image":"image","model":"nai-diffusion-5-curated","declared_blur_sigma":0}`).
  - Bearer token, `x-correlation-id` and `x-initiated-at` headers.
  - Replies with a ZIP containing `image_*.png`.
  - Fixed 2× for 1 Anlas.
- **Proposal:** replace the guessing loop with this single request, add a mocked-HTTP test, then one live test by the user. Keep the 1024×1024 source limit until a live test disproves it.
- **Questions:** does Upscale fail now, and with what error? Is a fixed 2× acceptable?

## NAI-005 — Bookmark count bug

Status: `FIXED` (2026-09-24) — user needs to re-import once to confirm the count.

- **Cause (from prombot.net's live bundle, 2026-09-24):** `prombot:charFavorites` is a flat array of character names. A series ☆ (`Favorite everyone in …`) appends every member of that series (the "Other series" bucket alone has ~710 members), and the Favorites view lists series cards, not characters. The import copied the array as-is, so one series ☆ inflated ~50 picks to 379. Re-import already replaced older imports, so accumulation was not the cause.
- **Fix:** `prombot_favorite_catalog` classifies bookmarks against Prombot's `characters.csv` with Prombot's own grouping. Groups of ≥ 5 members with ≥ 80 % bookmarked count as series ☆ and are excluded; names not in the CSV are dropped. The import message reads "북마크 N명 · 시리즈 즐겨찾기 M개 제외 · 알 수 없는 이름 K개 제외" and lists the excluded series. If the CSV cannot be downloaded, nothing is filtered and the message says so.

- **Counts come from three places:**
  - the 🎲 random-character count (Prombot favourites, `V5Studio.tsx:71-73`);
  - the import message (`PrombotSheet.tsx:69-94`);
  - the library "N개 시리즈 · N명" (includes manually starred characters).
- **No in-app counting bug found.** Likely mismatches with Prombot:
  - Prombot's Favorites tab counts series, not characters.
  - A series-level ☆ bookmarks every member at once.
  - Stale names remain in Prombot's localStorage.
  - The 🎲 count and the library count use different lists.
- **Questions:** which number is wrong, what was expected and from where, was a series ☆ used, and does re-importing change it?
- **Fix options:** show "N명 (series M)", filter imports against Prombot's `characters.csv`, warn on very large imports.

## NAI-006 — Save as WebP with NovelAI-readable metadata

Status: `IMPLEMENTED` (2026-09-24) — pending a device check on the S11 and a NovelAI-site check of an app-saved file.

- **Done (user decision 2026-09-24):** Save writes lossy WebP q90 by default (`.webp`; finish saves keep `_finish`). Settings → "저장 형식: WebP (용량 작게) / PNG (원본 그대로)", persisted in `uiStore` (`saveFormat`); the PNG path is unchanged.
  - `src/features/generator/save/`: a one-shot Web Worker decodes the cached PNG (or takes the filtered RGBA), encodes with `OffscreenCanvas.convertToBlob("image/webp", 0.9)`, adds an XMP packet with every PNG tEXt/uncompressed iTXt field (`nai:Title`, `nai:Description`, … in the site-verified layout, XML-escaped), and never writes EXIF (existing EXIF chunks and the flag are dropped). The RIFF writer creates a `VP8X` header for simple `VP8 `/`VP8L` output (alpha flag from `ALPH` or the VP8L alpha bit, `ALPH` before `VP8 `), sets the XMP flag, pads odd chunks and fixes the RIFF size.
  - Before writing, the worker decodes the WebP and requires the alpha plane to equal the source exactly, the `stealth_png…` header (column-major alpha LSBs) to survive when the source had one, and the `XMP ` chunk to be present. Any failure (including an engine whose encoder returns PNG, e.g. WebKitGTK on Linux desktop) saves the PNG instead with the toast "WebP 변환에 실패해 PNG로 저장했습니다".
  - Success toast: "저장됨 · <file name> · <size>". Rust `save_image` detects PNG/WebP from the bytes and forces the matching extension (`name_2.webp` suffixing); Android writes the file directly (no MediaStore insert), so the gallery MIME type comes from the `.webp` extension.
  - Checked: vitest (RIFF writer, XMP, stealth decoder, fallback, setting persistence; real NovelAI PNG fixture when present on the dev machine), Rust save tests, and a local libwebp (Pillow) round-trip of the injected files: chunk order valid, XMP read back, lossy q90 alpha byte-identical to the source PNG.
- **To check on the S11:** Save shows "저장됨 · … .webp · ~130 KB" (not the PNG fallback toast); the file appears in the gallery; dropping it on the NovelAI site restores the prompt/settings; same for a 마무리-filtered save and an upscaled image; save time for upscaled images.

Tested with a real NovelAI PNG (`webp-test` on the user's desktop), dragging each file onto the NovelAI site:
- The source PNG carries tEXt chunks (Title, Description, Software, Source, Generation_time, Comment) and stealth metadata in the alpha LSBs (`stealth_pngcomp`).
- WebP keeps the alpha plane lossless even at lossy quality 90, so the stealth data survived in every variant.
- Recognized by NovelAI: lossless without metadata (A), lossy q90 without metadata (D), lossy q90 with **XMP only** (F).
- Not recognized: any file containing **EXIF** (B lossless+EXIF+XMP, C lossy+EXIF+XMP, E lossy+EXIF only).
- Sizes: PNG 1.13 MB → lossless 773 KB → lossy q90 ~127–132 KB.

Proposed: default save = lossy WebP q90 with the PNG text fields copied into XMP, no EXIF; keep PNG as an option; verify after encoding that the alpha stealth header survived (canvas premultiplication and the Android WebView encoder must be checked on the S11), falling back to PNG if not.

## NAI-007 — Load settings from an image ("불러오기")

Status: `IMPLEMENTED` (2026-09-24) — pending a device check on the S11.

- **Done:** a "불러오기" button at the end of the quick-settings row (44 px) opens the system picker through a plain `<input type="file" accept="image/png,image/webp">` (no plugin, no new permission; Tauri's Android `WebChromeClient` handles the file chooser). The picked image's NovelAI information is applied immediately; a toast "불러왔습니다 · 되돌리기" (6 s) restores the previous prompts, characters and settings on tap. No information: "이 이미지에는 NovelAI 정보가 없습니다". Unsupported parts: "일부 항목은 앱에서 지원하지 않아 건너뛰었습니다" plus their names.
  - Reading order (`src/features/generator/load/readImageMetadata.ts`), first hit wins: PNG `tEXt`/`iTXt`/`zTXt` → WebP `XMP ` (`nai:` fields) → stealth alpha LSBs (`stealth_pngcomp` gzip / `stealth_pnginfo` plain; layout documented in `save/stealth.ts`). Stealth pixels are decoded in a one-shot worker with `premultiplyAlpha: "none"`.
  - Mapping (`mapNovelAiMetadata.ts`): base caption → Other, with plain `artist:` tags right after the leading subject tags → Artist; Quality is kept only when the image's prompt ends with the current Quality text, otherwise emptied (text stays faithful, no guessing). Negative base caption → Negative. Characters (prompt, negative, center) replace the character slots; `use_coords` → AI's Choice / manual. Exact seed (random seed becomes fixed), steps, CFG, CFG rescale, sampler (only the four the app offers), noise schedule, width/height, model (Curated or the known V5 Full hash only). Random character is switched off.
  - Skipped and listed: vibe transfer, character reference, img2img source, inpaint mask, ControlNet, SMEA, Variety+, Decrisp, an unsupported sampler, a non-V5 model.
- **Known limits:** subject tags (`1girl`, `solo`, …) that are not at the start of the prompt move to the front on the next generation (the app's own prompt join). Underscores are normalized as usual.
- **To check on the S11:** the picker opens (Samsung Gallery / Files) and returns the original file; loading a NovelAI PNG, an app-saved WebP, and a WebP without chunks (stealth only); undo within 6 s; the Settings sheet shows the loaded seed.

## NAI-008 — User feedback on 0.5.0 (2026-09-24)

Status: `IMPLEMENTED` (0.5.1, 2026-09-24) — finish button outside the image, gentler defaults (glow 35→12, grain 3.5→1.2, paper 55→20; user-adjusted values kept), upscaled image fits the viewer. Character-library count: investigated only — the NAI-005 filter runs only on a bookmark re-import; re-import after the list download succeeds. Pending an S11 check.
- Move the 마무리 (finish) button outside (make it directly reachable instead of nested).
- The finish filter is too strong; adjust defaults and consider presets with gentler strengths.
- Viewing an upscaled image overflows the screen; fit it to the viewport.
- Character tag library (도감) shows 378 people — the same inflated count as the Prombot bookmark issue; check the library count after the NAI-005 fix (re-import, series-star exclusion) and whether the library keeps previously imported entries.

## NAI-009 — User requests (2026-09-24 evening)

Status: `IMPLEMENTED` (0.5.1, 2026-09-24) — all four items; pending an S11 check (save as PNG/WebP, reset time after returning to the app, dictionary start tab, random keeps other tags).
- The usage-limit reset time does not update.
- Tag dictionary: open on the dictionary matching the section it was entered from — Artist → artist tags, Character → character dictionary, Others → action tags first.
- Saving fails with an error like "save expect raw image bytes".
- Random: today it discards everything in the character prompt and applies only a random character tag. Replace just the character tag and keep the other tags (actions etc.) in that character prompt.

## NAI-010 — Tag-first main screen (redesign B2-1)

Status: `IMPLEMENTED` (2026-09-24, pending S11 check) — the user chose B2-1 from `docs/prototypes/redesign-20260924/` (`concept-b2.html#v1`, `#v1-keyboard`, `#viewer`; README section 5).

User reasoning: the image does not need to be large at first (tap opens it full screen); tags are edited often, so tag editing convenience matters most. B had too much information.
- Top band: small image thumbnail (tap → full-screen viewer), session thumbnails, one-tap 저장. Avoid showing the current image twice (thumbnail and first session tile).
- Section tabs (작가 · 캐릭터 · 장면 · 품질·제외) and a full-width tag editor as the main area. Tag chips ~52px; tap a tag → bubble with −0.1/+0.1, move left/right, 수정, 삭제; "＋ 태그 추가" at the end.
- Fixed tool row: 태그사전, 번역, undo/redo, ⋯ (Prombot, 전체 복사, 불러오기, 전체 지우기). With the keyboard up: tool row with 생성 directly above the keyboard, suggestions under the tag being typed.
- "달라진 점" as a quiet "직전 대비 +N −N" chip that expands on tap.
- Bottom: 생성 설정 button (size · steps · CFG in one line) and 생성 with its cost line; one status pill at the top.
- Viewer: 저장, 마무리, Seed, 업스케일, ⋯ (프롬프트 복사, 이 설정 불러오기, 마무리 조절).

- **Done:** `V5Studio.tsx` rebuilt around a full-width chip editor (`features/prompt/TagBoard.tsx`, pure operations in `tagChips.ts`). Top band: one status pill (conclusion first, e.g. 무료 생성 · 한도 72% · Anlas N; tap refreshes, or opens 앱 설정 when not connected), privacy eye, ⚙ 앱 설정; current-image thumbnail (tap → viewer; shows the 마무리 preview), the other session images newest first (the current one is not repeated), 저장 with the existing saving/저장됨/실패 states. Tabs 작가 · 캐릭터 · 장면 · 품질·제외 (품질 and 제외 switch inside the tab).
  - Chips 52 px / 17 px. Tap → bubble with −0.1/+0.1 (`1.2::tag ::`), ‹ ›, 수정, 삭제; tap the selected chip again to edit. "＋ 태그 추가" opens an input with local autocomplete (★ favourite/도감 kept) right under it; comma/Enter commits and keeps typing; Backspace on an empty input arms, then deletes the previous tag (as before).
  - 캐릭터 tab: character pills (1, 2, …, ＋), 🎲 랜덤 (44 px, same Prombot-bookmark rule), 설정 → the existing character sheet (위치/이미지에서 위치 지정 now full screen, 사용, 캐릭터 제외, 도감, Prombot, 삭제). The chips edit the selected character's prompt.
  - Tool row: 태그사전 (starts on the section's dictionary; 캐릭터 → 캐릭터 도감), 번역 (selected chip or typed text), 되돌리기/다시 실행 (existing per-section history), ⋯ = Prombot, 전체 복사, 텍스트로 편집 (plain textarea for anything chips cannot express), 불러오기, 캐릭터 설정 (캐릭터 tab), 전체 지우기 (undoable).
  - Typing mode (keyboard up and a text field focused): the band collapses to a small thumbnail + tabs; the tool row gains −0.1/+0.1 and 생성 (commits the typed tag first). Hiding the keyboard with Back leaves typing mode; the layout only expands after the current tap finishes. `MainActivity.kt` pads the content view by the IME inset (edge-to-edge had disabled resizing), and the app is pinned to `visualViewport`.
  - Weight groups and brackets with commas (`1.2::a, b ::`, `{a, b}`) are one chip, weighted/moved/deleted as a whole. Chip edits rewrite only that tag's text; other separators and line breaks stay as typed. Undo/redo keep a half-typed tag; Enter during Korean IME composition does not commit; translating a weighted chip keeps its weight.
  - "직전 대비 +N −N": current positive prompt (작가 + 장면 + 품질, as sent) vs the latest generation's stored prompt; hidden with no generation or no change; tap lists the tags. Character prompts and 제외 are not stored per image, so they are not compared.
  - Bottom: 생성 설정 (size · steps · CFG) opens the generation-only settings (model, resolution, steps/CFG/rescale/seed, sampler); ⚙ opens 앱 설정 (token, 저장 형식, translation, backup). 생성 shows 무료 · 한도 내 / N Anlas / 비용 미확인 from `estimateAnlas`.
  - Viewer: 저장, 마무리 (tap toggles, hold opens 조절; the viewer shows the 마무리 preview and "누르고 있으면 원본"), Seed (fix this seed / tap again for random), 업스케일 1 Anlas, ⋯ = 프롬프트 복사, 이 설정 불러오기 (reads the session image's NovelAI metadata with the existing loader + undo toast), 마무리 조절. Meta line: Seed, size, 직전 대비 tags.
- 0.6.0 feedback: the current image is ~35 % of the screen height (whole image) with session images and 저장 in a column beside it; the 직전 대비 chip and hint lines are hidden by default (앱 설정 → 화면 도움말: 직전 대비 표시 / 조작 안내 문구 표시); the viewer stacks top bar, image and action bar so nothing covers the image at fit size.
- 0.6.0 feedback 2: the column beside the image holds the session row, 생성 설정, 태그사전, 번역, 더 보기 and 저장; the bottom is undo/redo + 생성. Nothing is drawn over the main image. In the viewer a single tap closes (a zoomed image fits first; a double tap only fits). Tapping outside a chip bubble closes it. Android Back closes the topmost layer (bubble/suggestions → menu → sheet → viewer → typing) via `app/backStack.ts` and Tauri's `onBackButtonPress`; with nothing open, the first Back shows "한 번 더 누르면 종료" and a second Back within 2 s leaves the app.
- Round 5: the editor size is user-controlled — swipe up on the editor (or tap/swipe its handle bar) to shrink the image band to the mini thumbnail + tabs, swipe down (list at top) or Back to return; chip/bubble taps no longer change the layout; typing mode still compacts while the keyboard is up. Viewer taps act at once (fit, or close); the double-tap-to-fit rule is gone.
- Round 6: tapping empty editor space starts a new tag (a tap with the bubble open only closes it; swipes/scrolls do nothing). Session thumbnails open that image in the viewer without changing the current image; the viewer's 저장/Seed/업스케일/프롬프트 복사/이 설정 불러오기/마무리 act on the image shown there (an upscale still becomes the current image).
- Released as 0.6.0 (version bumped in `package.json` and `tauri.conf.json`).
- **Open:** S11 check of the keyboard (height, whether the WebView resizes, the tool row sitting on the keyboard), the bubble and double-tap feel, and chip sizes. The old full-screen prompt sheet (`PromptSheet.tsx`) and the `showFixedPrompts` setting are no longer used on screen.

## NAI-011 — User requests (2026-09-26)

Status: `VERIFY` — implemented in 0.6.1 (installed on the S11 2026-09-26, awaiting device checks): viewer gesture tracker (touch slop, 500 ms tap on max travel, ghost-pointer reset, cancelled touches never tap); one deduplicated `randomCharacterPool()` for the dice count and draw (if the count stays ~378, re-import Prombot bookmarks — see NAI-005); editing-driven compact layout, native IME inset once, board-only reveal, most-recently-opened Back order (NAI-010's "Back leaves typing mode" no longer applies), 사전 ends editing first; Ink Enso adaptive icon with a themed monochrome layer (Android icons are hand-made; don't run `tauri icon` straight into the repo).

- Bug: after tapping a large (zoomed) image, it sometimes does not return to the normal fitted size and the image glitches/flickers.
- Bug: the random draw screen shows "378명" next to the dice icon, but the character tag dictionary bookmarks contain far fewer characters; the count uses the wrong source or counts duplicates.
- UX: in the tag editing area, the keyboard and Back handling feel inconsistent — the screen keeps jumping up and down as the keyboard opens/closes and Back is pressed. Redesign so the layout stays stable (predictable keyboard inset handling and a consistent Back order).
- New app icon: a fresh design made for the Galaxy (One UI) squircle icon shape; the current one looks poor.
- Bug (added 2026-09-26): tapping the full-screen image to shrink it back sometimes also triggers 태그사전 (or another control under the viewer) — the tap seems to pass through to the main screen once the viewer closes, like a double tap. Suspect the closing tap's synthesized click or second touch landing on the button beneath.
- Bug (still seen on 0.6.1, 2026-09-26): tapping the **left part** of a zoomed full-screen image to shrink it does not fit properly and the image flickers; likely related to the tap-through above (the left edge may hit a Back/edge-gesture zone or a control beneath).
- **Done (after 0.6.1, pending S11 check):** root cause of both viewer bugs: the viewer closed on pointerup, and the WebView's click for that tap (dispatched after touchend, hit-tested then) landed on the screen revealed underneath — 태그사전/번역 in the right column, or on the left the current-image thumbnail, which reopened the viewer (the "does not fit / flickers" report). `components/ghostClick.ts` swallows click-type events in the capture phase for 450 ms after a tap/swipe closes the viewer.
- Fixed in 0.6.3 (2026-09-26): the usage recovery hint always read "2시간 12분". `timeUntilNextPercent` stayed constant across polls (it behaves like the time one percent takes, not a countdown), and each 60 s poll restarted the countdown. Now: before a rise is seen the pill shows the rate ("1% 회복에 약 …"); after the percentage is seen rising it counts down from that moment; a value seen counting down keeps the old countdown. Unconfirmed against NovelAI docs (none); check on the S11.
- Investigated (after 0.6.3, 2026-09-26): 🎲 still showed 377명 after a re-import (378 before). **Proven:** the dice count reads only Prombot-imported entries (`randomCharacterPool`), a re-import replaces older imports, and on desktop the NAI-005 filter works with Prombot's real list (50 picks + an idolmaster ☆ + 1 unknown name → 49 kept). Prombot (live bundle) groups exactly like the filter, and a series ☆ appends the not-yet-bookmarked members in one run in list order. **Inferred:** the device import either excluded no series (the −1 fits one unknown name being dropped: the bookmarks are ~377 individual picks, or a ☆ whose series now has <80 % bookmarked) or could not download the list (then nothing is filtered); which one depends on data only the S11 has. **Fix:** a series ☆ is also detected by its ordered run (≥ 20 consecutive members in Prombot's order, members bookmarked earlier skipped); the list now comes from prombot.net's own `characters.csv.gz`, with Hugging Face as fallback; the import message shows "Prombot 원본 R명 → N명 · 시리즈 ☆ M개(X명) 제외 · 알 수 없는 이름 K개", the download error, and the three largest kept series; the last breakdown is saved and shown in the 🎲 hint and the 도감 (which also shows the 🎲 count). **User:** re-import once on the S11 and read the breakdown; if N is still ~377 with no series excluded, the 가장 많이 담긴 시리즈 line shows where the bookmarks are.
- 0.6.5 (2026-09-26): sampled on the S11, `timeUntilNextPercent` stayed 7888 across polls at 99 % — confirmed per-percent interval. The pill adds "가득 차기까지 약 …"; the moment a rise (or leaving 100 %) is seen by a regular poll is stored on the device so "다음 1%까지" survives restarts. The 377 dice count is real: the in-app Prombot storage holds 379 individual bookmarks over 82 series; series-☆ coverage detection now needs ≥ 12 members (6 of 7 girls_band_cry picks were wrongly excluded).
