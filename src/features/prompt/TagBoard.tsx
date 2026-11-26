import { useDesktopLayout, nativeTextTarget } from "../../app/desktopLayout";
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
import { useBackLayer } from "../../app/backStack";
import { adjustEmphasis } from "./weight";
import {
  adjustTagWeightAt,
  insertTagsAt,
  moveTagAt,
  removeTagAt,
  removeTagsAt,
  reorderTagAt,
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
  /** Optional banner inside the S11 chips box (e.g. drawn random character). */
  banner?: ReactNode;
  renderTools: (tools: TagBoardTools) => ReactNode;
  /** Editing mode: true while a tag input is open (it drives the compact layout, not the keyboard). */
  onEditingChange?: (editing: boolean) => void;
  /**
   * Mount with the new-tag input already open and focused (read on mount only). Used when a
   * section switch carries editing over, so focus moves within the same tap and Android
   * keeps the keyboard up.
   */
  startEditing?: boolean;
  /** Tablet portrait mode: keyboard is up, show compact Generate inside the input dock. */
  keyboardOpen?: boolean;
  onQuickGenerate?: () => void;
  generateDisabled?: boolean;
  /** Optional action when multiple chips are selected (e.g. save selected artist combo as preset). */
  onSaveSelection?: (selectedText: string) => void;
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

/** Room kept around the input or selected chip when the board scrolls to it. */
export const REVEAL_MARGIN = 12;

/**
 * Board scroll position that shows an anchor (the tag input or the selected chip):
 * unchanged when it is already fully visible, otherwise the smallest scroll that shows
 * it (its top wins when it is taller than the board). `anchorTop` is measured from the
 * board's visible top. Only the board scrolls, never the page or the shell.
 */
export function revealScrollTop(input: {
  scrollTop: number;
  viewHeight: number;
  anchorTop: number;
  anchorHeight: number;
  margin?: number;
}) {
  const { scrollTop, viewHeight, anchorTop, anchorHeight, margin = REVEAL_MARGIN } = input;
  const overBottom = anchorTop + anchorHeight + margin - viewHeight;
  const delta = anchorTop < margin ? anchorTop - margin : overBottom > 0 ? Math.min(overBottom, anchorTop - margin) : 0;
  return Math.max(0, scrollTop + delta);
}

/**
 * Whether switching section (tab, 품질/제외, character) keeps editing in the new section:
 * only while a tag is being edited with the keyboard up. Otherwise the switch behaves as
 * before (the input's blur commits it and the keyboard closes).
 */
export function switchCarriesEditing(state: { editing: boolean; keyboard: boolean }) {
  return state.editing && state.keyboard;
}

/** First draft of a board: a new-tag input at the end when editing is carried over. */
export function initialDraft(startEditing: boolean | undefined, value: string): Draft | null {
  return startEditing ? { mode: "new", at: tagCount(value), text: "" } : null;
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
  banner,
  renderTools,
  onEditingChange,
  startEditing,
  keyboardOpen = false,
  onQuickGenerate,
  generateDisabled = false,
  onSaveSelection,
}: Props) {
  const desktop = useDesktopLayout();
  const tags = useMemo(() => splitTags(value), [value]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set());
  const selectionAnchorRef = useRef<number | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(() => initialDraft(startEditing, value));
  const draftRef = useRef<Draft | null>(draft);
  const [dockText, setDockText] = useState("");
  const dockInputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; x: number; y: number; label: string } | null>(null);
  const dragRef = useRef<{ from: number; over: number } | null>(null);
  const holdRef = useRef<{ timer: number; pointerId: number; startX: number; startY: number; index: number } | null>(null);
  const suppressClickRef = useRef(false);
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

  const clearSelection = () => {
    selectionAnchorRef.current = null;
    setSelected(null);
    setSelectedIndices(new Set());
  };

  const selectSingle = (index: number) => {
    selectionAnchorRef.current = index;
    setSelected(index);
    setSelectedIndices(new Set([index]));
  };

  const selectRange = (anchor: number, end: number) => {
    const lo = Math.min(anchor, end);
    const hi = Math.max(anchor, end);
    const next = new Set<number>();
    for (let i = lo; i <= hi; i += 1) next.add(i);
    selectionAnchorRef.current = anchor;
    setSelected(end);
    setSelectedIndices(next);
  };

  const toggleSelect = (index: number) => {
    setSelectedIndices((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
        if (next.size === 0) {
          selectionAnchorRef.current = null;
          setSelected(null);
        } else {
          const fallback = Array.from(next)[next.size - 1];
          selectionAnchorRef.current = fallback;
          setSelected(fallback);
        }
      } else {
        next.add(index);
        selectionAnchorRef.current = index;
        setSelected(index);
      }
      return next;
    });
  };

  const selectionCount = selectedIndices.size;
  const multiSelected = selectionCount > 1;

  // Any tap outside the bubble, the chips and selection tools closes the bubble
  // (pointerdown, so it works for touch in the Android WebView).
  useEffect(() => {
    if (selected === null && selectedIndices.size === 0) return;
    const onDown = (event: PointerEvent) => {
      if (closesBubble(event.target instanceof Element ? event.target : null)) clearSelection();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selected, selectedIndices.size]);

  // Android Back (newest layer first): with the keyboard hidden, suggestions close first
  // (they open after the input), then editing ends (the typed tag is kept).
  useBackLayer(selected !== null || selectedIndices.size > 0, clearSelection);
  useBackLayer(suggestions.length > 0, () => setSuggestions([]));
  useBackLayer(draft !== null, () => {
    commitDraft(true);
    inputRef.current?.blur();
  });

  // Tags changed from outside (undo, dictionary insert, load): drop a stale selection.
  useEffect(() => {
    setSelected((current) => (current !== null && current >= tags.length ? null : current));
    setSelectedIndices((current) => {
      if (current.size === 0) return current;
      const valid = Array.from(current).filter((i) => i < tags.length);
      return valid.length === current.size ? current : new Set(valid);
    });
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
      clearSelection();
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

  const tapChip = (index: number, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    setMessage(null);
    if (draftRef.current) {
      // The chip keeps the input focused on pointerdown, so the draft is committed
      // here and the tapped chip is found again after the list shifted.
      selectSingle(commitDraft(true)(index));
      return;
    }
    if (desktop && event?.shiftKey && selected !== null) {
      selectRange(selectionAnchorRef.current ?? selected, index);
      return;
    }
    if (desktop && (event?.ctrlKey || event?.metaKey)) {
      toggleSelect(index);
      return;
    }
    if (!desktop && selected === index && !multiSelected) startEdit(index);
    else selectSingle(index);
  };

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  /**
   * Keeps the tag input (or else the selected chip) visible by scrolling the board only.
   * `scrollIntoView` also scrolled the shell and panned the page, which made the whole
   * screen jump while the keyboard opened and closed.
   */
  const revealAnchor = () => {
    const scroller = scrollRef.current;
    const anchor = draftRef.current ? inputRef.current : selectedRef.current !== null ? chipRefs.current[selectedRef.current] : null;
    if (!scroller || !anchor) return;
    const view = scroller.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    const next = revealScrollTop({
      scrollTop: scroller.scrollTop,
      viewHeight: scroller.clientHeight,
      anchorTop: box.top - view.top,
      anchorHeight: box.height,
    });
    if (next !== scroller.scrollTop) scroller.scrollTop = next;
  };

  // Focus the input as soon as it appears (same task as the tap, so Android raises the keyboard).
  const draftKey = draft ? `${draft.mode}:${draft.mode === "new" ? draft.at : draft.index}` : null;
  useLayoutEffect(() => {
    if (!draftKey) return;
    const input = inputRef.current;
    if (!input) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    revealAnchor();
  }, [draftKey]);

  // The board changes height when editing mode compacts the header and when the keyboard
  // opens or closes; the anchor stays where it is on screen when it can, else it scrolls
  // into the board once.
  const anchored = draftKey !== null || selected !== null;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!anchored || !scroller || typeof ResizeObserver === "undefined") return;
    let height = scroller.clientHeight;
    const observer = new ResizeObserver(() => {
      if (scroller.clientHeight === height) return;
      height = scroller.clientHeight;
      revealAnchor();
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [anchored]);

  const draftText = desktop ? (draft?.text ?? "") : (draft?.mode === "edit" ? draft.text : dockText);
  const drafting = desktop ? draft !== null : (draft !== null || !!dockText.trim());

  // Editing mode is reported before paint, so the layout switches in the same frame as the tap.
  const editingChangeRef = useRef(onEditingChange);
  editingChangeRef.current = onEditingChange;
  useLayoutEffect(() => {
    editingChangeRef.current?.(drafting);
  }, [drafting]);
  useLayoutEffect(() => () => editingChangeRef.current?.(false), []);

  // Autocomplete for the tag being typed.
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
    const chipBox = chip.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    const center = desktop ? chipBox.left - contentBox.left + chipBox.width / 2 : chip.offsetLeft + chip.offsetWidth / 2;
    const left = Math.max(0, Math.min(center - width / 2, content.clientWidth - width));
    setBubble({ top: desktop ? chipBox.bottom - contentBox.top + 10 : chip.offsetTop + chip.offsetHeight + 10, left, arrow: center - left });
  }, [selected, value, desktop]);

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
      if (selectedIndices.size > 1) {
        const first = Math.min(...selectedIndices);
        apply(removeTagsAt(current, selectedIndices), first);
      } else {
        apply(removeTagAt(current, selected), selected);
      }
      clearSelection();
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

  useEffect(() => {
    if (!desktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (nativeTextTarget(event.target) || (selected === null && selectedIndices.size === 0)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        bubbleAction("delete");
      } else if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    const isSelected = selectedIndices.has(index) || selected === index;
    const chip = (
      <button
        type="button"
        key={`${index}:${tag}`}
        ref={(element) => { chipRefs.current[index] = element; }}
        className={`tag-chip ${isSelected ? "selected" : ""} ${multiSelected && isSelected ? "multi-selected" : ""} ${armed === index ? "armed" : ""} ${weighted ? (tagWeightValue >= 1 ? "weight-up" : "weight-down") : ""}`}
        aria-pressed={isSelected}
        onPointerDown={chipPointerDown}
        onClick={(event) => tapChip(index, event)}
        onDoubleClick={desktop ? () => startEdit(index) : undefined}
      >
        <span className="tag-chip-text">{content || tag}</span>
        {weighted && <small className="tag-chip-weight">{tagWeightValue.toFixed(1)}</small>}
      </button>
    );
    chips.push(desktop ? (
      <span className="tag-chip-wrap" key={`${index}:${tag}`}>
        {chip}
        <button type="button" className="chip-x" aria-label={`${content || tag} 삭제`} onPointerDown={keepFocus} onClick={() => { apply(removeTagAt(valueRef.current, index), index); clearSelection(); }}>×</button>
      </span>
    ) : chip);
  });
  chipRefs.current.length = tags.length;
  const previousTagCount = useRef(tags.length);
  useLayoutEffect(() => {
    if (desktop && tags.length > previousTagCount.current && !draftRef.current) {
      // Dictionary/finder insertions stay visible while their panel remains open.
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
    previousTagCount.current = tags.length;
  }, [desktop, tags.length]);
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

  const commitDockInput = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (draft?.mode === "edit") {
      apply(replaceTagAt(valueRef.current, draft.index, trimmed), draft.index);
      setDraft(null);
      setDockText("");
      setSuggestions([]);
      return;
    }
    apply(insertTagsAt(valueRef.current, trimmed), tags.length);
    setDockText("");
    setSuggestions([]);
  };

  const translateDock = async () => {
    if (translating) return;
    const source = (draft?.mode === "edit" ? draft.text : dockText).trim();
    if (!source) return;
    setMessage(null);
    try {
      const translated = await translateText(source);
      if (draft?.mode === "edit") {
        apply(replaceTagAt(valueRef.current, draft.index, withWeightOf(draft.original, translated)), draft.index);
        setDraft(null);
      } else {
        apply(insertTagsAt(valueRef.current, translated), tags.length);
      }
      setDockText("");
      setSuggestions([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const tools: TagBoardTools = {
    editing: draft !== null,
    canWeight: draft !== null ? !!draft.text.trim() : (selected !== null && !multiSelected),
    weight,
    canTranslate: draft !== null ? !!draft.text.trim() : ((selected !== null && !multiSelected) || !!dockText.trim()),
    translating,
    translate: () => void (dockText.trim() && !draft && selected === null ? translateDock() : translate()),
    canUndo,
    canRedo,
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    flush: () => {
      commitDraft(false);
      if (!desktop && dockText.trim()) commitDockInput(dockText);
    },
  };

  const hitChipIndex = (clientX: number, clientY: number, fallback: number) => {
    let best = fallback;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < chipRefs.current.length; i += 1) {
      const el = chipRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return i;
      }
      const cx = (rect.left + rect.right) / 2;
      const cy = (rect.top + rect.bottom) / 2;
      const dist = Math.hypot(clientX - cx, clientY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };

  useEffect(() => {
    if (!drag) return;
    const updateAt = (clientX: number, clientY: number) => {
      if (!dragRef.current) return;
      const over = hitChipIndex(clientX, clientY, dragRef.current.over);
      dragRef.current.over = over;
      setDrag((prev) => (prev ? { ...prev, over, x: clientX, y: clientY } : null));
    };
    const finish = () => {
      if (holdRef.current) {
        window.clearTimeout(holdRef.current.timer);
        holdRef.current = null;
      }
      const activeDrag = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (activeDrag && activeDrag.from !== activeDrag.over) {
        apply(reorderTagAt(valueRef.current, activeDrag.from, activeDrag.over), activeDrag.over);
        selectSingle(activeDrag.over);
      } else if (
        activeDrag
        && activeDrag.from === activeDrag.over
        && selectedRef.current !== null
        && selectedRef.current !== activeDrag.from
      ) {
        // Two-point range select: tap chip A, then long-press chip B without dragging.
        selectRange(selectionAnchorRef.current ?? selectedRef.current, activeDrag.from);
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      updateAt(touch.clientX, touch.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      event.preventDefault();
      updateAt(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      finish();
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", finish);
    window.addEventListener("touchcancel", finish);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag !== null]);

  const useUnifiedBoard = true;
  if (useUnifiedBoard) {
    const hasSel = (selected !== null && tags[selected] !== undefined) || selectionCount > 0;
    const hasSingleSel = !multiSelected && selected !== null && tags[selected] !== undefined;
    const selectedTag = hasSingleSel ? tagWeight(tags[selected]) : null;
    const dockValue = draft?.mode === "edit" ? draft.text : dockText;

    const clearHold = () => {
      if (holdRef.current) {
        window.clearTimeout(holdRef.current.timer);
        holdRef.current = null;
      }
    };

    return (
      <div className="tag-board s11-tag-board">
        <div className={`s11-chip-bar ${hasSel ? "selected-mode" : ""}`} data-keeps-selection>
          <div className="s11-chip-bar-left">
            {multiSelected ? (
              <span className="s11-chip-bar-label">
                <b>{selectionCount}개 선택됨</b>
              </span>
            ) : hasSingleSel && selectedTag ? (
              <span className="s11-chip-bar-label">
                <b>{selectedTag.content || tags[selected!]}</b>
              </span>
            ) : (
              header
            )}
          </div>
          <div className="s11-chip-bar-actions">
            {multiSelected ? (
              <>
                {onSaveSelection && (
                  <button
                    type="button"
                    data-keeps-selection
                    onPointerDown={keepFocus}
                    onClick={() => {
                      const picked = Array.from(selectedIndices)
                        .sort((a, b) => a - b)
                        .map((idx) => tags[idx])
                        .filter((tag): tag is string => Boolean(tag))
                        .join(", ");
                      clearSelection();
                      if (picked) onSaveSelection(picked);
                    }}
                  >
                    프리셋 저장
                  </button>
                )}
                <button type="button" data-keeps-selection onPointerDown={keepFocus} onClick={clearSelection}>취소</button>
                <button type="button" className="danger" data-keeps-selection onPointerDown={keepFocus} onClick={() => bubbleAction("delete")} aria-label={`${selectionCount}개 삭제`}><Icon name="trash" /> {selectionCount}개 삭제</button>
              </>
            ) : (
              <>
                <button type="button" data-keeps-selection disabled={!hasSingleSel} onPointerDown={keepFocus} onClick={() => bubbleAction("down")}>−0.1</button>
                <button type="button" data-keeps-selection disabled={!hasSingleSel} onPointerDown={keepFocus} onClick={() => bubbleAction("up")}>+0.1</button>
                <button type="button" data-keeps-selection disabled={!hasSingleSel || selected === 0} onPointerDown={keepFocus} onClick={() => bubbleAction("left")} aria-label="왼쪽으로 이동"><Icon name="left" /></button>
                <button type="button" data-keeps-selection disabled={!hasSingleSel || (selected ?? 0) >= tags.length - 1} onPointerDown={keepFocus} onClick={() => bubbleAction("right")} aria-label="오른쪽으로 이동"><Icon name="right" /></button>
                <button type="button" data-keeps-selection disabled={!hasSingleSel || translating} onPointerDown={keepFocus} onClick={() => void translate()}>{translating ? "…" : "번역"}</button>
                <button type="button" data-keeps-selection disabled={!hasSingleSel} onPointerDown={keepFocus} onClick={() => {
                  if (selected === null) return;
                  const orig = tags[selected];
                  setDraft({ mode: "edit", index: selected, text: orig, original: orig });
                  clearSelection();
                  requestAnimationFrame(() => dockInputRef.current?.focus({ preventScroll: true }));
                }}>수정</button>
                <button type="button" className="danger" data-keeps-selection disabled={!hasSel} onPointerDown={keepFocus} onClick={() => bubbleAction("delete")} aria-label="삭제"><Icon name="trash" /></button>
              </>
            )}
          </div>
        </div>

        <div
          ref={scrollRef}
          className={`tag-board-scroll s11-chips-scroll ${drag ? "dragging" : ""}`}
          onPointerMove={(event) => {
            if (!dragRef.current && holdRef.current && Math.hypot(event.clientX - holdRef.current.startX, event.clientY - holdRef.current.startY) > 8) {
              clearHold();
            }
          }}
          onPointerUp={clearHold}
        >
          {banner}
          {message && <div className="tag-board-message" role="status">{message}</div>}
          <div ref={contentRef} className="tag-board-chips">
            {tags.map((tag, index) => {
              const { weight: tagWeightValue, content, weighted } = tagWeight(tag);
              const isDragged = drag?.from === index;
              const isDropTarget = drag !== null && drag.over === index && drag.from !== index;
              const isSelected = selectedIndices.has(index) || selected === index;
              return (
                <button
                  type="button"
                  key={`${index}:${tag}`}
                  ref={(element) => { chipRefs.current[index] = element; }}
                  className={`tag-chip ${isSelected ? "selected" : ""} ${multiSelected && isSelected ? "multi-selected" : ""} ${isDragged ? "is-dragging" : ""} ${isDropTarget ? "is-drop-target" : ""} ${weighted ? (tagWeightValue >= 1 ? "weight-up" : "weight-down") : ""}`}
                  aria-pressed={isSelected}
                  onContextMenu={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    clearHold();
                    suppressClickRef.current = false;
                    const startX = event.clientX;
                    const startY = event.clientY;
                    const pointerId = event.pointerId;
                    const label = content || tag;
                    const timer = window.setTimeout(() => {
                      holdRef.current = null;
                      suppressClickRef.current = true;
                      dragRef.current = { from: index, over: index };
                      setDrag({ from: index, over: index, x: startX, y: startY, label });
                    }, 220);
                    holdRef.current = { timer, pointerId, startX, startY, index };
                  }}
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    if (desktop && event.shiftKey && selected !== null) {
                      selectRange(selectionAnchorRef.current ?? selected, index);
                      return;
                    }
                    if (desktop && (event.ctrlKey || event.metaKey)) {
                      toggleSelect(index);
                      return;
                    }
                    if (!multiSelected && selected === index) clearSelection();
                    else selectSingle(index);
                  }}
                  onDoubleClick={desktop ? () => {
                    const orig = tags[index];
                    setDraft({ mode: "edit", index, text: orig, original: orig });
                    clearSelection();
                    requestAnimationFrame(() => dockInputRef.current?.focus({ preventScroll: true }));
                  } : undefined}
                >
                  {weighted && <small className="tag-chip-weight">{tagWeightValue.toFixed(1)}×</small>}
                  <span className="tag-chip-text">{content || tag}</span>
                </button>
              );
            })}
          </div>
          {drag && (
            <div
              className="s11-drag-ghost"
              style={{ left: drag.x, top: drag.y }}
              aria-hidden="true"
            >
              {drag.label}
            </div>
          )}
        </div>

        <div className="s11-input-dock">
          {suggestions.length > 0 && (
            <div className="s11-suggest-row">
              {suggestions.map((tag) => (
                <button
                  type="button"
                  key={tag.raw}
                  className="s11-suggest-pill"
                  onPointerDown={keepFocus}
                  onClick={() => {
                    const inserted = insertionForSuggestion(tag.display, tag.category, tagPrefix);
                    commitDockInput(inserted);
                    onSelectTag?.(tag);
                  }}
                >
                  <span className={`tag-dot ${tag.category}`} />
                  <span>{tag.display}</span>
                </button>
              ))}
            </div>
          )}
          <div className="s11-input-bar">
            <input
              ref={dockInputRef}
              className="s11-input"
              value={dockValue}
              placeholder={draft?.mode === "edit" ? "태그 수정" : "태그 또는 문장 입력"}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(event) => {
                const next = event.target.value;
                if (draft?.mode === "edit") {
                  setDraft({ ...draft, text: next });
                  return;
                }
                const seps = topLevelSeparators(next);
                if (!seps.length) {
                  setDockText(next);
                  return;
                }
                const last = seps[seps.length - 1];
                commitDockInput(next.slice(0, last));
                setDockText(next.slice(last + 1).trimStart());
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  event.preventDefault();
                  commitDockInput(dockValue);
                } else if (event.key === "Escape" && draft?.mode === "edit") {
                  setDraft(null);
                }
              }}
            />
            <button
              type="button"
              className="s11-input-btn translate"
              disabled={translating || !dockValue.trim()}
              onPointerDown={keepFocus}
              onClick={() => void translateDock()}
            >
              {translating ? "번역 중…" : "번역"}
            </button>
            <button
              type="button"
              className="s11-input-btn"
              disabled={!dockValue.trim()}
              onPointerDown={keepFocus}
              onClick={() => commitDockInput(dockValue)}
            >
              {draft?.mode === "edit" ? "완료" : "추가"}
            </button>
            {keyboardOpen && onQuickGenerate && (
              <button
                type="button"
                className="s11-input-btn gen-mini"
                disabled={generateDisabled}
                onPointerDown={keepFocus}
                onClick={() => {
                  if (dockValue.trim()) commitDockInput(dockValue);
                  onQuickGenerate();
                }}
              >
                생성
              </button>
            )}
          </div>
        </div>

        {renderTools(tools)}
      </div>
    );
  }

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
              {multiSelected ? (
                <>
                  <span className="tag-bubble-count">{selectionCount}개 선택</span>
                  <span className="tag-bubble-divider" />
                  <button type="button" onClick={clearSelection}>취소</button>
                  <button type="button" className="danger" onClick={() => bubbleAction("delete")} aria-label={`${selectionCount}개 삭제`}><Icon name="trash" /></button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => bubbleAction("down")} aria-label="가중치 −0.1">−0.1</button>
                  <button type="button" onClick={() => bubbleAction("up")} aria-label="가중치 +0.1">+0.1</button>
                  <span className="tag-bubble-divider" />
                  <button type="button" disabled={selected === 0} onClick={() => bubbleAction("left")} aria-label="왼쪽으로 이동"><Icon name="left" /></button>
                  <button type="button" disabled={selected >= tags.length - 1} onClick={() => bubbleAction("right")} aria-label="오른쪽으로 이동"><Icon name="right" /></button>
                  <span className="tag-bubble-divider" />
                  <button type="button" onClick={() => bubbleAction("edit")}>수정</button>
                  <button type="button" className="danger" onClick={() => bubbleAction("delete")} aria-label="삭제"><Icon name="trash" /></button>
                </>
              )}
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
