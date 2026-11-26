import { useDesktopLayout } from "../../app/desktopLayout";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useBackLayer } from "../../app/backStack";
import { Icon } from "../../components/Icon";
import { isThumbnailHidden, useCharacterLibraryStore, UNCATEGORIZED_SERIES, type CharacterLibraryEntry, type InsertMode } from "../../stores/characterLibraryStore";
import type { CharacterPrompt } from "../../types/generation";
import { characterKey, characterLabel, groupCatalog, insertCharacter, libraryCharacter, matchesCharacter, matchesSeries, seriesLabel, type CatalogCharacter } from "./characterCatalog";
import { loadCharacterCatalog } from "./characterCatalogClient";
import { prefetchThumbnails, useThumbnail, useThumbnailProgress } from "./characterThumbnails";
import { randomCharacterPool } from "./randomCharacter";
import { isThumbnailSuspect } from "./thumbnailSuspects";
import "./characterLibrary.css";
import "./characterFinder.css";

export type FinderSelection = { row: CatalogCharacter; mode: InsertMode; removed: string[]; add: boolean };
const MODES: [InsertMode, string][] = [["name", "이름만"], ["features", "+외형"], ["attire", "+의상"]];

function Thumbnail({ raw }: { raw: string | null }) {
  const { ref, image, retry } = useThumbnail(raw);
  return (
    <div ref={ref} className={`finder-thumbnail ${image.status}`}>
      {image.src ? (
        <img src={image.src} alt="" />
      ) : (
        <span>{image.status === "missing" ? "썸네일 없음" : image.status === "failed" ? "받지 못함" : "받는 중"}</span>
      )}
      {image.status === "failed" && (
        <button type="button" className="finder-retry" onClick={(event) => { event.stopPropagation(); retry(); }}>
          다시 받기
        </button>
      )}
    </div>
  );
}

