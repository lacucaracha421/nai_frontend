# NAI V5 Studio redesign concepts (2026-09-24)

This is a design exploration only. The files are static mockups, not an implementation contract, and no app code changed. Placeholder art is CSS gradients, and all prompts, names and counts are fictional. Colours start from `src/styles/m3-tokens.css`, with the tag-category dots taken from `src/styles/global.css`. The font stack matches the app (Roboto / Noto Sans KR).

- Compare: `index.html`
- Live screens:
  - `concept-a.html#generate|prompt|viewer|settings`
  - `concept-b.html#generate|prompt|dictionary|settings`
  - `concept-c.html#generate|review|prompt|settings`
  - `concept-b2.html#v1|v1-keyboard|v2|v2-keyboard|viewer` (B refined after feedback, see section 5)
- Renders (800×1280 CSS px, headless Chrome, DPR 1): `a-*.png`, `b-*.png`, `c-*.png`, `b2-*.png`. `current-generate.png` is the built 0.5.2 `dist/` in the same viewport with no image (browser only, so Tauri calls are inactive).
- Yellow numbered notes in the renders are annotations, not UI.

User brief: this is the NAI app's version of the PC declutter exploration, with fresh concepts. The app is used only on a Galaxy Tab S11 in portrait (800×1280), touch only. The generated image should be the hero, controls should be at least 44 px and thumb-reachable, and there should be no hover, drag-and-drop, keyboard shortcuts or desktop-only affordances.

## 1. Audit (current 0.5.2, as the user sees it)

There is no usage telemetry. Frequency is estimated from what each feature does in a generate-review-tweak loop. Line numbers refer to 0.5.2 (`2fbb20f`). `V5Studio` means `src/features/generator/V5Studio.tsx`.

| Element | Where now | Frequency (est.) | Proposal |
| --- | --- | --- | --- |
| Generate button + cost line | fixed bottom dock, 64 px (`V5Studio.tsx:537-542`, `m3.css:222-235`) | every cycle | keep in the same thumb position. The cost line becomes the button subtitle (`무료 · 한도 내`). |
| Image stage | `V5Studio.tsx:351-432`; max height `min(43dvh,560px)` (`global.css:6`). An 832×1216 image renders about **376×550**, roughly 20 % of the screen. | every cycle | promote. A: 676×988 (about 3.2× the area). C: 600×877. B keeps it about the same size. |
| Hold-for-original `원본` (on the image, only while 마무리 is on) | `V5Studio.tsx:400-426` | medium | keep, relabelled `누르고 있으면 원본` |
| 마무리 ON/OFF + 조절 chips under the image | `V5Studio.tsx:434-448` | toggle medium, 조절 low | one 마무리 toggle next to Save. Long-press or the sheet reaches 조절. A small state badge sits on the image. |
| Seed / Prompt / Upscale / 저장 row | `V5Studio.tsx:450-474`; 40 px pills (`m3.css:115-117`) | 저장 high, Seed medium, Upscale low-medium, Prompt copy low | 저장 is the largest and nearest to the thumb. Upscale stays with its cost. Seed stays. Prompt copy moves to the image info sheet (A) or ⋯. |
| Session thumbnail strip, 58 px | `V5Studio.tsx:476-498` | high while iterating | A: right-edge vertical rail (88×128). B: a row of 64×94 thumbnails + `+8`. C: session roll plus a review screen. |
| Anlas pill + usage pill (with recovery hint) | header, `V5Studio.tsx:305-330`; 40 px (`m3.css:67-71`) | glanced at every cycle | one status pill that leads with the conclusion (`무료 생성 · 한도 72%`). Tap to refresh and see details. |
| Privacy eye (hide images) | header, `V5Studio.tsx:331-346` | low but urgent when needed | keep as a 48 px icon, always in the same corner |
| Settings ⚙ | header, `V5Studio.tsx:347` | low | keep. It opens **app** settings only (see Settings rows below). |
| ARTIST / CHARACTER PROMPTS cards (two-up) | `V5Studio.tsx:502-517` | character high, artist medium | Korean labels (작가 / 캐릭터). A: summary chips in the dock. B: section tabs. C: one-line rows. |
| 🎲 random character, 40 px | `V5Studio.tsx:506-515`; `m3.css:194-196` | medium-high | make it 44 px or more and attach it to the character entry. C adds `매번 랜덤 캐릭터` per repeat. |
| OTHER card | `V5Studio.tsx:518` | high | rename to 장면. Largest section, first in edit. |
| Quality / Negative toggle + cards | `V5Studio.tsx:519-525` | rare edits | one `품질·제외` entry, collapsed by default |
| Quick-settings row: 태그사전 / W×H / steps / CFG / 불러오기 | `V5Studio.tsx:526-532`. The three parameter buttons all open the full Settings sheet. | 태그사전 medium, params low, 불러오기 low-medium | one `생성 설정` chip or button beside Generate that opens a **generation-only** sheet. 태그사전 goes beside Generate (B/C) or into the editor (A). 불러오기 goes into the generation sheet (A) or the editor tools (B). |
| Prompt editor sheet (full screen) | `PromptSheet.tsx:155-222` | high | A: half-height sheet, so the image stays visible. B: edited in place. C: row → the existing editor. |
| Editor toolbar: −0.1, +0.1, 태그사전, Prombot, 전체 복사, 전체 지우기, Generate | `PromptSheet.tsx:170-201` | weight/사전 medium; Prombot low | 5 tools + ⋯ (Prombot, 전체 지우기). Generate always stays in its own place. In B the tools sit on the keyboard accessory row. |
| Undo / redo / 번역 (inside the token editor) | `AutocompleteTextarea.tsx:693-719` | medium | move to the sheet header (A) or the tool row (B) |
| Character sheet: AI's Choice / Manual Position, 이미지에서 위치 지정, tabs, 사용, 태그사전·캐릭터 도감, Prombot, 삭제, tag input, prompt, negative | `CharacterSheet.tsx:80-172` | medium | Korean labels. Position becomes a single row (`위치: AI 선택`). 도감 and Prombot go behind one `불러오기` row. (Not re-drawn in detail; see Gaps.) |
| Tag dictionary (full-screen iframe, 기존 사전 / Sex tabs) | `QuickCopySheet.tsx:60-84` | medium | B: a dock in the keyboard's place, so the prompt stays visible and inserted tags appear as chips. Keep the NAI-009 start tab. |
| Finish sheet (presets + 세부 조절 sliders) | `FinishSheet.tsx:110-196` | low | keep as is (bottom sheet, 58dvh) |
| Settings sheet: token, model, 7 resolutions, steps/guidance/rescale/seed number inputs, sampler, 저장 형식, Translation (provider, model ID, base URL, API key, test), 데이터 관리 (backup) | `SettingsSheet.tsx:41-157`, `TranslationSettings.tsx:33-88`, `BackupSection.tsx:58-100` | resolution medium; the rest low/once | split. **생성 설정** (model, resolution cards with a 무료/Anlas mark, ± steppers, seed, sampler) opens from the Generate area. **앱 설정** (connection, save, translation, backup, version) is where each row states its conclusion first. |
| Toasts (error, success, load undo) | `V5Studio.tsx:535-536`, `ImageLoadButton.tsx:53-83` | per action | unchanged |
| Full-screen viewer | `components/ImageViewer.tsx` | medium | keep the swipe. A adds an info sheet (Seed, size, prompt, `이 설정 불러오기`). |

