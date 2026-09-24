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
