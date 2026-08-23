from __future__ import annotations

import argparse
import gzip
import json
import re
import sqlite3
from pathlib import Path

CATEGORY_FILES = {
    "general": 0,
    "artist": 1,
    "copyright": 3,
    "character": 4,
    "meta": 5,
}

ESCAPED_PUNCTUATION_RE = re.compile(r"\\+([(){}\[\]])")
SPACE_RE = re.compile(r"\s+")
TRAILING_PAREN_RE = re.compile(r"^(.*?)\s*\(([^()]*)\)\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the compact local Danbooru SQLite/FTS index used by Tauri.")
    parser.add_argument("--input-dir", type=Path, default=Path("public/data/danbooru"))
    parser.add_argument("--aliases", type=Path, default=Path("public/data/tag-aliases.json"))
    parser.add_argument("--output", type=Path, default=Path("src-tauri/resources/danbooru.sqlite"))
    parser.add_argument("--gzip", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--keep-sqlite", action="store_true", help="Keep the uncompressed SQLite file after creating the gzip resource.")
    return parser.parse_args()


def unescape_display(value: str) -> str:
    return ESCAPED_PUNCTUATION_RE.sub(r"\1", value.replace("_", " "))


def norm(value: object) -> str:
    return SPACE_RE.sub(" ", unescape_display(str(value)).lower()).strip()


def split_trailing_parenthetical(value: str) -> tuple[str, str]:
    match = TRAILING_PAREN_RE.match(value)
    if not match:
        return value, ""
    return match.group(1).strip(), match.group(2).strip()


def load_local_aliases(path: Path) -> tuple[dict[str, list[str]], dict[tuple[str, str], list[str]]]:
    if not path.exists():
        return {}, {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    exact: dict[str, list[str]] = {}
    structured: dict[tuple[str, str], list[str]] = {}
    for raw_key, values in payload.items():
        key = norm(raw_key)
        aliases = [str(v).strip() for v in values if str(v).strip()]
        if not aliases:
            continue
        exact[key] = aliases
        base, suffix = split_trailing_parenthetical(key)
        if suffix:
            structured[(base, suffix)] = aliases
    return exact, structured


def resolve_local_aliases(
    raw: str,
    upstream_aliases: list[str],
    exact: dict[str, list[str]],
    structured: dict[tuple[str, str], list[str]],
) -> list[str]:
    raw_norm = norm(raw)
    if raw_norm in exact:
        return exact[raw_norm]

    _, raw_suffix = split_trailing_parenthetical(raw_norm)
    if raw_suffix:
        for upstream in upstream_aliases:
            upstream_norm = norm(upstream)
            values = structured.get((upstream_norm, raw_suffix))
            if values:
                return values
    return []


def create_database(output: Path) -> sqlite3.Connection:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    conn = sqlite3.connect(output)
    conn.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        PRAGMA locking_mode=EXCLUSIVE;
        PRAGMA page_size=4096;

        CREATE TABLE tags (
          id INTEGER PRIMARY KEY,
          raw TEXT NOT NULL UNIQUE,
          category INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_tags_category_raw ON tags(category, raw);

        -- contentless keeps the DB much smaller: the canonical tag data lives in tags,
        -- while FTS stores only the inverted search index for names/aliases/tokens.
        CREATE VIRTUAL TABLE tag_fts USING fts5(
          terms,
          content='',
          tokenize='unicode61 remove_diacritics 2'
        );
        """
    )
    return conn


def build_index(args: argparse.Namespace) -> tuple[int, str]:
    manifest_path = args.input_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    version = str(manifest.get("build_info", {}).get("version") or "unknown")
    exact_aliases, structured_aliases = load_local_aliases(args.aliases)

    conn = create_database(args.output)
    cursor = conn.cursor()
    next_id = 0
    total = 0

    for filename, category in CATEGORY_FILES.items():
        source = args.input_dir / f"{filename}.json"
        rows = json.loads(source.read_text(encoding="utf-8"))
        tag_batch: list[tuple[int, str, int, int]] = []
        fts_batch: list[tuple[int, str]] = []

        for item in rows:
            raw = str(item.get("name") or item.get("tag") or "").strip()
            if not raw:
                continue
            next_id += 1
            upstream_aliases = [str(v).strip() for v in item.get("aliases", []) if str(v).strip()]
            local_aliases = resolve_local_aliases(raw, upstream_aliases, exact_aliases, structured_aliases)

            canonical_norm = norm(raw)
            seen = {canonical_norm}
            search_terms = [canonical_norm]
            for alias in [*upstream_aliases, *local_aliases]:
                normalized = norm(alias)
                if normalized and normalized not in seen:
                    seen.add(normalized)
                    search_terms.append(normalized)

            tag_batch.append((next_id, raw, category, int(item.get("post_count") or item.get("count") or 0)))
            fts_batch.append((next_id, " ".join(search_terms)))

            if len(tag_batch) >= 5000:
                cursor.executemany("INSERT INTO tags(id,raw,category,count) VALUES(?,?,?,?)", tag_batch)
                cursor.executemany("INSERT INTO tag_fts(rowid,terms) VALUES(?,?)", fts_batch)
                tag_batch.clear()
                fts_batch.clear()

        if tag_batch:
            cursor.executemany("INSERT INTO tags(id,raw,category,count) VALUES(?,?,?,?)", tag_batch)
            cursor.executemany("INSERT INTO tag_fts(rowid,terms) VALUES(?,?)", fts_batch)

        conn.commit()
        total += len(rows)
        print(f"{filename:10s} {len(rows):>9,} indexed")

    cursor.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    cursor.executemany(
        "INSERT INTO metadata(key,value) VALUES(?,?)",
        [
            ("source", str(manifest.get("source") or "NEXTAltair/genai-image-tag-db")),
            ("version", version),
            ("schema", "nai-tagdb-v1"),
            ("tag_count", str(total)),
        ],
    )
    cursor.execute("PRAGMA optimize")
    conn.commit()
    conn.close()

    if args.gzip:
        gz_path = args.output.with_suffix(args.output.suffix + ".gz")
        with args.output.open("rb") as src, gzip.open(gz_path, "wb", compresslevel=9) as dst:
            while chunk := src.read(1024 * 1024):
                dst.write(chunk)
        print(f"compressed -> {gz_path} ({gz_path.stat().st_size / 1024 / 1024:.1f} MiB)")
        if not args.keep_sqlite:
            args.output.unlink(missing_ok=True)

    version_path = args.output.parent / "danbooru.version"
    version_path.write_text(version + "\n", encoding="utf-8")
    if args.output.exists():
        print(f"database   -> {args.output} ({args.output.stat().st_size / 1024 / 1024:.1f} MiB)")
    print(f"version    -> {version_path}: {version}")
    return total, version


def main() -> None:
    args = parse_args()
    build_index(args)


if __name__ == "__main__":
    main()