Top findings:

1. **The hero is small.** On an 800×1280 portrait screen, a portrait image gets about 376×550 px. The lower half of the screen is prompt cards and three rows of equally weighted pill buttons.
2. **Equal weight for unequal actions.** 저장 (high) looks the same as Prompt copy (low). The three parameter buttons (steps, CFG, W×H) are the only things in the thumb zone besides Generate, and all three open the same long sheet.
3. **Cost status is split.** The Anlas balance and usage limit are two header pills, but the conclusion (whether this generation is free) is small text inside Generate.
4. **Mixed language and small targets.** Labels mix English (ARTIST, OTHER, GENERATE, Settings, Seed/Prompt/Upscale) and Korean. Several targets are 40 px: 🎲, the quota pills, image actions and quick settings.
5. **Settings mixes per-generation values with one-time configuration.** Resolution sits beside token entry, translation API keys and backup restore.
6. **Editing hides the result.** Every prompt edit opens a full-screen sheet, so the user cannot see the image being corrected.

## 2. Concepts

### A. 캔버스 우선 / Canvas first (`concept-a.html`)
- The image fills the screen at 676×988.
- A right-edge rail holds:
  - session thumbnails at the top;
  - Seed, 업스케일 and 마무리;
  - **저장** at the bottom, the largest target and closest to the thumb.
- A slim dock at the bottom has:
  - prompt summary chips (작가 2, 캐릭터 · 랜덤 🎲, 장면 18, 품질·제외);
  - a `832×1216 · 28 steps · CFG 5` chip;
  - Generate.
