import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { searchLocalTags, type LocalTag, type TagCategory } from "../tags/localTagIndex";
import { autocompleteQuery } from "../tags/AutocompleteTextarea";
import { insertionForSuggestion, selectionOrWhole } from "../tags/promptEditorModel";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { usePromptHistoryStore } from "../../stores/promptHistoryStore";
import { useTranslationStore } from "../../stores/translationStore";
import { Icon } from "../../components/Icon";
import { BACK_PRIORITY, useBackLayer } from "../../app/backStack";
import { adjustEmphasis } from "./weight";
import {
  adjustTagWeightAt,
  insertTagsAt,
  moveTagAt,
  removeTagAt,
  replaceTagAt,
  splitTags,
  tagWeight,
  topLevelSeparators,
  withWeightOf,
} from "./tagChips";

/** Actions the surrounding tool row can trigger on the board. */
export type TagBoardTools = {
  editing: boolean;
  canWeight: boolean;
  weight: (delta: number) => void;
  canTranslate: boolean;
  translating: boolean;
  translate: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Commits the tag being typed, so Generate sees it. */
  flush: () => void;
};

type Draft =
  | { mode: "new"; at: number; text: string }
  | { mode: "edit"; index: number; text: string; original: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  historyKey: string;
  categories?: TagCategory[];
  tagPrefix?: string;
  placeholder?: string;
  onSelectTag?: (tag: LocalTag) => void;
  /** Quiet line above the chips (hint, diff chip, character row). */
  header?: ReactNode;
  renderTools: (tools: TagBoardTools) => ReactNode;
};

type Anchor = { top: number; left: number; arrow: number };

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/** Elements a tap may land on without closing the chip bubble. */
export const KEEPS_BUBBLE = ".tag-bubble, .tag-chip, [data-keeps-selection]";

export const EMPTY_TAP_MAX_MOVE = 10;
export const EMPTY_TAP_MAX_MS = 500;

/**
 * What a tap on the editor's empty space does: start a new tag at the end (closing an
 * open bubble in the same tap). Moves (swipes, scrolling) and taps while typing do nothing.
 */
export function emptyAreaTap(input: {
  dx: number;
  dy: number;
  durationMs: number;
  typing: boolean;
}): "start-input" | "none" {
  const { dx, dy, durationMs, typing } = input;
  if (Math.hypot(dx, dy) >= EMPTY_TAP_MAX_MOVE || durationMs > EMPTY_TAP_MAX_MS) return "none";
  if (typing) return "none";
  return "start-input";
}

/** Whether a pointerdown target is outside the bubble, the chips and selection tools. */
export function closesBubble(target: { closest: (selector: string) => unknown } | null) {
  return !target || !target.closest(KEEPS_BUBBLE);
}
const identity = (index: number) => index;
const tagCount = (value: string) => splitTags(value).length;

/**
 * Main-screen tag editor: one large chip per tag (or per weight/bracket group). Tap a
 * chip for the action bubble (weight, move, edit, delete), tap it again to edit,
 * "＋ 태그 추가" to type new tags with local autocomplete right under the input.
 * Edits rewrite only the affected tag's text; separators and line breaks stay.
 */
