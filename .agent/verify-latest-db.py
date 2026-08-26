import gzip
import os
import shutil
import sqlite3
import tempfile

src = r"src-tauri\resources\danbooru.sqlite.gz"
fd, tmp = tempfile.mkstemp(suffix=".sqlite")
os.close(fd)
db = None

try:
    with gzip.open(src, "rb") as fsrc, open(tmp, "wb") as fdst:
        shutil.copyfileobj(fsrc, fdst)

    db = sqlite3.connect(tmp)
    cols = [row[1] for row in db.execute("pragma table_info(tags)")]
    print("tag columns:", cols)
    if "raw" not in cols:
        raise RuntimeError("tags.raw column is missing")

    rows = db.execute(
        "select raw, category, count from tags "
        "where lower(raw) like ? or lower(raw) like ? limit 30",
        ("%runami%", "%yachiyo%"),
    ).fetchall()
    print("runami/yachiyo matches:", rows)

    normalized = [str(row[0]).lower().replace("_", " ") for row in rows]
    if not any("runami" in name and "yachiyo" in name for name in normalized):
        raise AssertionError("runami yachiyo is missing from latest Danbooru DB")

    print("RUNAMI_YACHIYO_OK")
finally:
    if db is not None:
        db.close()
    if os.path.exists(tmp):
        os.remove(tmp)
