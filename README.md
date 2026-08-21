# NAI Frontend v0.2

Prombot-inspired personal NovelAI desktop frontend prototype.

## v0.2

The basic NovelAI image-generation pipeline is now wired through Tauri/Rust.

- Persistent API Token input in Options
- Token is stored **in Rust memory only for the current app session**
- Free connection test using NovelAI tag-suggestion endpoint
- `POST https://image.novelai.net/ai/generate-image`
- JSON/base64 image response displayed in the Generate workspace
- Multiple-image result switcher
- API/status errors shown directly in the UI
- Known V4 / V4.5 model API IDs
- V5 entry uses provisional `nai-diffusion-5` because the current public API docs do not yet expose a confirmed V5 API id; the raw model id is editable in Options
- Main + negative + enabled character prompts are converted into the V4-style caption / character-caption request boundary

## First run on Windows

Install frontend dependencies once:

```powershell
npm.cmd install
```

### Web UI preview only

```powershell
npm.cmd run dev
```

This shows the interface, but it **cannot call NovelAI** because the Rust/Tauri bridge is not running.

### Actual NovelAI-connected desktop app

Install the Tauri prerequisites first if you do not already have them:

- Rust stable toolchain (`rustup`)
- Microsoft Visual Studio C++ Build Tools / Desktop development with C++
- WebView2 (normally already present on Windows 10/11 with Edge)

Then run:

```powershell
npm.cmd run tauri:dev
```

Open **Options → NovelAI Connection**, paste the NovelAI **Persistent API Token**, and click **Connect & Test**.

The token is deliberately not written to localStorage, JSON, or project files in v0.2. Closing the app discards it.

## Smoke-test recommendation

For the first successful generation, use:

- Model: NAI Diffusion V4.5 Full
- 832 × 1216
- 28 steps
- Euler Ancestral
- 1 image

After the basic request works, V5 can be confirmed by capturing the current model API id used by NovelAI's official frontend and entering it in the editable API-id field.

## Not implemented yet

- Secure persistent OS credential storage
- Confirmed V5-specific request schema / API model id
- Image save/history/gallery
- Click-to-place character positioning overlay
- Vibe Transfer / Precise Reference / Image2Image / Inpaint
- Director Tools
- Danbooru live tag autocomplete

## Architecture

Frontend state never calls NovelAI directly:

```text
React UI
  -> generationStore
  -> buildNovelAiRequest()
  -> Tauri invoke()
  -> Rust NovelAI client
  -> image.novelai.net
```

This keeps API/network details isolated so NovelAI request changes can be handled without rewriting the UI.
