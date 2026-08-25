import { useEffect, useMemo, useState } from "react";
import "./sexTagDictionary.css";

type PrimaryGroup = "all" | "core" | "acts" | "positions";
type SexualTag = {
  raw: string;
  display: string;
  count: number;
  groups?: Array<"core" | "acts" | "positions">;
  actGroups?: string[];
  positionGroups?: string[];
};

type SexualTagPayload = {
  source?: string;
  generated?: string;
  minPostCount?: number;
  tags?: SexualTag[];
};

const DEFAULT_MIN_POST_COUNT = 1_000;

const PRIMARY_LABELS: Array<[PrimaryGroup, string]> = [
  ["all", "전체"],
  ["core", "기본 Sex"],
  ["acts", "행위"],
  ["positions", "체위"],
];

const ACT_GROUPS: Array<[string, string]> = [
  ["all", "전체"],
  ["penetration", "삽입"],
  ["oral", "오럴"],
  ["anal", "애널"],
  ["manual", "수동"],
  ["breast", "가슴"],
  ["group", "집단"],
  ["toys", "도구"],
  ["fluids", "체액"],
  ["other", "기타"],
];

const POSITION_GROUPS: Array<[string, string]> = [
  ["all", "전체"],
  ["front", "정면"],
  ["rear", "후배위"],
  ["top", "위아래"],
  ["sitting", "앉음"],
  ["lying", "누움"],
  ["standing", "서기"],
  ["kneeling", "무릎"],
  ["other", "기타"],
];

function normalized(value: string) {
  return value
    .replace(/_/g, " ")
    .replaceAll("\\(", "(")
    .replaceAll("\\)", ")")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function SexTagDictionary({ onInsert }: { onInsert: (value: string) => void }) {
  const [tags, setTags] = useState<SexualTag[]>([]);
  const [query, setQuery] = useState("");
  const [primary, setPrimary] = useState<PrimaryGroup>("all");
  const [secondary, setSecondary] = useState("all");
  const [minPostCount, setMinPostCount] = useState(DEFAULT_MIN_POST_COUNT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/data/sexual-tags.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Sex 태그 데이터를 읽지 못했습니다. (${response.status})`);
        return response.json() as Promise<SexualTagPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        const threshold = typeof payload.minPostCount === "number"
          ? payload.minPostCount
          : DEFAULT_MIN_POST_COUNT;
        const next = Array.isArray(payload.tags)
          ? payload.tags.filter((tag) => (
              tag
              && typeof tag.display === "string"
              && tag.display.trim()
              && Number.isFinite(tag.count)
              && tag.count >= threshold
            ))
          : [];
        setTags(next);
        setMinPostCount(threshold);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const secondaryGroups = primary === "acts" ? ACT_GROUPS : primary === "positions" ? POSITION_GROUPS : [];

  const primaryCounts = useMemo(() => {
    const counts: Record<PrimaryGroup, number> = {
      all: tags.length,
      core: 0,
      acts: 0,
      positions: 0,
    };
    for (const tag of tags) {
      if (tag.groups?.includes("core")) counts.core += 1;
      if (tag.groups?.includes("acts")) counts.acts += 1;
      if (tag.groups?.includes("positions")) counts.positions += 1;
    }
    return counts;
  }, [tags]);

  const secondaryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (primary !== "acts" && primary !== "positions") return counts;
    const field = primary === "acts" ? "actGroups" : "positionGroups";
    const matching = tags.filter((tag) => tag.groups?.includes(primary));
    counts.set("all", matching.length);
    for (const tag of matching) {
      for (const group of tag[field] ?? []) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return counts;
  }, [tags, primary]);

  const visible = useMemo(() => {
    const q = normalized(query);
    return tags.filter((tag) => {
      if (primary !== "all" && !tag.groups?.includes(primary)) return false;
      if (secondary !== "all") {
        if (primary === "acts" && !tag.actGroups?.includes(secondary)) return false;
        if (primary === "positions" && !tag.positionGroups?.includes(secondary)) return false;
      }
      return !q || normalized(`${tag.display} ${tag.raw}`).includes(q);
    });
  }, [tags, query, primary, secondary]);

  return (
    <div className="sex-tag-dictionary">
      <div className="sex-dictionary-controls">
        <div className="sex-search-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sex 태그 검색"
            autoComplete="off"
            spellCheck={false}
          />
          <span>{visible.length.toLocaleString()} / {tags.length.toLocaleString()}</span>
        </div>
        <div className="sex-filter-strip primary">
          {PRIMARY_LABELS.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={primary === key ? "active" : ""}
              onClick={() => {
                setPrimary(key);
                setSecondary("all");
              }}
            >
              <span>{label}</span>
              <small>{primaryCounts[key]}</small>
            </button>
          ))}
        </div>
        {secondaryGroups.length > 0 && (
          <div className="sex-filter-strip secondary">
            {secondaryGroups.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={secondary === key ? "active" : ""}
                onClick={() => setSecondary(key)}
              >
                <span>{label}</span>
                <small>{secondaryCounts.get(key) ?? 0}</small>
              </button>
            ))}
          </div>
        )}
        <small className="sex-curation-note">Danbooru {minPostCount.toLocaleString()} posts 이상 · 희귀 태그는 일반 자동완성에서 검색 가능</small>
      </div>

      {loading ? (
        <div className="sex-dictionary-state">Sex 태그 사전을 여는 중…</div>
      ) : error ? (
        <div className="sex-dictionary-state error">{error}</div>
      ) : (
        <div className="sex-tag-grid">
          {visible.map((tag) => (
            <button
              type="button"
              className="sex-tag-card"
              key={tag.raw}
              onClick={() => onInsert(tag.display)}
            >
              <strong>{tag.display}</strong>
              <span>{tag.count.toLocaleString()} posts</span>
            </button>
          ))}
          {!visible.length && <div className="sex-dictionary-state">검색 결과가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
