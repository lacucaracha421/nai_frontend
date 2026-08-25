from __future__ import annotations

import gzip
import json
import pathlib
import re
import sqlite3
import urllib.parse
import urllib.request

MIN_POST_COUNT = 1_000
OUTPUT = pathlib.Path("public/data/sexual-tags.json")
DATABASE_GZ = pathlib.Path("src-tauri/resources/danbooru.sqlite.gz")
TEMP_DATABASE = pathlib.Path(".agent/danbooru-sex-build.sqlite")
USER_AGENT = "nai-v5-studio-personal/1.0"

SOURCES = {
    "core": "sex",
    "acts": "tag_group:sex_acts",
    "positions": "tag_group:sexual_positions",
}


def normalize(value: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        value.replace("_", " ").replace(r"\(", "(").replace(r"\)", ")").strip().lower(),
    )


def display_name(value: str) -> str:
    return value.replace(r"\(", "(").replace(r"\)", ")").replace("_", " ")


def wiki_tags(slug: str) -> set[str]:
    url = "https://danbooru.donmai.us/wiki_pages/" + urllib.parse.quote(slug, safe="") + ".json"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        page = json.load(response)

    result: set[str] = set()
    for match in re.findall(r"\[\[([^\]|#]+)", page.get("body", "")):
        name = match.strip()
        if not name or name.lower() == "tag groups" or name.lower().startswith("tag group:"):
            continue
        result.add(name)
    return result


def act_subgroups(name: str) -> list[str]:
    n = normalize(name)
    groups: list[str] = []

    def add(group: str) -> None:
        if group not in groups:
            groups.append(group)

    if any(word in n for word in ("anal", "anilingus", "ass insertion", "pegging")):
        add("anal")
    if any(word in n for word in ("fellatio", "cunnilingus", "oral", "deepthroat", "irrumatio", "anilingus", "gokkun", "sucking", "licking")):
        add("oral")
    if any(word in n for word in ("vaginal", "penetration", "insert", "sex", "defloration")):
        add("penetration")
    if any(word in n for word in ("handjob", "fingering", "masturbation", "footjob", "crotch rub", "frottage", "tribadism", "job")):
        add("manual")
    if any(word in n for word in ("paizuri", "breast", "nipple", "pectoral", "lactation")):
        add("breast")
    if any(word in n for word in ("threesome", "gangbang", "group sex", "orgy", "foursome", "fivesome", "spitroast")):
        add("group")
    if any(word in n for word in ("object", "strap-on", "vibrator", "dildo", "enema", "sounding", "machine")):
        add("toys")
    if any(word in n for word in ("cum", "ejaculat", "bukkake", "facial", "pussy juice")):
        add("fluids")
    if not groups:
        add("other")
    return groups


def position_subgroups(name: str) -> list[str]:
    n = normalize(name)
    groups: list[str] = []

    def add(group: str) -> None:
        if group not in groups:
            groups.append(group)

    if any(word in n for word in ("behind", "doggystyle", "prone bone")):
        add("rear")
    if any(word in n for word in ("cowgirl", "on top", "straddle", "amazon position")):
        add("top")
    if any(word in n for word in ("missionary", "mating press", "piledriver", "anvil position")):
        add("front")
    if any(word in n for word in ("standing", "upright")):
        add("standing")
    if any(word in n for word in ("sitting", "lap")):
        add("sitting")
    if any(word in n for word in ("on side", "spooning", "folded", "knees to chest", "lying")):
        add("lying")
    if any(word in n for word in ("kneel", "kneepit")):
        add("kneeling")
    if not groups:
        add("other")
    return groups


def main() -> None:
    source_membership: dict[str, set[str]] = {}
    for group, slug in SOURCES.items():
        for name in wiki_tags(slug):
            source_membership.setdefault(normalize(name), set()).add(group)

    with gzip.open(DATABASE_GZ, "rb") as source, TEMP_DATABASE.open("wb") as target:
        target.write(source.read())

    connection = sqlite3.connect(TEMP_DATABASE)
    rows = connection.execute("select raw, category, count from tags").fetchall()
    connection.close()
    TEMP_DATABASE.unlink(missing_ok=True)

    index = {normalize(raw): (raw, category, int(count)) for raw, category, count in rows}
    result: list[dict[str, object]] = []

    for key, membership in source_membership.items():
        row = index.get(key)
        if row is None:
            # The local Danbooru snapshot cannot establish popularity for this tag,
            # so it is intentionally omitted from the curated collection.
            continue
        raw, category, count = row
        if category != 0 or count < MIN_POST_COUNT:
            continue

        item: dict[str, object] = {
            "raw": raw,
            "display": display_name(raw),
            "count": count,
            "groups": sorted(membership),
        }
        if "acts" in membership:
            item["actGroups"] = act_subgroups(raw)
        if "positions" in membership:
            item["positionGroups"] = position_subgroups(raw)
        result.append(item)

    result.sort(key=lambda item: (-int(item["count"]), str(item["display"]).lower()))
    payload = {
        "source": "Danbooru wiki: sex + tag_group:sex_acts + tag_group:sexual_positions",
        "generated": "2026-08-26",
        "minPostCount": MIN_POST_COUNT,
        "tags": result,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    print(f"MIN_POST_COUNT={MIN_POST_COUNT}")
    print(f"TAG_COUNT={len(result)}")
    for group in SOURCES:
        print(f"{group.upper()}={sum(group in item['groups'] for item in result)}")


if __name__ == "__main__":
    main()
