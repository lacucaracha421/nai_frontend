from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SNAPSHOT_REPO = "baton4ik/danbooru-tag-metadata-snapshot"
SNAPSHOT_DB_URL = (
    "https://huggingface.co/datasets/"
    f"{SNAPSHOT_REPO}/resolve/main/booru_snapshot.sqlite?download=true"
)
SNAPSHOT_METADATA_URL = (
    "https://huggingface.co/datasets/"
    f"{SNAPSHOT_REPO}/resolve/main/metadata.json?download=true"
)
DANBOORU_BASE = "https://danbooru.donmai.us"
DEFAULT_MIN_POST_COUNT = 10
DEFAULT_USER_AGENT = "nai-frontend-tag-sync/1.0 (+https://github.com/lacucaracha421/nai_frontend)"
VALID_CATEGORIES = (0, 1, 3, 4, 5)
DEFAULT_REQUIRED_TAGS = ("runami_yachiyo",)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build the NAI local autocomplete database from a public Danbooru snapshot, "
            "then apply only official Danbooru API changes made after that snapshot."
        )
    )
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/danbooru-official"))
    parser.add_argument("--output", type=Path, default=Path("src-tauri/resources/danbooru.sqlite"))
    parser.add_argument("--min-post-count", type=int, default=DEFAULT_MIN_POST_COUNT)
    parser.add_argument("--api-delay", type=float, default=0.20, help="Delay between Danbooru API requests in seconds.")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--refresh-snapshot", action="store_true")
    parser.add_argument("--keep-sqlite", action="store_true")
    parser.add_argument("--no-gzip", action="store_true")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument(
        "--require-tag",
        action="append",
        default=list(DEFAULT_REQUIRED_TAGS),
        help="Canonical tag that must exist in the final database. May be repeated.",
    )
    return parser.parse_args()


def request_bytes(url: str, user_agent: str, timeout: float, retries: int = 5) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError) as error:
            last_error = error
            if attempt + 1 >= retries:
                break
            wait = min(8.0, 0.75 * (2**attempt))
            print(f"request failed ({error}); retrying in {wait:.2f}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Could not fetch {url}: {last_error}")


def download_file(url: str, target: Path, user_agent: str, timeout: float) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".part")
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "*/*"})
    try:
        with urlopen(request, timeout=timeout) as response, temp.open("wb") as output:
            total_header = response.headers.get("Content-Length")
            total = int(total_header) if total_header and total_header.isdigit() else 0
            downloaded = 0
            last_report = time.monotonic()
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                now = time.monotonic()
                if now - last_report >= 2.0:
                    if total:
                        print(f"  {downloaded / 1024 / 1024:.1f} / {total / 1024 / 1024:.1f} MiB")
                    else:
                        print(f"  {downloaded / 1024 / 1024:.1f} MiB")
                    last_report = now
        temp.replace(target)
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def ensure_snapshot(args: argparse.Namespace) -> tuple[Path, dict]:
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    database = args.cache_dir / "booru_snapshot.sqlite"
    metadata_path = args.cache_dir / "metadata.json"

    if args.refresh_snapshot or not metadata_path.exists():
        print("Downloading Danbooru snapshot metadata...")
        metadata_path.write_bytes(request_bytes(SNAPSHOT_METADATA_URL, args.user_agent, args.timeout))

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if args.refresh_snapshot or not database.exists():
        print("Downloading Danbooru SQLite snapshot...")
        download_file(SNAPSHOT_DB_URL, database, args.user_agent, args.timeout)

    return database, metadata


def api_pages(
    endpoint: str,
    since: str,
    *,
    user_agent: str,
    timeout: float,
    delay: float,
) -> Iterable[list[dict]]:
    cursor: int | None = None
    previous_cursor: int | None = None
    page_no = 0

    while True:
        params: dict[str, str | int] = {
            "limit": 1000,
            "search[updated_at]": f">{since}",
        }
        if cursor is not None:
            params["page"] = f"b{cursor}"
        url = f"{DANBOORU_BASE}/{endpoint}.json?{urlencode(params)}"
        payload = json.loads(request_bytes(url, user_agent, timeout).decode("utf-8"))
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected {endpoint} API response: {type(payload).__name__}")
        rows = [row for row in payload if isinstance(row, dict)]
        if not rows:
            break

        page_no += 1
        print(f"  {endpoint}: page {page_no}, {len(rows)} changed rows")
        yield rows

        ids = [int(row["id"]) for row in rows if row.get("id") is not None]
        if not ids or len(rows) < 1000:
            break
        cursor = min(ids)
        if cursor == previous_cursor:
            raise RuntimeError(f"Danbooru {endpoint} pagination cursor stopped advancing at {cursor}")
        previous_cursor = cursor
        if delay > 0:
            time.sleep(delay)


