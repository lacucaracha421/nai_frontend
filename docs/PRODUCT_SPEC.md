# NAI V5 Studio — S11 Portrait Product Spec

## Product identity
A personal NovelAI Diffusion V5 workspace optimized for Galaxy Tab S11 portrait use. It replaces the official frontend workflow with faster local Danbooru autocomplete, structured prompts, V5 multi-character positioning, and a compact generation loop.

## Hard constraints
- NovelAI Diffusion V5 only (`nai-diffusion-5-full`, optional V5 Curated switch).
- Galaxy Tab S11 portrait is the primary layout target; phone support is fallback only.
- One image per generation.
- Reopening the app restores prompts/settings but starts with an empty image stage.
- Danbooru autocomplete is local-file based; no Danbooru API dependency.

## Prompt model
1. Artist
2. Character Prompts (NovelAI multi-character prompt boxes)
3. Other
4. Quality — collapsible because it is mostly fixed
5. Negative — collapsible because it is mostly fixed

The base positive prompt sent to NovelAI is Artist + Other + Quality. Character prompts stay separate in the V5 multi-character structure.

## Prompt UX
- Main page uses compact rectangular prompt cards.
- Tap a card or swipe upward on it to open a full-screen editor sheet.
- Drag down on the sheet header to close.
- Numerical emphasis buttons adjust selected text by 0.1 using `1.2::prompt ::` syntax.
- Tag dictionary inserts into the active prompt instead of merely copying to clipboard.

## Character UX
- Unlimited UI slots; each character has name, prompt, optional character negative, enabled state, and normalized X/Y position.
- Character tag autocomplete is local Danbooru data.
- Picking a character suggestion updates the slot name and inserts the normalized tag.
- V5 free positioning is represented by draggable points on a canvas, not a legacy 5×5 selector.

## Local Danbooru autocomplete
- Input source: `src-tauri/resources/danbooru.sqlite (built from public/data/danbooru/*.json)`.
- Supported categories: general, artist, copyright, character, meta.
- Category is shown primarily as a color dot.
- Underscores are removed on display/insertion.
- Search starts after two characters with a short debounce.
- Exact/prefix/token/alias matches are ranked before substring matches; post count breaks ties.
- Favorites are persisted locally and shown when the query is empty.
- Korean/Japanese aliases can be supplied in `tag-aliases.json`.

## Generation output
- Large current image, then horizontal current-session thumbnails.
- Tap image for full-screen viewer; horizontal swipe changes session image.
- Persistent image actions: Save / Seed / Prompt / Upscale.
- Prompt action copies the positive prompt only.
- Standalone Upscale is a single action, not a scale selector.

## Persistence
Persist: prompts, character prompt definitions/positions, V5 settings, tag favorites, UI preferences.
Do not persist: generated image session list. This intentionally guarantees a blank image stage after restart.

## Pending Android-specific work
- SAF folder picker + remembered write permission.
- Secure persistent API-token storage using Android-backed secrets.
- Real-device keyboard/S Pen/touch fine tuning.
- Large Danbooru dataset worker/index tuning after the actual user dataset is known.
