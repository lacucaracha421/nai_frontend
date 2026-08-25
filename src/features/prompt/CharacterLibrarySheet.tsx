import { useMemo, useRef, useState } from "react";
import {
  UNCATEGORIZED_SERIES,
  useCharacterLibraryStore,
  type CharacterLibraryEntry,
} from "../../stores/characterLibraryStore";
import "./characterLibrary.css";

function normalized(value: string) {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function CharacterCard({
  entry,
  onSelect,
}: {
  entry: CharacterLibraryEntry;
  onSelect: (entry: CharacterLibraryEntry) => void;
}) {
  const remove = useCharacterLibraryStore((state) => state.removeTag);
  const move = useCharacterLibraryStore((state) => state.moveTag);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const editSeries = () => {
    const next = window.prompt("이 캐릭터를 넣을 시리즈 폴더", entry.series);
    if (next !== null) move(entry.raw, next);
  };

  return (
    <div className="character-library-card">
      <button
        type="button"
        className="character-library-main"
        onPointerDown={() => {
          longPressed.current = false;
          pressTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            editSeries();
            pressTimer.current = null;
          }, 500);
        }}
        onPointerUp={() => {
          if (pressTimer.current !== null) {
            window.clearTimeout(pressTimer.current);
            pressTimer.current = null;
          }
          if (!longPressed.current) onSelect(entry);
          longPressed.current = false;
        }}
        onPointerCancel={() => {
          if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
          pressTimer.current = null;
          longPressed.current = false;
        }}
        title="길게 눌러 시리즈 폴더 이동"
      >
        <strong>{entry.display}</strong>
        <span>{entry.series}</span>
      </button>
      <button
        type="button"
        className="character-library-remove"
        aria-label={`${entry.display} 도감에서 삭제`}
        onClick={() => remove(entry.raw)}
      >
        ×
      </button>
    </div>
  );
}

export function CharacterLibrarySheet({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (entry: CharacterLibraryEntry) => void;
}) {
  const entries = useCharacterLibraryStore((state) => state.entries);
  const [series, setSeries] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, CharacterLibraryEntry[]>();
    for (const entry of entries) {
      const key = entry.series.trim() || UNCATEGORIZED_SERIES;
      const bucket = map.get(key) ?? [];
      bucket.push(entry);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.display.localeCompare(b.display, "ko"));
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === UNCATEGORIZED_SERIES) return 1;
      if (b === UNCATEGORIZED_SERIES) return -1;
      return a.localeCompare(b, "ko");
    });
  }, [entries]);

  const q = normalized(query);
  const searched = q
    ? entries
        .filter((entry) => normalized(`${entry.display} ${entry.raw} ${entry.series}`).includes(q))
        .sort((a, b) => a.display.localeCompare(b.display, "ko"))
    : [];
  const currentEntries = series ? grouped.find(([name]) => name === series)?.[1] ?? [] : [];

  return (
    <div className="sheet character-library-sheet">
      <div className="sheet-head character-library-head">
        <div className="drag-handle" />
        <div className="character-library-heading">
          {series && !q ? (
            <button type="button" className="library-back" onClick={() => setSeries(null)}>‹</button>
          ) : null}
          <div>
            <h2>캐릭터 태그 도감</h2>
            <span>{q ? "전체 검색" : series ? `도감 / ${series}` : `${grouped.length}개 시리즈 · ${entries.length}명`}</span>
          </div>
        </div>
        <button className="icon-button" onClick={onClose}>↓</button>
      </div>

      <div className="character-library-body">
        <input
          className="character-library-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="캐릭터 또는 시리즈 검색"
          autoComplete="off"
          spellCheck={false}
        />

        {!entries.length ? (
          <div className="character-library-empty">
            캐릭터 자동완성에서 ★를 누르면 이 도감에 저장됩니다.
          </div>
        ) : q ? (
          <div className="character-library-grid characters">
            {searched.map((entry) => <CharacterCard key={entry.raw} entry={entry} onSelect={onSelect} />)}
            {!searched.length && <div className="character-library-empty">검색 결과가 없습니다.</div>}
          </div>
        ) : series ? (
          <div className="character-library-grid characters">
            {currentEntries.map((entry) => <CharacterCard key={entry.raw} entry={entry} onSelect={onSelect} />)}
          </div>
        ) : (
          <div className="character-series-grid">
            {grouped.map(([name, characters]) => (
              <button key={name} type="button" className="character-series-card" onClick={() => setSeries(name)}>
                <span className="series-folder" aria-hidden="true">▰</span>
                <strong>{name}</strong>
                <small>{characters.length}명</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