def create_output_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    connection = sqlite3.connect(path)
    connection.executescript(
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

        CREATE TABLE source_aliases (
          id INTEGER PRIMARY KEY,
          antecedent_name TEXT NOT NULL,
          consequent_name TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE INDEX idx_source_aliases_target ON source_aliases(status, consequent_name);

        CREATE VIRTUAL TABLE tag_fts USING fts5(
          terms,
          content='',
          tokenize='unicode61 remove_diacritics 2'
        );
        """
    )
    return connection


def seed_from_snapshot(
    connection: sqlite3.Connection,
    snapshot_path: Path,
    min_post_count: int,
) -> tuple[int, int]:
    connection.execute("ATTACH DATABASE ? AS snapshot", (str(snapshot_path.resolve()),))
    allowed = ",".join(str(value) for value in VALID_CATEGORIES)
    connection.execute(
        f"""
        INSERT INTO tags(id,raw,category,count)
        SELECT id,name,category,post_count
        FROM snapshot.tags
        WHERE COALESCE(is_deprecated,0)=0
          AND post_count>=?
          AND category IN ({allowed})
        """,
        (min_post_count,),
    )
    connection.execute(
        """
        INSERT INTO source_aliases(id,antecedent_name,consequent_name,status)
        SELECT id,antecedent_name,consequent_name,status
        FROM snapshot.tag_aliases
        """
    )
    tag_count = int(connection.execute("SELECT count(*) FROM tags").fetchone()[0])
    alias_count = int(connection.execute("SELECT count(*) FROM source_aliases").fetchone()[0])
    connection.execute("DETACH DATABASE snapshot")
    connection.commit()
    return tag_count, alias_count


def apply_tag_changes(connection: sqlite3.Connection, pages: Iterable[list[dict]], min_post_count: int) -> int:
    changed = 0
    for rows in pages:
        with connection:
            for row in rows:
                tag_id = int(row.get("id") or 0)
                raw = str(row.get("name") or "").strip()
                category = int(row.get("category") if row.get("category") is not None else -1)
                post_count = int(row.get("post_count") or 0)
                deprecated = bool(row.get("is_deprecated"))
                if tag_id <= 0:
                    continue
                connection.execute("DELETE FROM tags WHERE id=?", (tag_id,))
                if raw:
                    connection.execute("DELETE FROM tags WHERE raw=? AND id<>?", (raw, tag_id))
                if raw and not deprecated and category in VALID_CATEGORIES and post_count >= min_post_count:
                    connection.execute(
                        "INSERT INTO tags(id,raw,category,count) VALUES(?,?,?,?)",
                        (tag_id, raw, category, post_count),
                    )
                changed += 1
    return changed


def apply_alias_changes(connection: sqlite3.Connection, pages: Iterable[list[dict]]) -> int:
    changed = 0
    for rows in pages:
        with connection:
            for row in rows:
                alias_id = int(row.get("id") or 0)
                antecedent = str(row.get("antecedent_name") or "").strip()
                consequent = str(row.get("consequent_name") or "").strip()
                status = str(row.get("status") or "").strip().lower()
                if alias_id <= 0:
                    continue
                connection.execute("DELETE FROM source_aliases WHERE id=?", (alias_id,))
                if antecedent and consequent and status:
                    connection.execute(
                        "INSERT INTO source_aliases(id,antecedent_name,consequent_name,status) VALUES(?,?,?,?)",
                        (alias_id, antecedent, consequent, status),
                    )
                changed += 1
    return changed


def build_fts(connection: sqlite3.Connection) -> None:
    print("Building FTS5 index...")
    connection.execute("DELETE FROM tag_fts")
    connection.execute(
        """
        INSERT INTO tag_fts(rowid,terms)
        SELECT
          t.id,
          replace(t.raw, '_', ' ') ||
          CASE
            WHEN count(a.id)=0 THEN ''
            ELSE ' ' || group_concat(replace(a.antecedent_name, '_', ' '), ' ')
          END
        FROM tags t
        LEFT JOIN source_aliases a
          ON a.consequent_name=t.raw
         AND a.status='active'
        GROUP BY t.id
        """
    )
    connection.execute("DROP TABLE source_aliases")
    connection.execute("PRAGMA optimize")
    connection.commit()


def write_metadata(
    connection: sqlite3.Connection,
    *,
    snapshot_built_at: str,
    min_post_count: int,
    tag_changes: int,
    alias_changes: int,
) -> str:
    synced_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    version = "danbooru-official-" + synced_at.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "Z")
    tag_count = int(connection.execute("SELECT count(*) FROM tags").fetchone()[0])
    connection.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    connection.executemany(
        "INSERT INTO metadata(key,value) VALUES(?,?)",
        [
            ("source", "Danbooru official API"),
            ("snapshot_source", SNAPSHOT_REPO),
            ("snapshot_built_at", snapshot_built_at),
            ("synced_at", synced_at),
            ("version", version),
            ("schema", "nai-tagdb-v2"),
            ("minimum_post_count", str(min_post_count)),
            ("tag_count", str(tag_count)),
            ("incremental_tag_rows", str(tag_changes)),
            ("incremental_alias_rows", str(alias_changes)),
        ],
    )
    connection.commit()
    return version


def validate(connection: sqlite3.Connection, required_tags: list[str]) -> None:
    count = int(connection.execute("SELECT count(*) FROM tags").fetchone()[0])
    if count < 1000:
        raise RuntimeError(f"Generated Danbooru database is unexpectedly small ({count} tags).")
    missing = []
    for raw in dict.fromkeys(required_tags):
        row = connection.execute("SELECT category,count FROM tags WHERE raw=?", (raw,)).fetchone()
        if row is None:
            missing.append(raw)
        else:
            print(f"validated tag: {raw} (category={row[0]}, posts={row[1]})")
    if missing:
        raise RuntimeError("Required Danbooru tag(s) missing from generated database: " + ", ".join(missing))


def compress_database(path: Path) -> Path:
    target = path.with_suffix(path.suffix + ".gz")
    temp = target.with_suffix(target.suffix + ".part")
    with path.open("rb") as source, gzip.open(temp, "wb", compresslevel=9) as output:
        shutil.copyfileobj(source, output, length=1024 * 1024)
    temp.replace(target)
    return target


def main() -> None:
    args = parse_args()
    if args.min_post_count < 0:
        raise SystemExit("--min-post-count must be zero or greater")

    snapshot_path, snapshot_metadata = ensure_snapshot(args)
    snapshot_built_at = str(snapshot_metadata.get("snapshot_built_at") or "").strip()
    if not snapshot_built_at:
        raise RuntimeError("Snapshot metadata does not contain snapshot_built_at")

    print(f"Snapshot: {snapshot_built_at}")
    print(f"Minimum post count: {args.min_post_count}")

    connection = create_output_database(args.output)
    try:
        seeded_tags, seeded_aliases = seed_from_snapshot(connection, snapshot_path, args.min_post_count)
        print(f"Seeded {seeded_tags:,} tags and {seeded_aliases:,} aliases from snapshot")

        print("Applying official Danbooru tag changes after snapshot...")
        tag_changes = apply_tag_changes(
            connection,
            api_pages(
                "tags",
                snapshot_built_at,
                user_agent=args.user_agent,
                timeout=args.timeout,
                delay=args.api_delay,
            ),
            args.min_post_count,
        )

        print("Applying official Danbooru alias changes after snapshot...")
        alias_changes = apply_alias_changes(
            connection,
            api_pages(
                "tag_aliases",
                snapshot_built_at,
                user_agent=args.user_agent,
                timeout=args.timeout,
                delay=args.api_delay,
            ),
        )

        build_fts(connection)
        version = write_metadata(
            connection,
            snapshot_built_at=snapshot_built_at,
            min_post_count=args.min_post_count,
            tag_changes=tag_changes,
            alias_changes=alias_changes,
        )
        validate(connection, args.require_tag)
        connection.execute("VACUUM")
        connection.commit()
    finally:
        connection.close()

    version_path = args.output.parent / "danbooru.version"
    version_path.write_text(version + "\n", encoding="utf-8")

    print(f"database -> {args.output} ({args.output.stat().st_size / 1024 / 1024:.1f} MiB)")
    if not args.no_gzip:
        compressed = compress_database(args.output)
        print(f"compressed -> {compressed} ({compressed.stat().st_size / 1024 / 1024:.1f} MiB)")
        if not args.keep_sqlite:
            args.output.unlink(missing_ok=True)
    print(f"version -> {version_path}: {version}")


if __name__ == "__main__":
    main()
