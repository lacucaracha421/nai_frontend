#!/usr/bin/env python3
"""Build compact local Danbooru autocomplete files from NEXTAltair/genai-image-tag-db.

Requires:
  pip install pyarrow huggingface_hub

By default this script fetches the newest files from the dataset's main branch,
reads the Danbooru parquet export, removes zero-count noise, and writes one JSON
file per category so the tablet app can lazy-load only what a prompt field needs.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Iterable

try:
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download, list_repo_files
except ImportError as exc:
    raise SystemExit(
        "Missing dependencies. Run: pip install pyarrow huggingface_hub"
    ) from exc

REPO_ID = "NEXTAltair/genai-image-tag-db"
CATEGORY_MAP = {
    "general": 0,
    "artist": 1,
    "copyright": 3,
    "character": 4,
    "meta": 5,
}
DEFAULT_MIN_COUNT = {
    "artist": 1,
    "character": 1,
    "copyright": 1,
    "general": 10,
    "meta": 10,
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", default=REPO_ID)
    p.add_argument("--revision", default="main")
    p.add_argument("--input-dir", type=Path, help="Use already downloaded parquet files instead of Hugging Face")
    p.add_argument("--output-dir", type=Path, default=Path("public/data/danbooru"))
    p.add_argument("--cache-dir", type=Path, default=Path(".cache/nextaltair-danbooru"))
    p.add_argument("--min-general", type=int, default=DEFAULT_MIN_COUNT["general"])
    p.add_argument("--min-meta", type=int, default=DEFAULT_MIN_COUNT["meta"])
    p.add_argument("--min-artist", type=int, default=DEFAULT_MIN_COUNT["artist"])
    p.add_argument("--min-character", type=int, default=DEFAULT_MIN_COUNT["character"])
    p.add_argument("--min-copyright", type=int, default=DEFAULT_MIN_COUNT["copyright"])
    return p.parse_args()


def source_files(repo: str, revision: str, cache_dir: Path, input_dir: Path | None) -> tuple[list[Path], str]:
    if input_dir:
        files = sorted(input_dir.glob("*.parquet"))
        if not files:
            raise SystemExit(f"No parquet files found in {input_dir}")
        return files, "local"

    # Prefer files tracked on main. Some HF datasets expose the viewer conversion
    # only under refs/convert/parquet, so fall back to that ref automatically.
    candidates = [
        (revision, "parquet_danbooru/"),
        ("refs/convert/parquet", "default/parquet_danbooru/"),
    ]
    for ref, prefix in candidates:
        try:
            names = [
                f for f in list_repo_files(repo, repo_type="dataset", revision=ref)
                if f.startswith(prefix) and f.endswith(".parquet")
            ]
        except Exception:
            names = []
        if not names:
            continue
        cache_dir.mkdir(parents=True, exist_ok=True)
        paths = [
            Path(hf_hub_download(repo, name, repo_type="dataset", revision=ref, cache_dir=str(cache_dir)))
            for name in sorted(names)
        ]
        return paths, ref
    raise SystemExit("Could not locate parquet_danbooru files in the dataset repository")


def load_build_info(repo: str, revision: str, cache_dir: Path) -> dict:
    try:
        path = hf_hub_download(repo, "build_manifest.json", repo_type="dataset", revision=revision, cache_dir=str(cache_dir))
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data.get("build_info", data)
    except Exception as exc:
        return {"version": "unknown", "warning": str(exc)}


def flatten_list(value) -> list[str]:
    if value is None:
        return []
    if hasattr(value, "as_py"):
        value = value.as_py()
    if not isinstance(value, list):
        value = [value]
    out: list[str] = []
    seen = set()
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def iter_rows(files: Iterable[Path]):
    columns = ["tag", "type_name", "count", "deprecated_tags", "lang_ja", "lang_zh"]
    for file in files:
        pf = pq.ParquetFile(file)
        for batch in pf.iter_batches(columns=columns, batch_size=50_000):
            data = batch.to_pydict()
            for i in range(batch.num_rows):
                yield {key: data[key][i] for key in columns}


def main() -> None:
    args = parse_args()
    files, parquet_revision = source_files(args.repo, args.revision, args.cache_dir, args.input_dir)
    mins = {
        "general": args.min_general,
        "artist": args.min_artist,
        "copyright": args.min_copyright,
        "character": args.min_character,
        "meta": args.min_meta,
    }
    buckets: dict[str, list[dict]] = {k: [] for k in CATEGORY_MAP}

    for row in iter_rows(files):
        kind = str(row["type_name"] or "").strip().lower()
        if kind not in CATEGORY_MAP:
            continue
        count = int(row["count"] or 0)
        if count < mins[kind]:
            continue
        tag = str(row["tag"] or "").strip()
        if not tag:
            continue
        aliases = []
        seen = {tag}
        for source in (row["deprecated_tags"], row["lang_ja"], row["lang_zh"]):
            for alias in flatten_list(source):
                if alias not in seen:
                    seen.add(alias)
                    aliases.append(alias)
        buckets[kind].append({
            "name": tag,
            "category": CATEGORY_MAP[kind],
            "post_count": count,
            "aliases": aliases,
        })

    args.output_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    for kind, rows in buckets.items():
        rows.sort(key=lambda r: (-r["post_count"], r["name"]))
        target = args.output_dir / f"{kind}.json"
        target.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        counts[kind] = len(rows)
        print(f"{kind:10s} {len(rows):>9,} -> {target}")

    build_info = load_build_info(args.repo, args.revision, args.cache_dir)
    manifest = {
        "source": args.repo,
        "requested_revision": args.revision,
        "parquet_revision": parquet_revision,
        "build_info": build_info,
        "minimum_post_count": mins,
        "counts": counts,
        "columns": ["tag", "type_name", "count", "deprecated_tags", "lang_ja", "lang_zh"],
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("manifest ->", args.output_dir / "manifest.json")


if __name__ == "__main__":
    main()