- One status pill replaces the Anlas and usage pills.
- `#prompt`: a half-height sheet with section tabs, token chips, autocomplete and 5 tools + ⋯. The image stays visible above the sheet.
- `#viewer`: the existing swipe viewer plus an info sheet with Seed, size, prompt, `Seed만 사용`, `프롬프트 복사` and `이 설정 불러오기`.
- `#settings`: the generation-only sheet, with model, resolution cards marked 무료/Anlas, ± steppers, seed, sampler, 불러오기 and a link to 앱 설정.
- Trade-offs: the full prompt text is one swipe away. The half-height sheet plus the soft keyboard must be checked on the S11. The rail narrows the image slightly for landscape (1:1 or wide) outputs.

### B. 프롬프트 작업대 / Prompt workbench (`concept-b.html`)
- The main screen is split. The upper half has the image (400×585) next to:
  - the session row;
  - a 2×2 action grid;
  - a **“직전 이미지와 달라진 점”** panel showing the tag diff against the previous generation, plus 되돌리기 and 나란히.
- The lower half has section tabs and token chips, edited in place, with a tool row. Generate sits beside large 태그사전 and 생성 설정 buttons.
- `#prompt`: with the keyboard up, the image shrinks to a mini preview. Weight, 사전, 번역, 되돌리기 and **생성** sit on the row directly above the keyboard.
- `#dictionary`: the tag dictionary is a dock in the keyboard's place, with `→ 장면에 넣기` always visible and inserted tags highlighted.
- `#settings`: one-time app settings, where each row starts with its conclusion.
- Trade-offs: the image stays about the current size, so this concept does not meet “the image is the hero”. The diff panel is new logic, although each session image already keeps its prompt. The dictionary dock needs the existing iframe dictionary re-hosted.

