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
  onMoveRequest,
}: {
  entry: CharacterLibraryEntry;
  onSelect: (entry: CharacterLibraryEntry) => void;
  onMoveRequest: (entry: CharacterLibraryEntry) => void;
}) {
  const remove = useCharacterLibraryStore((state) => state.removeTag);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const cancelPressTimer = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <div className="character-library-card">
      <button
        type="button"
        className="character-library-main"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          cancelPressTimer();
          longPressed.current = false;
          pressStart.current = { x: event.clientX, y: event.clientY };
          pressTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            onMoveRequest(entry);
            pressTimer.current = null;
          }, 500);
        }}
        onPointerMove={(event) => {
          const start = pressStart.current;
          if (!start || pressTimer.current === null) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelPressTimer();
        }}
        onPointerUp={() => {
          const wasWaiting = pressTimer.current !== null;
          cancelPressTimer();
          pressStart.current = null;
          if (wasWaiting && !longPressed.current) onSelect(entry);
          longPressed.current = false;
        }}
        onPointerCancel={() => {
          cancelPressTimer();
          pressStart.current = null;
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
  const moveTag = useCharacterLibraryStore((state) => state.moveTag);
  const [series, setSeries] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState<CharacterLibraryEntry | null>(null);
  const [newSeries, setNewSeries] = useState("");

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
  const knownSeries = useMemo(() => {
    const names = grouped.map(([name]) => name);
    if (!names.includes(UNCATEGORIZED_SERIES)) names.push(UNCATEGORIZED_SERIES);
    return names;
  }, [grouped]);

  const requestMove = (entry: CharacterLibraryEntry) => {
    setMoving(entry);
    setNewSeries("");
  };

  const finishMove = (target: string) => {
    if (!moving) return;
    const clean = target.trim() || UNCATEGORIZED_SERIES;
    moveTag(moving.raw, clean);
    setMoving(null);
    setNewSeries("");
  };

  const characterCard = (entry: CharacterLibraryEntry) => (
    <CharacterCard
      key={entry.raw}
      entry={entry}
      onSelect={onSelect}
      onMoveRequest={requestMove}
    />
  );

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
            {searched.map(characterCard)}
            {!searched.length && <div className="character-library-empty">검색 결과가 없습니다.</div>}
          </div>
        ) : series ? (
          <div className="character-library-grid characters">
            {currentEntries.map(characterCard)}
            {!currentEntries.length && <div className="character-library-empty">이 시리즈 폴더가 비었습니다.</div>}
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

      {moving && (
        <div className="character-library-move-backdrop" onPointerDown={() => setMoving(null)}>
          <div className="character-library-move-panel" onPointerDown={(event) => event.stopPropagation()}>
            <div className="character-library-move-head">
              <div>
                <strong>시리즈 이동</strong>
                <span>{moving.display}</span>
              </div>
              <button type="button" onClick={() => setMoving(null)}>×</button>
            </div>

            <div className="character-library-move-grid">
              {knownSeries.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={moving.series === name ? "active" : ""}
                  onClick={() => finishMove(name)}
                >
                  <span aria-hidden="true">▰</span>
                  <strong>{name}</strong>
                </button>
              ))}
            </div>

            <div className="character-library-new-series">
              <input
                value={newSeries}
                onChange={(event) => setNewSeries(event.target.value)}
                placeholder="새 시리즈 폴더 이름"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newSeries.trim()) finishMove(newSeries);
                }}
              />
              <button type="button" disabled={!newSeries.trim()} onClick={() => finishMove(newSeries)}>이동</button>
            </div>
            <small className="character-library-move-help">캐릭터 카드를 길게 누르면 언제든 폴더를 다시 바꿀 수 있습니다.</small>
          </div>
        </div>
      )}
    </div>
  );
}