function CharacterTile({
  row,
  saved,
  active,
  compact,
  thumbnail,
  onPick,
  onDetail,
  onStar,
  onMove,
}: {
  row: CatalogCharacter;
  saved: boolean;
  active?: boolean;
  compact?: boolean;
  thumbnail: string | null;
  onPick: () => void;
  onDetail: () => void;
  onStar: () => void;
  onMove?: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => cancel, []);

  const label = characterLabel(row.raw) ?? row.display;
  return (
    <div className={`finder-tile ${active ? "active" : ""} ${compact ? "compact" : ""}`}>
      <div
        className="finder-tile-art"
        role="button"
        tabIndex={0}
        aria-label={`${label} 선택`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          suppressClick.current = false;
          start.current = { x: event.clientX, y: event.clientY };
          if (onMove) timer.current = setTimeout(() => { suppressClick.current = true; onMove(); }, 500);
        }}
        onPointerMove={(event) => {
          if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) {
            cancel();
            suppressClick.current = true;
          }
        }}
        onPointerUp={cancel}
        onPointerCancel={() => { cancel(); suppressClick.current = true; }}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button") && !suppressClick.current) onPick(); }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPick();
          }
        }}
      >
        <Thumbnail raw={thumbnail} />
        {row.isNew && <small className="finder-new">신규</small>}
        <button
          type="button"
          className={`finder-star ${saved ? "active" : ""}`}
          aria-label={`${row.display} ${saved ? "도감에서 삭제" : "도감에 저장"}`}
          aria-pressed={saved}
          title={saved ? "내 도감에서 삭제" : "내 도감에 저장"}
          onClick={(event) => { event.stopPropagation(); onStar(); }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1Z"
              fill={saved ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {!compact && (
          <button
            type="button"
            className="finder-detail-btn"
            aria-label={`${label} 세부 조정`}
            title="외형·의상 세부 조정"
            onClick={(event) => { event.stopPropagation(); onDetail(); }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <circle cx="6" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="18" cy="12" r="2" />
            </svg>
          </button>
        )}
      </div>
      <strong title={row.display}>{label}</strong>
      {!compact && <small>{seriesLabel(row.series)}</small>}
    </div>
  );
}

export function CharacterFinderSheet({
  onClose,
  onSelect,
  current,
  currentIndex,
  initialAdd = false,
  initialRandom = false,
  inline = false,
}: {
  onClose: () => void;
  onSelect: (selection: FinderSelection) => void;
  current?: CharacterPrompt;
  currentIndex: number;
  initialAdd?: boolean;
  initialRandom?: boolean;
  inline?: boolean;
}) {
  const desktop = useDesktopLayout();
  const library = useCharacterLibraryStore();
  const [catalog, setCatalog] = useState<CatalogCharacter[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"find" | "library">(initialRandom ? "library" : library.finderTab);
  const [series, setSeries] = useState<string | null>(initialRandom ? null : library.finderSeries);
  const [query, setQuery] = useState("");
  const searchQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<"all" | "saved" | "new">("all");
  const [sort, setSort] = useState<"popular" | "saved" | "new" | "name">("popular");
  const [allSeries, setAllSeries] = useState(false);
  const [picked, setPicked] = useState<CatalogCharacter | null>(null);
  const [modeChosen, setModeChosen] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [add, setAdd] = useState(initialAdd);
  const [randomOpen, setRandomOpen] = useState(initialRandom);
  const [moving, setMoving] = useState<CharacterLibraryEntry | null>(null);
  const [folderOrder, setFolderOrder] = useState<"recent" | "name">("recent");
  const [newSeries, setNewSeries] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAdd(initialAdd);
  }, [initialAdd]);

  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => { previous?.focus({ preventScroll: true }); };
  }, [inline]);

  const [limit, setLimit] = useState(80);
  const more = useRef<HTMLDivElement>(null);
  const reload = () => {
    setError("");
    void loadCharacterCatalog().then(setCatalog).catch(() => setError("캐릭터 목록을 읽지 못했습니다."));
  };
  useEffect(reload, []);
  useEffect(() => {
    library.setFinderPreferences({ finderTab: tab, finderSeries: series });
  }, [tab, series, library.setFinderPreferences]);

  const byKey = useMemo(() => new Map(catalog.map((row) => [characterKey(row.raw), row])), [catalog]);
  const thumbnailHidden = (raw: string) => isThumbnailHidden(library, raw, isThumbnailSuspect(raw));
  const thumbnailOf = (row: CatalogCharacter) => (byKey.has(characterKey(row.raw)) && !row.isNew && !thumbnailHidden(row.raw) ? row.raw : null);
  const savedByKey = useMemo(() => new Map(library.entries.map((entry) => [characterKey(entry.raw), entry])), [library.entries]);
  const groups = useMemo(() => groupCatalog(catalog, library.entries), [catalog, library.entries]);
  const folders = useMemo(() => {
    const map = new Map<string, CharacterLibraryEntry[]>();
    for (const entry of library.entries) {
      const key = entry.series || UNCATEGORIZED_SERIES;
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return [...map.entries()].sort(([a, aa], [b, bb]) => (
      a === UNCATEGORIZED_SERIES
        ? 1
        : b === UNCATEGORIZED_SERIES
          ? -1
          : (folderOrder === "recent" ? Math.max(...bb.map((e) => e.addedAt)) - Math.max(...aa.map((e) => e.addedAt)) : 0) || a.localeCompare(b, "ko")
    ));
  }, [library.entries, folderOrder]);

  const recentRows = useMemo(() => {
    const raws = Array.isArray(library.recentRaws) ? library.recentRaws : [];
    const out: CatalogCharacter[] = [];
    const seen = new Set<string>();
    for (const raw of raws) {
      const key = characterKey(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      const fromCatalog = byKey.get(key);
      if (fromCatalog) {
        out.push(fromCatalog);
      } else {
        const fromSaved = savedByKey.get(key);
        if (fromSaved) out.push(libraryCharacter(fromSaved, byKey));
      }
    }
    return out;
  }, [library.recentRaws, byKey, savedByKey]);

  const savedNames = useMemo(
    () => library.entries.map((entry) => byKey.get(characterKey(entry.raw))).filter((row): row is CatalogCharacter => !!row && !row.isNew).map((row) => row.raw),
    [library.entries, byKey],
  );
  useEffect(() => { prefetchThumbnails(savedNames); }, [savedNames]);
  const progress = useThumbnailProgress(savedNames);
  const randomCount = randomCharacterPool(library.entries, library).length;
  const activeCharKey = current?.name ? characterKey(current.name) : "";
  const libraryView = library.libraryView ?? "folders";

  useBackLayer(true, onClose);
  useBackLayer(!!series, () => { setSeries(null); setQuery(""); });
  useBackLayer(randomOpen, () => setRandomOpen(false));
  useBackLayer(!!picked, () => setPicked(null));
  useBackLayer(!!moving, () => setMoving(null));
  useEffect(() => { setLimit(80); body.current?.scrollTo(0, 0); }, [tab, series, query, filter, sort, libraryView]);
  useEffect(() => {
    const element = more.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setLimit((n) => n + 80); }, { root: body.current, rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [limit, tab, series, query, filter, catalog, libraryView]);

  const showGrid = !!series || !!query || filter !== "all" || (tab === "library" && libraryView === "all");

  const rows = useMemo(() => {
    let result = tab === "library"
      ? library.entries
          .filter((entry) => !series || (entry.series || UNCATEGORIZED_SERIES) === series)
          .map((entry) => ({ ...libraryCharacter(entry, byKey), series: entry.series }))
      : series
        ? groups.find((group) => group.series === series)?.rows ?? []
        : catalog;
    result = result.filter((row) => (
      (!searchQuery || matchesCharacter(row, searchQuery))
      && (tab === "library" || filter === "all" || (filter === "new" ? row.isNew : savedByKey.has(characterKey(row.raw))))
    ));
    if (sort !== "popular") {
      result = [...result].sort((a, b) => (
        sort === "name"
          ? a.display.localeCompare(b.display)
          : sort === "new"
            ? Number(b.isNew) - Number(a.isNew)
            : Number(savedByKey.has(characterKey(b.raw))) - Number(savedByKey.has(characterKey(a.raw)))
      ));
    }
    return result;
  }, [tab, library.entries, series, searchQuery, filter, sort, byKey, groups, catalog, savedByKey]);

  const toggle = (row: CatalogCharacter) => {
    const existing = savedByKey.get(characterKey(row.raw));
    if (existing) library.removeTag(existing.raw);
    else library.addTag(row, row.series || UNCATEGORIZED_SERIES);
  };

  const quickSelect = (row: CatalogCharacter) => {
    const mode: InsertMode = isThumbnailSuspect(row.raw) || (!row.features.length && !row.attire.length)
      ? "name"
      : library.insertMode;
    library.recordRecent(row.raw);
    onSelect({ row, mode, removed: [], add: add || !current });
  };

  const openDetail = (row: CatalogCharacter) => {
    setPicked(row);
    setRemoved([]);
    setModeChosen(false);
  };

  const changeTab = (next: "find" | "library") => {
    setTab(next);
    setSeries(null);
    setQuery("");
    setFilter("all");
    setSort("popular");
  };

  const covers = (list: CatalogCharacter[]) => (
    <span className="finder-covers">
      {list.slice(0, 3).map((row) => <Thumbnail key={row.raw} raw={thumbnailOf(row)} />)}
    </span>
  );

  const seriesRow = (group: typeof groups[number]) => (
    <button type="button" className="finder-series-row" key={group.series} onClick={() => { setSeries(group.series); setQuery(""); }}>
      {covers(group.rows)}
      <span>
        <strong>{seriesLabel(group.series)}</strong>
        <small>{group.rows.length}명 {group.saved > 0 && `· 도감 ${group.saved}`} {group.newCount > 0 && `· 신규 ${group.newCount}`}</small>
      </span>
      <span>›</span>
    </button>
  );

  const effectiveMode = picked && (!picked.features.length && !picked.attire.length || isThumbnailSuspect(picked.raw) && !modeChosen)
    ? "name"
    : library.insertMode;
  const preview = picked ? insertCharacter(add || !current ? { prompt: "", name: "" } : current, picked, effectiveMode, removed).prompt : "";
  const move = (target: string) => { if (moving) library.moveTag(moving.raw, target); setMoving(null); setNewSeries(""); };

  const targetHint = randomOpen
    ? `생성할 때마다 ${randomCount}명 중 한 명을 뽑음`
    : add || !current
      ? "새 캐릭터로 추가"
      : `캐릭터 ${currentIndex + 1}${current.name ? ` · ${characterLabel(current.name) ?? current.name}` : ""}`;

  return (
    <div
      ref={dialog}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (moving) setMoving(null);
          else if (picked) setPicked(null);
          else if (randomOpen) setRandomOpen(false);
          else if (series) setSeries(null);
          else onClose();
        }
        if (inline || desktop || event.key !== "Tab") return;
        const nested = dialog.current?.querySelectorAll<HTMLElement>('[role="dialog"]');
        const scope = nested?.length ? nested[nested.length - 1] : dialog.current;
        const focusable = scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }}
      className={inline ? "inline-finder character-finder-sheet" : "sheet character-finder-sheet"}
      role={inline ? "region" : "dialog"}
      aria-modal={inline || desktop ? undefined : true}
      aria-label="캐릭터 찾기"
    >
      <header className="finder-head">
        {!inline && <div className="drag-handle" />}
        <div className="finder-heading">
          {(series || randomOpen) && (
            <button
              type="button"
              className="finder-icon-btn"
              aria-label="뒤로"
              onClick={() => { if (randomOpen) setRandomOpen(false); else { setSeries(null); setQuery(""); } }}
            >
              ‹
            </button>
          )}
          {!randomOpen && !series ? (
            <div className="finder-segment finder-head-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "library"} onClick={() => changeTab("library")}>
                내 도감 <small>{library.entries.length}</small>
              </button>
              <button type="button" role="tab" aria-selected={tab === "find"} onClick={() => changeTab("find")}>
                찾기 <small>{catalog.length.toLocaleString()}</small>
              </button>
            </div>
          ) : (
            <div className="finder-title-block">
              <h2>{randomOpen ? "🎲 랜덤 범위" : series ? seriesLabel(series) : "캐릭터 찾기"}</h2>
              <small>{targetHint}</small>
            </div>
          )}
          {!randomOpen && !series && (
            <button
              type="button"
              className={`finder-target-pill ${add ? "active" : ""}`}
              title="클릭하여 교체 / 새 캐릭터 추가 전환"
              onClick={() => setAdd((v) => !v)}
            >
              {targetHint}
            </button>
          )}
          <button type="button" className="finder-icon-btn" aria-label="캐릭터 찾기 닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </header>

      {!randomOpen && (
        <div className="finder-toolbar">
          <div className="finder-search">
            <input
              aria-label="캐릭터 또는 시리즈 검색"
              placeholder={tab === "library" ? "도감 검색 (한글·영문)" : series ? "이 시리즈에서 검색" : "캐릭터 · 시리즈 검색"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button type="button" aria-label="검색 지우기" onClick={() => setQuery("")}>×</button>
            )}
          </div>
          <div className="finder-controls-row">
            <div className="finder-mode-pills" role="group" aria-label="넣을 내용">
              {MODES.map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={library.insertMode === key}
                  onClick={() => library.setFinderPreferences({ insertMode: key })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="finder-right-controls">
              {tab === "library" && !series && !query && (
                <div className="finder-view-pills" role="group" aria-label="보기 방식">
                  <button
                    type="button"
                    aria-pressed={libraryView === "folders"}
                    onClick={() => library.setFinderPreferences({ libraryView: "folders" })}
                  >
                    폴더
                  </button>
                  <button
                    type="button"
                    aria-pressed={libraryView === "all"}
                    onClick={() => library.setFinderPreferences({ libraryView: "all" })}
                  >
                    전체
                  </button>
                </div>
              )}
              {tab === "library" && (
                <button type="button" className="finder-pill-btn" onClick={() => setRandomOpen(true)}>
                  🎲 {randomCount}
                </button>
              )}
              {tab === "find" && (query || series || filter !== "all") && (
                <div className="finder-view-pills">
                  {([["all", "전체"], ["saved", "도감"], ["new", "신규"]] as const).map(([key, label]) => (
                    <button type="button" aria-pressed={filter === key} key={key} onClick={() => setFilter(key)}>{label}</button>
                  ))}
                </div>
              )}
              {tab === "library" && !showGrid && (
                <select aria-label="폴더 정렬" value={folderOrder} onChange={(event) => setFolderOrder(event.target.value as "recent" | "name")}>
                  <option value="recent">최근순</option>
                  <option value="name">이름순</option>
                </select>
              )}
              {showGrid && (
                <select aria-label="캐릭터 정렬" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                  <option value="popular">목록순</option>
                  <option value="saved">도감순</option>
                  <option value="new">신규순</option>
                  <option value="name">이름순</option>
                </select>
              )}
            </div>
          </div>
        </div>
      )}

      {!randomOpen && progress.pending > 0 && (
        <div className="finder-download" aria-live="polite">
          <span>썸네일 캐싱 중 · {progress.saved}/{savedNames.length}</span>
          <progress aria-label="썸네일 다운로드 중" max={Math.max(savedNames.length, 1)} value={progress.saved} />
        </div>
      )}

      <div ref={body} className="finder-body">
        {randomOpen ? (
          <>
            <h3>뽑는 곳</h3>
            <div className="finder-segment">
              {([["all", "도감 전체"], ["series", "고른 시리즈만"]] as const).map(([key, label]) => (
                <button type="button" key={key} aria-pressed={library.randomScope === key} onClick={() => library.setFinderPreferences({ randomScope: key })}>
                  {label}
                </button>
              ))}
            </div>
            <h3>넣을 내용</h3>
            <div className="finder-segment">
              {MODES.slice(0, 2).map(([key, label]) => (
                <button type="button" key={key} aria-pressed={library.randomInsertMode === key} onClick={() => library.setFinderPreferences({ randomInsertMode: key as "name" | "features" })}>
                  {label}
                </button>
              ))}
            </div>
            <h3>
              시리즈
              <button type="button" onClick={() => library.setFinderPreferences({ randomSeries: [], randomScope: "series" })}>모두 끄기</button>
            </h3>
            {folders.map(([name, entries]) => (
              <div className="finder-series-row" key={name}>
                {covers(entries.map((entry) => libraryCharacter(entry, byKey)))}
                <span>
                  <strong>{seriesLabel(name)}</strong>
                  <small>도감 {entries.length}명</small>
                </span>
                <button
                  type="button"
                  className="finder-switch"
                  role="switch"
                  aria-label={`${seriesLabel(name)} 랜덤 포함`}
                  aria-checked={library.randomScope === "all" || library.randomSeries.includes(name)}
                  onClick={() => {
                    const selected = library.randomScope === "all" ? folders.map(([folder]) => folder) : library.randomSeries;
                    library.setFinderPreferences({
                      randomScope: "series",
                      randomSeries: selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name],
                    });
                  }}
                >
                  <span />
                </button>
              </div>
            ))}
            {!folders.length && <p className="finder-empty">캐릭터의 ★을 눌러 도감에 저장해 주세요.</p>}
          </>
        ) : (
          <>
            {tab === "find" && error && (
              <p className="finder-empty">{error} <button type="button" onClick={reload}>다시 읽기</button></p>
            )}
            {tab === "find" && !catalog.length && !error && (
              <p className="finder-empty">목록 읽는 중…</p>
            )}

            {tab === "library" && !series && !query && recentRows.length > 0 && (
              <div className="finder-recent-block">
                <h3>최근 사용</h3>
                <div className="finder-recent-strip">
                  {recentRows.map((row) => (
                    <CharacterTile
                      key={`recent:${row.raw}`}
                      row={row}
                      compact
                      saved={savedByKey.has(characterKey(row.raw))}
                      active={activeCharKey !== "" && activeCharKey === characterKey(row.raw)}
                      thumbnail={thumbnailOf(row)}
                      onPick={() => quickSelect(row)}
                      onDetail={() => openDetail(row)}
                      onStar={() => toggle(row)}
                    />
                  ))}
                </div>
              </div>
            )}

            {!showGrid && tab === "library" && (
              <>
                <h3>시리즈 폴더 <small>{folders.length}개</small></h3>
                <div className="finder-folders">
                  {folders.map(([name, entries]) => (
                    <button type="button" key={name} onClick={() => setSeries(name)}>
                      {covers(entries.map((entry) => libraryCharacter(entry, byKey)))}
                      <strong>{seriesLabel(name)}</strong>
                      <small>{entries.length}명 {(library.randomScope === "all" || library.randomSeries.includes(name)) && "· 🎲"}</small>
                    </button>
                  ))}
                </div>
                {!folders.length && <p className="finder-empty">캐릭터의 ★을 눌러 내 도감을 채워 보세요.</p>}
              </>
            )}

            {!showGrid && tab === "find" && (
              allSeries ? (
                <>
                  <h3>전체 시리즈 {groups.length.toLocaleString()}개</h3>
                  {groups.slice(0, limit).map(seriesRow)}
                </>
              ) : (
                <>
                  {groups.some((group) => group.saved) && (
                    <>
                      <h3>
                        내 도감에 있는 시리즈
                        <button type="button" onClick={() => { setFilter("saved"); }}>모두 보기</button>
                      </h3>
                      {groups.filter((group) => group.saved).slice(0, 4).map(seriesRow)}
                    </>
                  )}
                  <h3>인기 시리즈 <small>캐릭터 수 기준</small></h3>
                  {[...groups].filter((group) => group.series !== UNCATEGORIZED_SERIES).sort((a, b) => b.rows.length - a.rows.length).slice(0, 4).map(seriesRow)}
                  <button type="button" className="finder-all" onClick={() => setAllSeries(true)}>
                    전체 시리즈 {groups.length.toLocaleString()}개 보기
                  </button>
                </>
              )
            )}

            {showGrid && (
              <>
                {!!query && !series && tab === "find" && groups.some((group) => matchesSeries(group.series, query)) && (
                  <>
                    <h3>시리즈</h3>
                    {groups.filter((group) => matchesSeries(group.series, query)).slice(0, 6).map(seriesRow)}
                  </>
                )}
                <h3>
                  캐릭터 {rows.length.toLocaleString()}명
                  {tab === "library" && <small>길게 눌러 폴더 이동</small>}
                </h3>
                <div className="finder-grid">
                  {rows.slice(0, limit).map((row) => (
                    <CharacterTile
                      key={row.raw}
                      row={row}
                      saved={savedByKey.has(characterKey(row.raw))}
                      active={activeCharKey !== "" && activeCharKey === characterKey(row.raw)}
                      thumbnail={thumbnailOf(row)}
                      onPick={() => quickSelect(row)}
                      onDetail={() => openDetail(row)}
                      onStar={() => toggle(row)}
                      onMove={tab === "library" ? () => { setMoving(savedByKey.get(characterKey(row.raw)) ?? null); setNewSeries(""); } : undefined}
                    />
                  ))}
                </div>
                {!rows.length && <p className="finder-empty">검색 결과가 없습니다.</p>}
              </>
            )}

            <div ref={more}>
              {(showGrid ? rows.length : allSeries ? groups.length : 0) > limit && (
                <button type="button" className="finder-all" onClick={() => setLimit((n) => n + 80)}>더 보기</button>
              )}
            </div>
          </>
        )}
      </div>

      {randomOpen && (
        <footer className="finder-footer">
          <button type="button" className="finder-primary" onClick={() => setRandomOpen(false)}>완료 · {randomCount}명</button>
        </footer>
      )}

      {picked && (
        <div className="finder-overlay" onClick={() => setPicked(null)}>
          <section className="finder-detail" role="dialog" aria-modal={desktop ? undefined : true} aria-label="캐릭터 넣기" onClick={(event) => event.stopPropagation()}>
            <div className="drag-handle" />
            <div className="finder-detail-top">
              <Thumbnail raw={thumbnailOf(picked)} />
              <div>
                <h2>{characterLabel(picked.raw) ?? picked.display}</h2>
                <p>{characterLabel(picked.raw) ? `${picked.display} · ` : ""}{seriesLabel(picked.series)}</p>
                <button type="button" aria-pressed={savedByKey.has(characterKey(picked.raw))} onClick={() => toggle(picked)}>
                  {savedByKey.has(characterKey(picked.raw)) ? "★ 도감에 있음" : "☆ 도감에 저장"}
                </button>
                {!picked.isNew && (
                  <button
                    type="button"
                    className="finder-hide-thumbnail"
                    onClick={() => library.toggleHiddenThumbnail(picked.raw, isThumbnailSuspect(picked.raw))}
                  >
                    {thumbnailHidden(picked.raw) ? "썸네일 다시 보기" : "다른 캐릭터 그림이면 썸네일 숨기기"}
                  </button>
                )}
                {!picked.isNew && isThumbnailSuspect(picked.raw) && thumbnailHidden(picked.raw) && (
                  <small className="finder-suspect-note">다른 캐릭터 그림으로 추정돼 숨겼어요</small>
                )}
              </div>
            </div>
            {([["외형", picked.features], ["의상", picked.attire]] as const).map(([label, tags]) => (
              <div key={label}>
                <h3>{label} <small>눌러서 빼기</small></h3>
                <div className="finder-chips">
                  {tags.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      aria-pressed={!removed.includes(tag)}
                      className={removed.includes(tag) ? "dropped" : ""}
                      onClick={() => setRemoved((old) => (old.includes(tag) ? old.filter((value) => value !== tag) : [...old, tag]))}
                    >
                      {tag}
                    </button>
                  ))}
                  {!tags.length && <small>자료 없음</small>}
                </div>
              </div>
            ))}
            <h3>넣을 내용</h3>
            <div className="finder-segment">
              {MODES.map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={effectiveMode === key}
                  disabled={key !== "name" && !picked.features.length && !picked.attire.length}
                  onClick={() => { setModeChosen(true); library.setFinderPreferences({ insertMode: key }); }}
                >
                  {label}
                </button>
              ))}
            </div>
            <h3>넣을 자리</h3>
            <div className="finder-segment">
              <button type="button" disabled={!current} aria-pressed={!add} onClick={() => setAdd(false)}>
                캐릭터 {currentIndex + 1} 바꾸기
              </button>
              <button type="button" aria-pressed={add} onClick={() => setAdd(true)}>
                새 캐릭터로 추가
              </button>
            </div>
            <p className="finder-preview" aria-label="삽입할 프롬프트 미리보기">{preview}</p>
            <div className="finder-actions">
              <button type="button" onClick={() => setPicked(null)}>닫기</button>
              <button
                type="button"
                className="finder-primary"
                onClick={() => {
                  library.recordRecent(picked.raw);
                  onSelect({ row: picked, mode: effectiveMode, removed, add: add || !current });
                  setPicked(null);
                }}
              >
                {add || !current ? "새 캐릭터로 추가" : `캐릭터 ${currentIndex + 1}에 넣기`}
              </button>
            </div>
          </section>
        </div>
      )}

      {moving && (
        <div className="character-library-move-backdrop" onClick={() => setMoving(null)}>
          <section className="character-library-move-panel" role="dialog" aria-label="시리즈 이동" onClick={(event) => event.stopPropagation()}>
            <div className="character-library-move-head">
              <div>
                <strong>시리즈 이동</strong>
                <span>{moving.display}</span>
              </div>
              <button type="button" aria-label="이동 닫기" onClick={() => setMoving(null)}>×</button>
            </div>
            <div className="character-library-move-grid">
              {[...new Set([...folders.map(([name]) => name), UNCATEGORIZED_SERIES])].map((name) => (
                <button type="button" key={name} onClick={() => move(name)}>{seriesLabel(name)}</button>
              ))}
            </div>
            <div className="character-library-new-series">
              <input
                aria-label="새 시리즈 폴더 이름"
                placeholder="새 시리즈 폴더 이름"
                value={newSeries}
                onChange={(event) => setNewSeries(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && newSeries.trim()) move(newSeries); }}
              />
              <button type="button" disabled={!newSeries.trim()} onClick={() => move(newSeries)}>이동</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
