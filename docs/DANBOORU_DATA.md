# Local Danbooru data

The app intentionally does not call Danbooru while typing. Autocomplete uses a bundled local index.

## Canonical upstream

Use the newest **CC0** build from:

- `NEXTAltair/genai-image-tag-db`
- Hugging Face dataset main branch
- Source is intended for tag lookup, alias resolution, and translation workflows.
- Current version verified during this implementation: **v2026.08.16.25** (2026-08-16 build).

Do not hard-code that version forever. `scripts/import-nextaltair.py` reads `build_manifest.json` and records the version that was actually imported into `public/data/danbooru/manifest.json`.

The upstream Danbooru export exposes these useful columns:

- `tag`
- `type_name` (`general`, `artist`, `copyright`, `character`, `meta`, ...)
- `count`
- `deprecated_tags`
- `lang_ja`
- `lang_zh`

## Tablet index layout

The JSON category files are **build inputs**, not the runtime search index. `scripts/build-tag-sqlite.py` converts them to a compact SQLite database with an FTS5 inverted index:

```text
public/data/danbooru/*.json
        ↓ npm run tags:sqlite
src-tauri/resources/danbooru.sqlite.gz
        ↓ first app launch / dataset update
$APPCACHE / app-data local SQLite copy
        ↓ Rust search command
React receives only the top 24–36 matches
```

The production frontend build removes `dist/data/danbooru/` so the JSON shards are not duplicated inside the packaged app. The gzip resource is unpacked once per dataset version.

Categories remain `0 general / 1 artist / 3 copyright / 4 character / 5 meta`. Display text removes Danbooru underscores and escaped parentheses only when a result is returned.

## Import newest NEXTAltair data

Install the small data-tool dependencies once:

```bash
python -m pip install -r requirements-tags.txt
```

Then:

```bash
npm run tags:sync
```

The script prefers the newest `main` dataset files. If Hugging Face exposes Danbooru Parquet through its viewer conversion ref instead, it falls back automatically to `refs/convert/parquet` while still reading the upstream `build_manifest.json` from `main`.

Default pruning keeps rare Artist/Character/Copyright tags but removes dead/noisy zero-count rows. General and Meta default to `post_count >= 10` because loading hundreds of thousands of unused aliases on a tablet is wasteful.

Thresholds are configurable:

```bash
python scripts/import-nextaltair.py --min-general 1 --min-meta 1
```

For an already downloaded Parquet directory:

```bash
python scripts/import-nextaltair.py --input-dir D:\\danbooru_parquet
```

## Korean aliases

NEXTAltair supplies Japanese (and some Chinese) translation aliases, but not a complete Korean alias layer. Keep user-maintained Korean aliases separately in:

`public/data/tag-aliases.json`

Those aliases are merged into the SQLite FTS index at build time.

## Legacy importer

`scripts/import-danbooru.mjs` remains available for arbitrary JSON/JSONL/CSV tag dumps. Prefer `import-nextaltair.py` for the canonical production dataset.
