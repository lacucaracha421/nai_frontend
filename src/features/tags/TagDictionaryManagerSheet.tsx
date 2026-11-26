import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import {
  TAG_CATEGORIES,
  fetchDefaultDictionaryTags,
  readQuickCopyData,
  writeQuickCopyData,
  type StoredAction,
  type StoredArtist,
  type StoredQuickCopy,
  type StoredTag,
} from "./quickCopyStorage";
import "./tagDictionaryManager.css";

export type ManageableDictTab = "artists" | "tags" | "actions";

type EditDraft = {
  index: number | null; // null = new item
  title: string;
  prompt: string;
  category: string;
  aliases: string;
  note: string;
};

type Props = {
  initialTab?: ManageableDictTab;
  onClose: () => void;
};

export function TagDictionaryManagerSheet({ initialTab = "artists", onClose }: Props) {
  const [tab, setTab] = useState<ManageableDictTab>(initialTab);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [sub, setSub] = useState("전체");
  const [data, setData] = useState<StoredQuickCopy>(() => readQuickCopyData());
  const [draft, setDraft] = useState<EditDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDefaultDictionaryTags().then((defaults) => {
      if (cancelled) return;
      setData(readQuickCopyData(defaults));
    });
    return () => { cancelled = true; };
  }, []);

  const commit = (next: StoredQuickCopy) => {
    setData(next);
    writeQuickCopyData(next);
  };

  const openNew = () => {
    setDraft({
      index: null,
      title: "",
      prompt: "",
      category: tab === "tags" ? (sub !== "전체" ? sub : TAG_CATEGORIES[0]) : tab === "actions" ? (sub !== "전체" ? sub : "장면") : "",
      aliases: "",
      note: "",
    });
  };

  const openEdit = (index: number) => {
    if (draft?.index === index) {
      setDraft(null);
      return;
    }
    if (tab === "artists") {
      const item = data.artists[index];
      if (!item) return;
      setDraft({ index, title: item.title ?? "", prompt: item.name, category: "", aliases: "", note: item.note ?? "" });
    } else if (tab === "actions") {
      const item = data.actions[index];
      if (!item) return;
      setDraft({
        index,
        title: item.title ?? item.name ?? "",
        prompt: item.prompt ?? item.name ?? "",
        category: item.category ?? "",
        aliases: item.aliases ?? "",
        note: item.note ?? "",
      });
    } else {
      const item = data.tags[index];
      if (!item) return;
      setDraft({
        index,
        title: item.title,
        prompt: item.prompt,
        category: item.category ?? TAG_CATEGORIES[0],
        aliases: item.aliases ?? "",
        note: item.note ?? "",
      });
    }
  };

  const saveDraft = () => {
    if (!draft) return;
    if (tab === "artists") {
      const name = draft.prompt.trim();
      if (!name) return;
      const title = draft.title.trim();
      const nextList: StoredArtist[] = [...data.artists];
      const base = draft.index !== null ? nextList[draft.index] : { name, pinned: false };
      const entry: StoredArtist = { ...base, name, note: draft.note.trim() };
      if (title) entry.title = title;
      else delete entry.title;
      if (draft.index === null) nextList.unshift(entry);
      else nextList[draft.index] = entry;
      commit({ ...data, artists: nextList });
    } else if (tab === "actions") {
      const prompt = draft.prompt.trim();
      const title = draft.title.trim() || prompt;
      if (!prompt) return;
      const nextList: StoredAction[] = [...data.actions];
      const entry: StoredAction = {
        title,
        prompt,
        category: draft.category.trim() || "행동",
        aliases: draft.aliases.trim(),
        note: draft.note.trim(),
        pinned: draft.index !== null ? nextList[draft.index]?.pinned : false,
      };
      if (draft.index === null) nextList.unshift(entry);
      else nextList[draft.index] = entry;
      commit({ ...data, actions: nextList });
    } else {
      const prompt = draft.prompt.trim();
      const title = draft.title.trim() || prompt;
      if (!prompt) return;
      const nextList: StoredTag[] = [...data.tags];
      const entry: StoredTag = {
        title,
        prompt,
        category: draft.category.trim() || TAG_CATEGORIES[0],
        aliases: draft.aliases.trim(),
        note: draft.note.trim(),
        pinned: draft.index !== null ? nextList[draft.index]?.pinned : false,
      };
      if (draft.index === null) nextList.unshift(entry);
      else nextList[draft.index] = { ...nextList[draft.index], ...entry };
      commit({ ...data, tags: nextList });
    }
    setDraft(null);
  };

  const togglePin = (index: number) => {
    if (tab === "artists") {
      const next = data.artists.map((item, i) => (i === index ? { ...item, pinned: !item.pinned } : item));
      commit({ ...data, artists: next });
    } else if (tab === "actions") {
      const next = data.actions.map((item, i) => (i === index ? { ...item, pinned: !item.pinned } : item));
      commit({ ...data, actions: next });
    } else {
      const next = data.tags.map((item, i) => (i === index ? { ...item, pinned: !item.pinned } : item));
      commit({ ...data, tags: next });
    }
  };

  const removeAt = (index: number) => {
    if (tab === "artists") commit({ ...data, artists: data.artists.filter((_, i) => i !== index) });
    else if (tab === "actions") commit({ ...data, actions: data.actions.filter((_, i) => i !== index) });
    else commit({ ...data, tags: data.tags.filter((_, i) => i !== index) });
    if (draft?.index === index) setDraft(null);
    else if (draft?.index !== null && draft !== null && draft.index > index) {
      setDraft({ ...draft, index: draft.index - 1 });
    }
  };

  const allRows = useMemo(() => {
    if (tab === "artists") {
      return data.artists.map((item, index) => {
        const customTitle = (item.title ?? "").trim();
        return {
          index,
          title: customTitle || item.name,
          meta: (item.note ?? "").trim(),
          tooltip: item.name,
          category: "",
          pinned: !!item.pinned,
          hay: `${customTitle} ${item.name} ${item.note ?? ""}`.toLowerCase(),
        };
      });
    }
    if (tab === "actions") {
      return data.actions.map((item, index) => {
        const prompt = item.prompt ?? item.name ?? "";
        const title = item.title ?? item.name ?? prompt;
        const category = (item.category ?? "행동").trim() || "행동";
        return {
          index,
          title,
          meta: [category, (item.note ?? "").trim()].filter(Boolean).join(" · "),
          tooltip: prompt,
          category,
          pinned: !!item.pinned,
          hay: `${title} ${prompt} ${category} ${item.aliases ?? ""} ${item.note ?? ""}`.toLowerCase(),
        };
      });
    }
    return data.tags.map((item, index) => {
      const category = (item.category ?? "기타").trim() || "기타";
      return {
        index,
        title: item.title,
        meta: [category, (item.note ?? "").trim()].filter(Boolean).join(" · "),
        tooltip: item.prompt,
        category,
        pinned: !!item.pinned,
        hay: `${item.title} ${item.prompt} ${category} ${item.aliases ?? ""} ${item.note ?? ""}`.toLowerCase(),
      };
    });
  }, [tab, data]);

  const subs = useMemo(() => {
    if (tab === "artists") return [];
    const unique = Array.from(new Set(allRows.map((row) => row.category).filter(Boolean)));
    return unique.length > 1 ? ["전체", ...unique] : [];
  }, [tab, allRows]);

  const activeSub = subs.includes(sub) ? sub : "전체";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (favOnly && !row.pinned) return false;
      if (activeSub !== "전체" && row.category !== activeSub) return false;
      if (q && !row.hay.includes(q)) return false;
      return true;
    });
  }, [allRows, favOnly, activeSub, query]);

  const tagCategoryOptions = useMemo(() => {
    const base = [...TAG_CATEGORIES];
    if (draft?.category && !base.includes(draft.category)) base.push(draft.category);
    return base;
  }, [draft?.category]);

  return (
    <div className="sheet dict-mgr-sheet">
      <div className="sheet-head">
        <div className="drag-handle" />
        <div>
          <h2>태그사전 편집</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="태그사전 편집 닫기">
          <span className="mobile-panel-close">↓</span>
          <span className="desktop-panel-close">×</span>
        </button>
      </div>

      <div className="dict-mgr-body">
        <div className="dict-mgr-top">
          <div className="dict-mgr-tabs" role="tablist">
            {([
              ["artists", `작가 (${data.artists.length})`],
              ["tags", `구도 (${data.tags.length})`],
              ["actions", `행동 (${data.actions.length})`],
            ] as Array<[ManageableDictTab, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "active" : ""}
                onClick={() => { setTab(key); setSub("전체"); setDraft(null); }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="dict-mgr-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름·태그·메모 검색"
          />
          <button
            type="button"
            className={`dict-mgr-fav-btn ${favOnly ? "active" : ""}`}
            aria-pressed={favOnly}
            aria-label="즐겨찾기만 보기"
            onClick={() => setFavOnly((v) => !v)}
          >
            ★
          </button>
          <button type="button" className="dict-mgr-add-btn" onClick={openNew}>
            <Icon name="plus" />새 항목
          </button>
        </div>

        {subs.length > 0 && (
          <div className="dict-mgr-subs">
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

        {draft && (
          <form
            className={`dict-mgr-form ${tab === "artists" ? "is-artist" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) {
                event.preventDefault();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft(null);
              }
            }}
          >
            <div className={`dict-mgr-form-grid ${tab === "artists" ? "is-artist" : ""}`}>
              {tab === "artists" ? (
                <>
                  <label>
                    별명 (선택)
                    <input
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      placeholder="예: 몽환 수채화"
                      autoFocus={draft.index !== null}
                    />
                  </label>
                  <label>
                    작가 태그 / 조합
                    <input
                      value={draft.prompt}
                      onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                      placeholder="예: velzhe 또는 artist:a, 0.8::artist:b::"
                      autoFocus={draft.index === null}
                    />
                  </label>
                  <label>
                    메모
                    <input
                      value={draft.note}
                      onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                      placeholder="선택 사항"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    별명 (표시 이름)
                    <input
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      placeholder="예: 로우 앵글"
                      autoFocus
                    />
                  </label>

                  <label>
                    프롬프트 태그
                    <input
                      value={draft.prompt}
                      onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                      placeholder="예: from below"
                    />
                  </label>

                  {tab === "tags" ? (
                    <label>
                      분류
                      <select
                        value={draft.category}
                        onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                      >
                        {tagCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label>
                      분류
                      <input
                        value={draft.category}
                        onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                        placeholder="예: 장면, 포즈, 표정"
                      />
                    </label>
                  )}

                  <label>
                    메모
                    <input
                      value={draft.note}
                      onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                      placeholder="선택 사항"
                    />
                  </label>
                </>
              )}
            </div>
            <div className="dict-mgr-form-actions">
              {draft.index !== null && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => { if (draft.index !== null) removeAt(draft.index); }}
                >
                  삭제
                </button>
              )}
              <span className="dict-mgr-form-spacer" />
              <button type="button" onClick={() => setDraft(null)}>취소</button>
              <button type="submit" className="primary">
                {draft.index === null ? "추가" : "저장"}
              </button>
            </div>
          </form>
        )}

        <div className="dict-mgr-list">
          {rows.length === 0 ? (
            <div className="dict-mgr-empty">표시할 항목이 없습니다. 카드를 눌러 바로 수정할 수 있습니다.</div>
          ) : rows.map((row) => {
            const isEditing = draft?.index === row.index;
            return (
              <div
                className={`dict-mgr-row ${isEditing ? "editing" : ""}`}
                key={`${tab}-${row.index}`}
                role="button"
                tabIndex={0}
                title={row.tooltip}
                onClick={() => openEdit(row.index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEdit(row.index);
                  }
                }}
              >
                <div className="dict-mgr-row-info">
                  <strong>{row.title}</strong>
                  {row.meta && <small>{row.meta}</small>}
                </div>
                <div className="dict-mgr-row-actions">
                  <button
                    type="button"
                    className={row.pinned ? "fav" : ""}
                    aria-label="즐겨찾기"
                    onClick={(event) => {
                      event.stopPropagation();
                      togglePin(row.index);
                    }}
                  >
                    {row.pinned ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label="삭제"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeAt(row.index);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
