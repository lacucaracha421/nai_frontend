import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PromptSectionKey } from "../../types/generation";
import { Icon } from "../../components/Icon";
import { splitTags } from "../prompt/tagChips";
import { compositionGlyph } from "./compositionGlyphs";
import {
  QUICKCOPY_UPDATED_EVENT,
  fetchDefaultDictionaryTags,
  formatArtistPrompt,
  readQuickCopyData,
  writeQuickCopyData,
  type StoredQuickCopy,
  type StoredTag,
} from "./quickCopyStorage";
import { classifySexTag, SEX_CATEGORY_ORDER, type RawSexTag } from "./sexTagMetadata";
import type { ManageableDictTab } from "./TagDictionaryManagerSheet";
import "./inlineDictionary.css";

export type InlineDictCategory = "artists" | "tags" | "actions" | "sex";

type DictItem = {
  key: string;
  title: string;
  prompt: string;
  tooltip: string;
  sub: string;
  search: string;
  pinned: boolean;
  glyph?: ReactNode;
  noise?: boolean;
};

const TAG_SECTION_ORDER = [
  "품질",
  "제외",
  "시점",
  "프레이밍",
  "렌즈·원근",
  "구도",
  "초점",
  "화면 효과",
  "V5",
];

function normTag(value: string) {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function defaultDictCategory(destination: PromptSectionKey): InlineDictCategory {
  if (destination === "artist") return "artists";
  if (destination === "other") return "actions";
  return "tags";
}

function orderSubCategories(present: string[], preferred: string[]) {
  const seen = new Set(present);
  const ordered: string[] = [];
  for (const name of preferred) {
    if (seen.has(name)) {
      ordered.push(name);
      seen.delete(name);
    }
  }
  for (const name of present) {
    if (seen.has(name)) {
      ordered.push(name);
      seen.delete(name);
    }
  }
  return ordered;
}

type Props = {
  destination: PromptSectionKey;
  currentValue: string;
  onToggleTag: (prompt: string) => void;
  onOpenManager?: (tab: ManageableDictTab) => void;
  onClose: () => void;
};

export function InlineTagDictionary({ destination, currentValue, onToggleTag, onOpenManager, onClose }: Props) {
  const [cat, setCat] = useState<InlineDictCategory>(() => defaultDictCategory(destination));
  const [query, setQuery] = useState("");
  const [sub, setSub] = useState("전체");
  const [favOnly, setFavOnly] = useState(false);
  const [defaultTags, setDefaultTags] = useState<StoredTag[]>([]);
  const [stored, setStored] = useState<StoredQuickCopy>(() => readQuickCopyData());
  const [sexTags, setSexTags] = useState<RawSexTag[]>([]);
  const [sexFavs, setSexFavs] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("nai-v5-sex-dict-favs");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    setCat(defaultDictCategory(destination));
    setSub("전체");
  }, [destination]);

  useEffect(() => {
    let cancelled = false;
    void fetchDefaultDictionaryTags().then((rows) => {
      if (cancelled) return;
      setDefaultTags(rows);
      setStored(readQuickCopyData(rows));
    });
    void fetch("/data/sexual-tags.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!cancelled && payload && Array.isArray(payload.tags)) {
          setSexTags(payload.tags as RawSexTag[]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sync = () => setStored(readQuickCopyData(defaultTags));
    window.addEventListener(QUICKCOPY_UPDATED_EVENT, sync);
    return () => window.removeEventListener(QUICKCOPY_UPDATED_EVENT, sync);
  }, [defaultTags]);

  const currentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tag of splitTags(currentValue)) {
      const key = normTag(tag);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [currentValue]);

  const items = useMemo<DictItem[]>(() => {
    if (cat === "artists") {
      return stored.artists
        .filter((a) => a && typeof a.name === "string" && a.name.trim())
        .map((a) => {
          const prompt = formatArtistPrompt(a.name);
          const displayTitle = (a.title ?? "").trim() || a.name.trim();
          return {
            key: `artist:${a.name}`,
            title: displayTitle,
            prompt,
            tooltip: prompt,
            sub: "작가",
            search: `${a.title ?? ""} ${a.name} ${a.note ?? ""}`.toLowerCase(),
            pinned: !!a.pinned,
          };
        });
    }
    if (cat === "actions") {
      return stored.actions
        .map((a) => {
          const prompt = (a.prompt ?? a.name ?? "").trim();
          const title = (a.title ?? a.name ?? prompt).trim();
          return {
            key: `action:${prompt}`,
            title,
            prompt,
            tooltip: prompt,
            sub: (a.category ?? "행동").trim() || "행동",
            search: `${title} ${prompt} ${a.aliases ?? ""} ${a.note ?? ""}`.toLowerCase(),
            pinned: !!a.pinned,
          };
        })
        .filter((item) => item.prompt);
    }
    if (cat === "tags") {
      return stored.tags
        .filter((t) => t && t.prompt)
        .map((t) => {
          const prompt = t.prompt.trim();
          const title = (t.title || prompt).trim();
          const description = (t.description ?? "").trim();
          return {
            key: `tag:${prompt}`,
            title,
            prompt,
            tooltip: description ? `${prompt} — ${description}` : prompt,
            sub: (t.category || "기타").trim(),
            search: `${title} ${prompt} ${t.category ?? ""} ${t.aliases ?? ""} ${description} ${t.note ?? ""}`.toLowerCase(),
            pinned: !!t.pinned,
            glyph: compositionGlyph(prompt),
          };
        });
    }
    return sexTags.map((t) => {
      const { title, category, isNoise } = classifySexTag(t);
      return {
        key: `sex:${t.display}`,
        title,
        prompt: t.display,
        tooltip: title !== t.display ? `${t.display} (${category})` : t.display,
        sub: category,
        search: `${title} ${t.display} ${t.raw} ${category}`.toLowerCase(),
        pinned: sexFavs.has(t.display),
        noise: isNoise,
      };
    });
  }, [cat, stored, sexTags, sexFavs]);

  const activeKeys = useMemo(() => {
    const active = new Set<string>();
    const remaining = new Map(currentCounts);
    for (const item of items) {
      const parts = splitTags(item.prompt).map(normTag);
      if (parts.length <= 1) continue;
      if (parts.every((part) => (currentCounts.get(part) ?? 0) > 0)) {
        active.add(item.key);
        for (const part of parts) {
          remaining.set(part, Math.max(0, (remaining.get(part) ?? 0) - 1));
        }
      }
    }
    for (const item of items) {
      const parts = splitTags(item.prompt).map(normTag);
      if (parts.length === 1 && (remaining.get(parts[0]) ?? 0) > 0) {
        active.add(item.key);
      }
    }
    return active;
  }, [items, currentCounts]);

  const subs = useMemo(() => {
    const present = Array.from(new Set(items.map((i) => i.sub))).filter(Boolean);
    if (present.length <= 1) return [];
    const ordered = cat === "sex"
      ? orderSubCategories(present, SEX_CATEGORY_ORDER)
      : cat === "tags"
        ? orderSubCategories(present, TAG_SECTION_ORDER)
        : present;
    return ["전체", ...ordered];
  }, [cat, items]);

  const activeSub = subs.includes(sub) ? sub : "전체";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((item) => {
      if (favOnly && !item.pinned) return false;
      if (activeSub !== "전체" && item.sub !== activeSub) return false;
      if (q && !item.search.includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => {
      const pinDiff = Number(b.pinned) - Number(a.pinned);
      if (pinDiff !== 0) return pinDiff;
      return Number(!!a.noise) - Number(!!b.noise);
    });
  }, [items, favOnly, activeSub, query]);

  const groupedSections = useMemo(() => {
    const shouldGroup = activeSub === "전체" && !query.trim() && !favOnly && subs.length > 1;
    if (!shouldGroup) return null;

    const pinnedItems = filtered.filter((item) => item.pinned);
    const rest = filtered.filter((item) => !item.pinned);
    const bySub = new Map<string, DictItem[]>();
    for (const item of rest) {
      const bucket = bySub.get(item.sub);
      if (bucket) bucket.push(item);
      else bySub.set(item.sub, [item]);
    }

    const sections: Array<{ label: string; items: DictItem[] }> = [];
    if (pinnedItems.length > 0) {
      sections.push({ label: "★ 즐겨찾기", items: pinnedItems });
    }
    for (const name of subs) {
      if (name === "전체") continue;
      const bucket = bySub.get(name);
      if (bucket && bucket.length > 0) {
        sections.push({ label: name, items: bucket });
      }
    }
    return sections;
  }, [activeSub, query, favOnly, subs, filtered]);

  const togglePin = (item: DictItem) => {
    if (cat === "sex") {
      const next = new Set(sexFavs);
      if (next.has(item.prompt)) next.delete(item.prompt);
      else next.add(item.prompt);
      setSexFavs(next);
      try { localStorage.setItem("nai-v5-sex-dict-favs", JSON.stringify(Array.from(next))); } catch {}
      return;
    }
    const next: StoredQuickCopy = {
      artists: [...stored.artists],
      actions: [...stored.actions],
      tags: [...stored.tags],
    };
    if (cat === "artists") {
      next.artists = next.artists.map((a) => (`artist:${a.name}` === item.key ? { ...a, pinned: !a.pinned } : a));
    } else if (cat === "actions") {
      next.actions = next.actions.map((a) => ((a.prompt ?? a.name ?? "").trim() === item.prompt ? { ...a, pinned: !a.pinned } : a));
    } else if (cat === "tags") {
      next.tags = next.tags.map((t) => (t.prompt.trim() === item.prompt ? { ...t, pinned: !t.pinned } : t));
    }
    setStored(next);
    writeQuickCopyData(next);
  };

  const renderCard = (item: DictItem) => {
    const added = activeKeys.has(item.key);
    return (
      <div
        key={item.key}
        role="button"
        tabIndex={0}
        className={`inline-dict-card ${added ? "added" : ""} ${item.glyph ? "has-glyph" : ""}`}
        title={item.tooltip}
        onClick={() => onToggleTag(item.prompt)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleTag(item.prompt);
          }
        }}
      >
        {item.glyph}
        <strong>{item.title}</strong>
        <button
          type="button"
          className={`inline-dict-star ${item.pinned ? "fav" : ""}`}
          aria-label="즐겨찾기"
          onClick={(event) => {
            event.stopPropagation();
            togglePin(item);
          }}
        >
          {item.pinned ? "★" : "☆"}
        </button>
      </div>
    );
  };

  return (
    <div className="inline-dict" role="region" aria-label="태그사전">
      <div className="inline-dict-head">
        <div className="inline-dict-cats" role="tablist">
          {([
            ["artists", "작가"],
            ["tags", "구도"],
            ["actions", "행동"],
            ["sex", "Sex"],
          ] as Array<[InlineDictCategory, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={cat === key}
              className={cat === key ? "active" : ""}
              onClick={() => { setCat(key); setSub("전체"); }}
            >
              {label}
            </button>
          ))}
        </div>
        {onOpenManager && cat !== "sex" && (
          <button
            type="button"
            className="inline-dict-edit-btn"
            onClick={() => onOpenManager(cat)}
          >
            편집
          </button>
        )}
        <button
          type="button"
          className={`inline-dict-icon ${favOnly ? "active" : ""}`}
          aria-pressed={favOnly}
          aria-label="즐겨찾기만 보기"
          onClick={() => setFavOnly((v) => !v)}
        >
          ★
        </button>
        <button type="button" className="inline-dict-icon" aria-label="태그사전 닫기" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>

      <div className="inline-dict-search-row">
        <input
          className="inline-dict-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="한글 / 영문 검색"
          aria-label="태그사전 검색"
        />
        {subs.length > 0 && (
          <div className="inline-dict-subs">
            {subs.map((name) => (
              <button
                key={name}
                type="button"
                className={activeSub === name ? "active" : ""}
                onClick={() => setSub(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="inline-dict-empty">
          {cat === "actions" && items.length === 0 ? "저장된 행동 태그가 없습니다." : "검색 결과가 없습니다."}
        </div>
      ) : (
        <div className="inline-dict-grid">
          {groupedSections ? (
            groupedSections.map((section, idx) => (
              <Fragment key={section.label}>
                <div className={`inline-dict-section-head ${idx === 0 ? "first" : ""}`}>
                  <span>{section.label}</span>
                  <small>{section.items.length}</small>
                </div>
                {section.items.map(renderCard)}
              </Fragment>
            ))
          ) : (
            filtered.slice(0, 300).map(renderCard)
          )}
        </div>
      )}
    </div>
  );
}
