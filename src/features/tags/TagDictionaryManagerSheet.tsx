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
      category: tab === "tags" ? TAG_CATEGORIES[0] : "",
      aliases: "",
      note: "",
    });
  };

  const openEdit = (index: number) => {
    if (tab === "artists") {
      const item = data.artists[index];
      if (!item) return;
      setDraft({ index, title: item.name, prompt: item.name, category: "", aliases: "", note: item.note ?? "" });
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
      const name = draft.title.trim();
      if (!name) return;
      const nextList: StoredArtist[] = [...data.artists];
      if (draft.index === null) nextList.unshift({ name, note: draft.note.trim(), pinned: false });
      else nextList[draft.index] = { ...nextList[draft.index], name, note: draft.note.trim() };
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
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === "artists") {
      return data.artists
        .map((item, index) => ({
          index,
          title: item.name,
          subtitle: item.note || "",
          pinned: !!item.pinned,
          hay: `${item.name} ${item.note ?? ""}`.toLowerCase(),
        }))
        .filter((row) => !q || row.hay.includes(q));
    }
    if (tab === "actions") {
      return data.actions
        .map((item, index) => {
          const prompt = item.prompt ?? item.name ?? "";
          const title = item.title ?? item.name ?? prompt;
          return {
            index,
            title,
            subtitle: [item.category, prompt, item.aliases].filter(Boolean).join(" · "),
            pinned: !!item.pinned,
            hay: `${title} ${prompt} ${item.category ?? ""} ${item.aliases ?? ""} ${item.note ?? ""}`.toLowerCase(),
          };
        })
        .filter((row) => !q || row.hay.includes(q));
    }
    return data.tags
      .map((item, index) => ({
        index,
        title: item.title,
        subtitle: [item.category, item.prompt, item.aliases].filter(Boolean).join(" · "),
        pinned: !!item.pinned,
        hay: `${item.title} ${item.prompt} ${item.category ?? ""} ${item.aliases ?? ""} ${item.note ?? ""}`.toLowerCase(),
      }))
      .filter((row) => !q || row.hay.includes(q));
  }, [tab, data, query]);

  return (
    <div className="sheet dict-mgr-sheet">
      <div className="sheet-head">
        <div className="drag-handle" />
        <div><h2>태그사전 편집</h2></div>
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
                onClick={() => { setTab(key); setDraft(null); }}
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
            placeholder="검색"
          />
          <button type="button" className="dict-mgr-add-btn" onClick={openNew}>
            <Icon name="plus" />새 항목
          </button>
        </div>

        {draft && (
          <div className="dict-mgr-form">
            <div className="dict-mgr-form-grid">
              <label>
                {tab === "artists" ? "작가 태그명" : "표시 이름"}
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder={tab === "artists" ? "예: velzhe 또는 artist:velzhe" : "예: 로우 앵글"}
                  autoFocus
                />
              </label>

              {tab !== "artists" && (
                <label>
                  프롬프트 태그
                  <input
                    value={draft.prompt}
                    onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                    placeholder="예: from below"
                  />
                </label>
              )}

              {tab === "tags" && (
                <label>
                  카테고리
                  <select
                    value={draft.category}
                    onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  >
                    {TAG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}

              {tab === "actions" && (
                <label>
                  카테고리
                  <input
                    value={draft.category}
                    onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                    placeholder="예: 포즈, 표정, 손"
                  />
                </label>
              )}

              {tab !== "artists" && (
                <label>
                  검색 별칭 (쉼표 구분)
                  <input
                    value={draft.aliases}
                    onChange={(event) => setDraft({ ...draft, aliases: event.target.value })}
                    placeholder="예: 로우앵글, 아래에서"
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
            </div>
            <div className="dict-mgr-form-actions">
              <button type="button" onClick={() => setDraft(null)}>취소</button>
              <button type="button" className="primary" onClick={saveDraft}>
                {draft.index === null ? "추가" : "저장"}
              </button>
            </div>
          </div>
        )}

        <div className="dict-mgr-list">
          {rows.map((row) => (
            <div className="dict-mgr-row" key={`${tab}-${row.index}`}>
              <div className="dict-mgr-row-info">
                <strong>{row.title}</strong>
                {row.subtitle && <small>{row.subtitle}</small>}
              </div>
              <div className="dict-mgr-row-actions">
                <button
                  type="button"
                  className={row.pinned ? "fav" : ""}
                  aria-label="즐겨찾기"
                  onClick={() => togglePin(row.index)}
                >
                  {row.pinned ? "★" : "☆"}
                </button>
                <button type="button" onClick={() => openEdit(row.index)}>수정</button>
                <button type="button" className="danger" onClick={() => removeAt(row.index)}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
