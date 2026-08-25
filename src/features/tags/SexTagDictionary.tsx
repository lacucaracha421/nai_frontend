import { useEffect, useMemo, useState } from "react";
import "./sexTagDictionary.css";

type SexualTag = {
  raw: string;
  display: string;
  count: number;
};

type SexualTagPayload = {
  source?: string;
  generated?: string;
  tags?: SexualTag[];
};

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
        const next = Array.isArray(payload.tags)
          ? payload.tags.filter((tag) => tag && typeof tag.display === "string" && tag.display.trim())
          : [];
        setTags(next);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const q = normalized(query);
    if (!q) return tags;
    return tags.filter((tag) => normalized(`${tag.display} ${tag.raw}`).includes(q));
  }, [tags, query]);

  return (
    <div className="sex-tag-dictionary">
      <div className="sex-dictionary-controls">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Sex 태그 검색"
          autoComplete="off"
          spellCheck={false}
        />
        <span>{visible.length.toLocaleString()} / {tags.length.toLocaleString()}</span>
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
              <span>{tag.count > 0 ? `${tag.count.toLocaleString()} posts` : "Danbooru wiki"}</span>
            </button>
          ))}
          {!visible.length && <div className="sex-dictionary-state">검색 결과가 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