### C. 세션 롤 / Session roll (`concept-c.html`)
- 반복 1/2/4/8 sends one-image requests one after another, which keeps the “one image per generation” rule per request.
- The session roll shows waiting, running and finished items. Each image has a large **★ 보관** (keep) mark, usable while the run continues.
- `#review` filters the session (전체, 보관, 업스케일, 저장됨) and saves only kept, unsaved images in one tap. It warns that the session clears on restart.
- `#prompt` covers what changes on each repeat: random character (today's 🎲), random seed, and a new “선택지 태그” (`{a|b}`) idea.
- `#settings` leads with cost protection:
  - stop when a request would cost Anlas or its cost is unknown;
  - stop below a usage-limit floor;
  - spacing between requests;
  - keep the screen on.
- Trade-offs: this is the most new behaviour and the riskiest one, because a wrong cost estimate spends Anlas. How much usage limit each V5 image consumes is not known (see NAI-003), so the mockup shows only `무료 × 4 · 한도 안에서`, never a number. Background and keep-awake behaviour on Android must be checked on the device.

## 3. What moves where

These moves apply in every concept unless noted.

- **Promote:**
  - image size (A, C);
  - 저장 as the largest image action;
  - the single status pill that leads with the conclusion;
  - Generate with its cost as a subtitle.
- **Merge:**
  - the Anlas and usage pills become one status pill;
  - the W×H, steps and CFG buttons become one `생성 설정` entry;
  - the Quality/Negative toggle and cards become one `품질·제외` entry.
- **Move out of the main screen:**
  - Prompt copy goes to the image info sheet (A) or ⋯;
  - Prombot and 전체 지우기 go to the editor ⋯;
  - 마무리 조절 is reached by long-pressing 마무리 or through its sheet;
  - 불러오기 goes to the generation sheet (A) or the editor tools (B).
- **Move to 앱 설정:** token, 저장 형식, translation provider/model/URL/key, backup/restore, Prombot bookmark import status, version.
- **Rename to Korean:** ARTIST → 작가, CHARACTER PROMPTS → 캐릭터, OTHER → 장면, Quality/Negative → 품질·제외, GENERATE → 생성, Upscale → 업스케일, Settings → 설정. Keep NovelAI terms (Seed, CFG, Steps, Anlas).
- **Unchanged:**
  - one image per request;
  - a blank stage after restart (no persistent gallery);
  - the 원본 hold compare;
  - finish presets;
  - viewer swipe;
  - the privacy eye;
  - NAI-009 dictionary start tabs;
  - random keeping other tags.

## 4. Recommendation

Adopt **A** as the direction, in stages:

1. **Low-risk cleanup, possible in the current layout.**
   - Raise the stage max height.
   - Make every target 44 px or more (🎲, pills, action and quick-setting buttons).
   - Merge the status into one pill with the cost conclusion.
   - Use Korean labels.
   - Split Settings into 생성 설정 and 앱 설정, and point the W×H/steps/CFG buttons at the generation-only sheet.
2. **A's layout.** Add the right rail with 저장 lowest, the dock with summary chips + 생성 설정 + Generate, and the half-height prompt sheet that keeps the image visible.
3. **Borrow from B.** Inside A's sheet, use B's section tabs and the keyboard accessory row with Generate. Later, consider the “달라진 점” diff in A's image info sheet.
4. **C only after cost protection is proven.** Add 반복 as an option in A's dock, never as the default, and stop on any unknown or non-zero cost.

## 5. B2: B refined after user feedback

User feedback: “B is the best, but it has too much information. The image doesn't need to be big from the start; I can tap it to view it large. I edit tags often, so tag-editing convenience matters more.”

`concept-b2.html` has two layouts to compare, plus the shared full-screen viewer:

- **B2-1 (`#v1`, `#v1-keyboard`):**
  - a compact top band: a 90×132 image thumbnail (tap for full screen), the session row, and one-tap 저장;
  - four section tabs, then a full-width tag editor that fills most of the screen.
- **B2-2 (`#v2`, `#v2-keyboard`):**
  - a left column: the image thumbnail with 저장 on it, a small session row, and five vertical section tabs (품질 and 제외 separate);
  - the tag editor on the right, nearly full height.
  - The vertical tabs stay visible when the keyboard is up.
- **`#viewer`:** the full-screen image, with 저장, 마무리, Seed, 업스케일 and ⋯ (프롬프트 복사, 이 설정 불러오기, 마무리 조절). One quiet meta line holds Seed, size and the tag diff.

What changed from B, and why:

- **Removed from the main screen:**
  - **the “직전 이미지와 달라진 점” panel:** it becomes a quiet `직전 대비 +2 −2` chip that expands on tap, and appears in the viewer's meta line. It was the densest block and is useful only sometimes.
  - **the 2×2 action grid (저장, 마무리, Seed, 업스케일):** these act on the image, so they move to the viewer. 저장 stays one tap from the main screen.
  - **the 400×585 image:** a thumbnail is enough, because tapping opens the full-screen viewer.
  - **the meta lines (seed, size, CFG):** now one quiet line inside the `생성 설정` button.
  - **the editor caption, 전체 복사 and 불러오기 in the tool row:** moved to ⋯.
- **Added for tag editing:**
  - larger chips (52 px, 17 px text);
  - tapping a chip opens an action bubble with −0.1 / +0.1, move left/right (reorder without dragging), 수정 and 삭제, each one tap;
  - `＋ 태그 추가` at the end of the list;
  - 태그사전, 번역, 되돌리기/다시 실행 always in the tool row;
  - in the keyboard-up state, a tool row directly above the keyboard with 생성, and autocomplete right under the tag being typed.
- **Kept:** the single status pill and the 생성 button with its cost subtitle.

Recommendation: **B2-1**. The full-width editor fits the most tags per row, which means the least scrolling, and its top band is the most compact. Choose B2-2 if switching sections while typing is more common than long tag lists.

Not checked: whether a double tap and the action bubble feel right on the S11, and the real keyboard height and insets.

## Evidence and gaps

- **Code read:**
  - `V5Studio.tsx`, `PromptSheet.tsx`, `CharacterSheet.tsx`, `SettingsSheet.tsx`, `TranslationSettings.tsx`, `BackupSection.tsx`, `QuickCopySheet.tsx`, `PrombotSheet.tsx`, `FinishSheet.tsx`, `CharacterStageOverlay.tsx`, `ImageLoadButton.tsx`, `AutocompleteTextarea.tsx` (controls only);
  - `anlas.ts`, `uiStore.ts`, `m3-tokens.css`, `m3.css`, `global.css`;
  - `docs/PRODUCT_SPEC.md`, `IMPLEMENTATION_STATUS.md`, `BACKLOG.md`, `README.md`. The `.docx` spec was not read.
- **Renders:**
  - Rendered 12 concept PNGs, 5 B2 PNGs and `current-generate.png` at 800×1280 with headless Chrome and inspected each one. Overlapping notes, clipped badges and empty sheet space were fixed.
  - `current-generate.png` comes from `dist/` (built with 0.5.2) in a plain browser, empty state only. The current stage size with an image is computed from CSS (`min(43dvh,560px)`), not measured with a real image.
- **Not checked:**
  - anything on the S11 or in the Android WebView: soft keyboard height and insets, gesture bar, S Pen, DPR;
  - landscape (the user does not use it, and the current app's ≥840 px two-column layout was not redesigned);
  - the character sheet, Prombot sheet and finish sheet in detail;
  - whether V5 usage-limit consumption per image can be predicted, which C depends on;
  - Android keep-screen-on and background behaviour for C.
- **Frequencies** are estimates and have not been measured.