export function TagBoard({
  value,
  onChange,
  historyKey,
  categories,
  tagPrefix,
  placeholder,
  onSelectTag,
  header,
  renderTools,
}: Props) {
  const tags = useMemo(() => splitTags(value), [value]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<LocalTag[]>([]);
  const [bubble, setBubble] = useState<Anchor | null>(null);
  const [listTop, setListTop] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emptyPress = useRef<{ x: number; y: number; at: number; typing: boolean } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const checkpoint = usePromptHistoryStore((state) => state.checkpoint);
  const undoHistory = usePromptHistoryStore((state) => state.undo);
  const redoHistory = usePromptHistoryStore((state) => state.redo);
  const canUndo = usePromptHistoryStore((state) => (state.histories[historyKey]?.past.length ?? 0) > 0);
  const canRedo = usePromptHistoryStore((state) => (state.histories[historyKey]?.future.length ?? 0) > 0);
  const translateText = useTranslationStore((state) => state.translate);
  const translating = useTranslationStore((state) => state.translating);
  const favorites = useTagStore((state) => state.favorites);
  const toggleFavorite = useTagStore((state) => state.toggleFavorite);
  const characterEntries = useCharacterLibraryStore((state) => state.entries);
  const toggleCharacter = useCharacterLibraryStore((state) => state.toggleTag);

  const setDraft = (next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  };

  // Any tap outside the bubble, the chips and selection tools closes the bubble
  // (pointerdown, so it works for touch in the Android WebView).
  useEffect(() => {
    if (selected === null) return;
    const onDown = (event: PointerEvent) => {
      if (closesBubble(event.target instanceof Element ? event.target : null)) setSelected(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selected]);

  // Android Back: bubble / suggestions first, then leave typing.
  useBackLayer(selected !== null, () => setSelected(null), BACK_PRIORITY.popover);
  useBackLayer(suggestions.length > 0, () => setSuggestions([]), BACK_PRIORITY.popover);
  useBackLayer(draft !== null, () => {
    commitDraft(true);
    inputRef.current?.blur();
  }, BACK_PRIORITY.typing);

  // Tags changed from outside (undo, dictionary insert, load): drop a stale selection.
  useEffect(() => {
    setSelected((current) => (current !== null && current >= tags.length ? null : current));
    setArmed(null);
  }, [tags.length]);

  const snapshot = (text: string, activeIndex?: number) => ({ value: text, selectionStart: 0, selectionEnd: 0, activeIndex });

  /** Applies new section text as one undo step. */
  const apply = (next: string, activeIndex?: number) => {
    if (next === valueRef.current) return;
    checkpoint(historyKey, snapshot(valueRef.current, activeIndex));
    valueRef.current = next;
    onChange(next);
  };

  /** Commits the typed text; returns how old chip indexes map to the new list. */
  const commitDraft = (close: boolean): ((index: number) => number) => {
    const current = draftRef.current;
    if (!current) return identity;
    const before = valueRef.current;
    const next = current.mode === "new"
      ? insertTagsAt(before, current.text, current.at)
      : replaceTagAt(before, current.index, current.text);
    const delta = tagCount(next) - tagCount(before);
    apply(next, current.mode === "new" ? current.at : current.index);
    setSuggestions([]);
    setArmed(null);
    if (current.mode === "new") {
      setDraft(close ? null : { mode: "new", at: current.at + delta, text: "" });
      return (index) => (index >= current.at ? index + delta : index);
    }
    setDraft(close ? null : { mode: "new", at: current.index + 1 + delta, text: "" });
    return (index) => (index > current.index ? index + delta : index);
  };

  /**
   * Opens the input and focuses it in the same tap handler. Android WebView raises the
   * soft keyboard only for a focus() made synchronously inside the user gesture, so the
   * input is rendered with flushSync first and focused right away.
   */
  const openDraft = (next: Draft) => {
    flushSync(() => {
      setSelected(null);
      setMessage(null);
      setDraft(next);
    });
    inputRef.current?.focus({ preventScroll: true });
  };

  const startNew = () => openDraft({ mode: "new", at: tagCount(valueRef.current), text: "" });

  const startEdit = (index: number) => {
    const text = splitTags(valueRef.current)[index] ?? "";
    openDraft({ mode: "edit", index, text, original: text });
  };

  const tapChip = (index: number) => {
    setMessage(null);
    if (draftRef.current) {
      // The chip keeps the input focused on pointerdown, so the draft is committed
      // here and the tapped chip is found again after the list shifted.
      setSelected(commitDraft(true)(index));
      return;
    }
    if (selected === index) startEdit(index);
    else setSelected(index);
  };

  // Focus the input as soon as it appears (same task as the tap, so Android raises the keyboard).
  const draftKey = draft ? `${draft.mode}:${draft.mode === "new" ? draft.at : draft.index}` : null;
  useLayoutEffect(() => {
    if (!draftKey) return;
    const input = inputRef.current;
    if (!input) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "nearest" });
  }, [draftKey]);

  // Keep the input visible while the soft keyboard resizes the viewport.
  useEffect(() => {
    if (!draftKey) return;
    const viewport = window.visualViewport;
    const reveal = () => inputRef.current?.scrollIntoView({ block: "nearest" });
    viewport?.addEventListener("resize", reveal);
    window.addEventListener("resize", reveal);
    return () => {
      viewport?.removeEventListener("resize", reveal);
      window.removeEventListener("resize", reveal);
    };
  }, [draftKey]);

  // Autocomplete for the tag being typed.
  const draftText = draft?.text ?? "";
  const drafting = draft !== null;
  useEffect(() => {
    const query = autocompleteQuery(draftText, tagPrefix);
    if (!drafting || query.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchLocalTags(query, categories, 12).then((next) => {
        if (!cancelled) setSuggestions(next.slice(0, 8));
      });
    }, 110);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draftText, drafting, categories, tagPrefix]);

  // Bubble anchored under the selected chip, clamped to the board.
  useLayoutEffect(() => {
    if (selected === null) {
      setBubble(null);
      return;
    }
    const chip = chipRefs.current[selected];
    const content = contentRef.current;
    const panel = bubbleRef.current;
    if (!chip || !content) return;
    const width = panel?.offsetWidth ?? 360;
    const center = chip.offsetLeft + chip.offsetWidth / 2;
    const left = Math.max(0, Math.min(center - width / 2, content.clientWidth - width));
    setBubble({ top: chip.offsetTop + chip.offsetHeight + 10, left, arrow: center - left });
  }, [selected, value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!draft || !suggestions.length || !input) {
      setListTop(null);
      return;
    }
    setListTop(input.offsetTop + input.offsetHeight + 8);
  }, [draft, suggestions.length]);

  const choose = (tag: LocalTag) => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = { ...current, text: insertionForSuggestion(tag.display, tag.category, tagPrefix) };
    commitDraft(false);
    onSelectTag?.(tag);
  };

  const typed = (text: string) => {
    const current = draftRef.current;
    if (!current) return;
    setArmed(null);
    const separators = topLevelSeparators(text);
    if (!separators.length) {
      setDraft({ ...current, text });
      return;
    }
    // A comma outside a group finishes the tags before it; the rest stays in the input.
    const last = separators[separators.length - 1];
    draftRef.current = { ...current, text: text.slice(0, last) };
    commitDraft(false);
    const after = draftRef.current;
    if (after) setDraft({ ...after, text: text.slice(last + 1).trimStart() });
  };

  const bubbleAction = (action: "down" | "up" | "left" | "right" | "edit" | "delete") => {
    if (selected === null) return;
    const current = valueRef.current;
    if (action === "down" || action === "up") apply(adjustTagWeightAt(current, selected, action === "up" ? 0.1 : -0.1), selected);
    if (action === "left" || action === "right") {
      const direction = action === "left" ? -1 : 1;
      const next = moveTagAt(current, selected, direction);
      if (next !== current) {
        apply(next, selected);
        setSelected(selected + direction);
      }
    }
    if (action === "edit") startEdit(selected);
    if (action === "delete") {
      apply(removeTagAt(current, selected), selected);
      setSelected(null);
    }
  };

  const weight = (delta: number) => {
    const current = draftRef.current;
    const input = inputRef.current;
    if (current && input) {
      const range = selectionOrWhole(input.selectionStart ?? 0, input.selectionEnd ?? 0, current.text.length);
      if (range.end <= range.start) return;
      const out = adjustEmphasis(current.text, range.start, range.end, delta);
      setDraft({ ...current, text: out.text });
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(out.start, out.end));
      return;
    }
    if (selected !== null) apply(adjustTagWeightAt(valueRef.current, selected, delta), selected);
  };

  const translate = async () => {
    if (translating) return;
    const current = draftRef.current;
    const input = inputRef.current;
    setMessage(null);
    try {
      if (current && input) {
        const range = selectionOrWhole(input.selectionStart ?? 0, input.selectionEnd ?? 0, current.text.length);
        const source = current.text.slice(range.start, range.end).trim();
        if (!source) return;
        const translated = await translateText(source);
        const latest = draftRef.current;
        if (!latest || latest.text !== current.text) {
          setMessage("번역 중 입력이 바뀌어 결과를 적용하지 않았습니다.");
          return;
        }
        setDraft({ ...latest, text: `${latest.text.slice(0, range.start)}${translated}${latest.text.slice(range.end)}` });
        return;
      }
      if (selected === null) return;
      const source = splitTags(valueRef.current)[selected];
      if (!source) return;
      const translated = await translateText(tagWeight(source).content);
      if (splitTags(valueRef.current)[selected] !== source) {
        setMessage("번역 중 태그가 바뀌어 결과를 적용하지 않았습니다.");
        return;
      }
      apply(replaceTagAt(valueRef.current, selected, withWeightOf(source, translated)), selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  /** Undo/redo keep a half-typed tag: it stays in the input for a new tag. */
  const restore = (direction: "undo" | "redo") => {
    setSelected(null);
    const current = snapshot(valueRef.current);
    const target = direction === "undo" ? undoHistory(historyKey, current) : redoHistory(historyKey, current);
    if (!target) return;
    valueRef.current = target.value;
    onChange(target.value);
    const pending = draftRef.current;
    if (!pending) return;
    const count = tagCount(target.value);
    if (pending.mode === "edit" && pending.text.trim() === pending.original.trim()) setDraft(null);
    else setDraft({ mode: "new", at: Math.min(pending.mode === "new" ? pending.at : pending.index, count), text: pending.text });
  };

  const editingInput = (
    <span className="tag-input-wrap" key="tag-input">
      <input
        ref={inputRef}
        className="tag-chip-input"
        value={draft?.text ?? ""}
        placeholder={draft?.mode === "new" && !tags.length ? placeholder : "태그 입력"}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        size={Math.max(8, (draft?.text.length ?? 0) + 2)}
        onChange={(event) => typed(event.target.value)}
        onBlur={() => commitDraft(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Enter confirming an IME composition (Korean input) is not a commit.
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            const current = draftRef.current;
            // Enter on an empty new-tag input closes it; otherwise commit and keep typing.
            if (current?.mode === "new" && !current.text.trim()) setDraft(null);
            else commitDraft(current?.mode === "edit");
            return;
          }
          if (event.key === "Escape") {
            setDraft(null);
            return;
          }
          const current = draftRef.current;
          if (event.key === "Backspace" && current?.mode === "new" && !current.text && current.at > 0) {
            event.preventDefault();
            const previous = current.at - 1;
            if (armed === previous) {
              apply(removeTagAt(valueRef.current, previous), previous);
              setDraft({ ...current, at: previous });
              setArmed(null);
            } else {
              setArmed(previous);
            }
            return;
          }
          setArmed(null);
        }}
      />
    </span>
  );

  // While typing, chips keep the input focused on pointerdown so the tap is handled
  // (commit + select) in one place instead of by a blur that shifts the list first.
  const chipPointerDown = (event: { preventDefault: () => void }) => {
    if (draftRef.current) event.preventDefault();
  };

  const chips: ReactNode[] = [];
  tags.forEach((tag, index) => {
    if (draft?.mode === "new" && draft.at === index) chips.push(editingInput);
    if (draft?.mode === "edit" && draft.index === index) {
      chips.push(editingInput);
      return;
    }
    const { weight: tagWeightValue, content, weighted } = tagWeight(tag);
    chips.push(
      <button
        type="button"
        key={`${index}:${tag}`}
        ref={(element) => { chipRefs.current[index] = element; }}
        className={`tag-chip ${selected === index ? "selected" : ""} ${armed === index ? "armed" : ""} ${weighted ? (tagWeightValue >= 1 ? "weight-up" : "weight-down") : ""}`}
        aria-pressed={selected === index}
        onPointerDown={chipPointerDown}
        onClick={() => tapChip(index)}
      >
        <span className="tag-chip-text">{content || tag}</span>
        {weighted && <small className="tag-chip-weight">{tagWeightValue.toFixed(1)}</small>}
      </button>,
    );
  });
  chipRefs.current.length = tags.length;
  const inputAtEnd = draft?.mode === "new" && draft.at >= tags.length;
  if (inputAtEnd) chips.push(editingInput);
  else {
    chips.push(
      <button
        type="button"
        key="add"
        className="tag-chip tag-chip-add"
        onPointerDown={chipPointerDown}
        onClick={() => {
          if (draftRef.current) commitDraft(true);
          startNew();
        }}
      >
        <Icon name="plus" /> 태그 추가
      </button>,
    );
  }

  const tools: TagBoardTools = {
    editing: draft !== null,
    canWeight: draft !== null ? !!draft.text.trim() : selected !== null,
    weight,
    canTranslate: draft !== null ? !!draft.text.trim() : selected !== null,
    translating,
    translate: () => void translate(),
    canUndo,
    canRedo,
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    flush: () => { commitDraft(false); },
  };

  return (
    <div className="tag-board">
      <div
        ref={scrollRef}
        className="tag-board-scroll"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          const empty = target === scrollRef.current || target === contentRef.current || target.classList.contains("tag-board-placeholder");
          emptyPress.current = empty
            ? { x: event.clientX, y: event.clientY, at: Date.now(), typing: draftRef.current !== null }
            : null;
        }}
        onPointerCancel={() => { emptyPress.current = null; }}
        onClick={(event) => {
          // Click (not pointerup) so the browser's own focus change on mousedown is over
          // before the new input takes focus; no click follows a scroll.
          const press = emptyPress.current;
          emptyPress.current = null;
          if (!press) return;
          const action = emptyAreaTap({
            dx: event.clientX - press.x,
            dy: event.clientY - press.y,
            durationMs: Date.now() - press.at,
            typing: press.typing,
          });
          if (action === "start-input") startNew();
        }}
      >
        {header}
        {message && <div className="tag-board-message" role="status">{message}</div>}
        <div
          ref={contentRef}
          className="tag-board-chips"
        >
          {chips}
          {!tags.length && !draft && placeholder && <span className="tag-board-placeholder">{placeholder}</span>}

          {selected !== null && (
            <div
              ref={bubbleRef}
              className="tag-bubble"
              role="toolbar"
              aria-label="태그 동작"
              style={{
                top: bubble?.top ?? 0,
                left: bubble?.left ?? 0,
                visibility: bubble ? "visible" : "hidden",
                ["--arrow" as string]: `${bubble?.arrow ?? 0}px`,
              }}
            >
              <button type="button" onClick={() => bubbleAction("down")} aria-label="가중치 −0.1">−0.1</button>
              <button type="button" onClick={() => bubbleAction("up")} aria-label="가중치 +0.1">+0.1</button>
              <span className="tag-bubble-divider" />
              <button type="button" disabled={selected === 0} onClick={() => bubbleAction("left")} aria-label="왼쪽으로 이동"><Icon name="left" /></button>
              <button type="button" disabled={selected >= tags.length - 1} onClick={() => bubbleAction("right")} aria-label="오른쪽으로 이동"><Icon name="right" /></button>
              <span className="tag-bubble-divider" />
              <button type="button" onClick={() => bubbleAction("edit")}>수정</button>
              <button type="button" className="danger" onClick={() => bubbleAction("delete")} aria-label="삭제"><Icon name="trash" /></button>
            </div>
          )}

          {listTop !== null && suggestions.length > 0 && (
            <div className="tag-suggestions" style={{ top: listTop }}>
              {suggestions.map((tag) => {
                const isCharacter = tag.category === "character";
                const saved = isCharacter
                  ? characterEntries.some((entry) => entry.raw === tag.raw)
                  : favorites.includes(tag.raw);
                return (
                  <div className="tag-suggestion" key={tag.raw}>
                    <button type="button" className="tag-suggestion-main" onPointerDown={keepFocus} onClick={() => choose(tag)}>
                      <span className={`tag-dot ${tag.category}`} />
                      <span className="tag-suggestion-name">{tag.display}</span>
                      {tag.count > 0 && <small>{tag.count.toLocaleString()}</small>}
                    </button>
                    <button
                      type="button"
                      className={`favorite-button ${saved ? "active" : ""}`}
                      aria-label={isCharacter ? "캐릭터 도감에 저장" : "즐겨찾기"}
                      onPointerDown={keepFocus}
                      onClick={() => (isCharacter ? toggleCharacter(tag) : toggleFavorite(tag.raw))}
                    >
                      ★
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {renderTools(tools)}
    </div>
  );
}
