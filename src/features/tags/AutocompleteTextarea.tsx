import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchLocalTags, type LocalTag, type TagCategory } from "./localTagIndex";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { usePromptHistoryStore, type PromptSnapshot } from "../../stores/promptHistoryStore";
import "./promptBlocks.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  categories?: TagCategory[];
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
  onSelectTag?: (tag: LocalTag) => void;
  tagPrefix?: string;
  historyKey?: string;
};

type PopupPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

type PromptBlock = {
  index: number;
  text: string;
  start: number;
  end: number;
};

function currentTerm(value: string, caret: number) {
  const left = value.slice(0, caret);
  const start = Math.max(left.lastIndexOf(","), left.lastIndexOf("\n")) + 1;
  return { start, query: left.slice(start).trimStart() };
}

function stripArtistPrefix(query: string) {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("artist\\:")) return trimmed.slice("artist\\:".length).trimStart();
  if (lower.startsWith("artist:")) return trimmed.slice("artist:".length).trimStart();
  return trimmed;
}

function autocompleteQuery(query: string, tagPrefix?: string) {
  if (tagPrefix?.toLowerCase() === "artist:") return stripArtistPrefix(query);
  return query.trim();
}

function normalizedTag(value: string) {
  return stripArtistPrefix(value)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function promptBlocks(value: string): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  let segmentStart = 0;

  for (let cursor = 0; cursor <= value.length; cursor += 1) {
    const atEnd = cursor === value.length;
    const separator = !atEnd && (value[cursor] === "," || value[cursor] === "\n");
    if (!atEnd && !separator) continue;

    const segment = value.slice(segmentStart, cursor);
    const leading = segment.match(/^\s*/)?.[0].length ?? 0;
    const trailing = segment.match(/\s*$/)?.[0].length ?? 0;
    const start = segmentStart + leading;
    const end = cursor - trailing;
    if (end > start) {
      blocks.push({ index: blocks.length, text: value.slice(start, end), start, end });
    }
    segmentStart = cursor + 1;
  }

  return blocks;
}

function blockIndexAtCaret(blocks: PromptBlock[], value: string, caret: number) {
  const direct = blocks.find((block) => caret >= block.start && caret <= block.end);
  if (direct) return direct.index;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.end > caret) continue;
    if (/^[,\s]*$/.test(value.slice(block.end, caret))) return block.index;
    break;
  }

  return -1;
}

const mirrorProperties = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "textTransform",
  "textAlign",
  "textIndent",
  "lineHeight",
  "wordSpacing",
  "tabSize",
] as const;

function caretPopupPosition(textarea: HTMLTextAreaElement, caret: number): PopupPosition {
  const rect = textarea.getBoundingClientRect();
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");

  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.zIndex = "-1";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.left = `${rect.left - textarea.scrollLeft}px`;
  mirror.style.top = `${rect.top - textarea.scrollTop}px`;

  for (const property of mirrorProperties) {
    mirror.style[property] = computed[property];
  }

  mirror.textContent = textarea.value.slice(0, caret);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  mirror.remove();

  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  const width = Math.min(
    Math.max(300, rect.width * 0.72),
    520,
    Math.max(220, viewportWidth - 16),
  );

  const left = Math.min(
    Math.max(markerRect.left, viewportLeft + 8),
    Math.max(viewportLeft + 8, viewportRight - width - 8),
  );

  const below = viewportBottom - markerRect.bottom - 10;
  const above = markerRect.top - viewportTop - 10;
  const preferAbove = below < 150 && above > below;

  if (preferAbove) {
    const maxHeight = Math.max(96, Math.min(280, above - 8));
    return {
      left,
      top: Math.max(viewportTop + 8, markerRect.top - maxHeight - 6),
      width,
      maxHeight,
    };
  }

  return {
    left,
    top: markerRect.bottom + 6,
    width,
    maxHeight: Math.max(96, Math.min(280, below)),
  };
}

export function AutocompleteTextarea({
  value,
  onChange,
  categories,
  placeholder,
  autoFocus,
  rows = 12,
  onSelectTag,
  tagPrefix,
  historyKey,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const longPressRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const lastTextEditAtRef = useRef(0);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [suggestions, setSuggestions] = useState<LocalTag[]>([]);
  const [caret, setCaret] = useState(0);
  const [popup, setPopup] = useState<PopupPosition | null>(null);
  const [focused, setFocused] = useState(false);
  const [unlockedIndex, setUnlockedIndex] = useState<number | null>(null);
  const favorites = useTagStore((s) => s.favorites);
  const toggle = useTagStore((s) => s.toggleFavorite);
  const characterEntries = useCharacterLibraryStore((s) => s.entries);
  const toggleCharacter = useCharacterLibraryStore((s) => s.toggleTag);
  const blocks = useMemo(() => promptBlocks(value), [value]);
  const checkpoint = usePromptHistoryStore((s) => s.checkpoint);
  const clearHistoryFuture = usePromptHistoryStore((s) => s.clearFuture);
  const undoHistory = usePromptHistoryStore((s) => s.undo);
  const redoHistory = usePromptHistoryStore((s) => s.redo);
  const canUndo = usePromptHistoryStore((s) => !!historyKey && (s.histories[historyKey]?.past.length ?? 0) > 0);
  const canRedo = usePromptHistoryStore((s) => !!historyKey && (s.histories[historyKey]?.future.length ?? 0) > 0);

  useEffect(() => {
    lastTextEditAtRef.current = 0;
    selectionRef.current = { start: 0, end: 0 };
  }, [historyKey]);

  useEffect(() => {
    if (!focused) {
      setSuggestions([]);
      setPopup(null);
      return;
    }

    const term = currentTerm(value, caret);
    const query = autocompleteQuery(term.query, tagPrefix);
    let cancelled = false;
    const commit = (next: LocalTag[]) => {
      if (cancelled) return;
      const queryKey = normalizedTag(query);
      const hasExactMatch = next.some((tag) => {
        return normalizedTag(tag.display) === queryKey || normalizedTag(tag.raw) === queryKey;
      });
      setSuggestions(hasExactMatch ? [] : next);
    };

    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const id = window.setTimeout(() => {
      searchLocalTags(query, categories, 24).then(commit);
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [value, caret, categories, tagPrefix, focused]);

  useEffect(() => {
    if (!focused || !suggestions.length || !ref.current) {
      setPopup(null);
      return;
    }

    const textarea = ref.current;
    const update = () => setPopup(caretPopupPosition(textarea, textarea.selectionStart ?? caret));
    update();

    const viewport = window.visualViewport;
    textarea.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);

    return () => {
      textarea.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [suggestions.length, caret, value, focused]);

  const currentSnapshot = (): PromptSnapshot => {
    const element = ref.current;
    return {
      value,
      selectionStart: element?.selectionStart ?? selectionRef.current.start,
      selectionEnd: element?.selectionEnd ?? selectionRef.current.end,
    };
  };

  const restoreSnapshot = (snapshot: PromptSnapshot) => {
    lastTextEditAtRef.current = 0;
    onChange(snapshot.value);
    setSuggestions([]);
    setPopup(null);
    setUnlockedIndex(null);
    requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      const start = Math.min(snapshot.selectionStart, snapshot.value.length);
      const end = Math.min(snapshot.selectionEnd, snapshot.value.length);
      element.focus();
      element.setSelectionRange(start, end);
      selectionRef.current = { start, end };
      setCaret(start);
      setFocused(true);
    });
  };

  const commitAtomicHistory = () => {
    if (!historyKey) return;
    checkpoint(historyKey, currentSnapshot());
    lastTextEditAtRef.current = 0;
  };

  const runUndo = () => {
    if (!historyKey) return;
    const target = undoHistory(historyKey, currentSnapshot());
    if (target) restoreSnapshot(target);
  };

  const runRedo = () => {
    if (!historyKey) return;
    const target = redoHistory(historyKey, currentSnapshot());
    if (target) restoreSnapshot(target);
  };

  const syncCaret = (element: HTMLTextAreaElement) => {
    const next = element.selectionStart ?? 0;
    selectionRef.current = { start: next, end: element.selectionEnd ?? next };
    setCaret(next);
    const nextBlock = blockIndexAtCaret(promptBlocks(element.value), element.value, next);
    if (unlockedIndex !== null && nextBlock !== unlockedIndex) setUnlockedIndex(null);
    if (focused && suggestions.length) setPopup(caretPopupPosition(element, next));
  };

  const focusBlock = (block: PromptBlock, unlock: boolean) => {
    setSuggestions([]);
    setPopup(null);
    setUnlockedIndex(unlock ? block.index : null);
    requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(block.end, block.end);
      selectionRef.current = { start: block.end, end: block.end };
      setCaret(block.end);
      setFocused(true);
    });
  };

  const removeBlock = (index: number) => {
    const nextValue = blocks
      .filter((block) => block.index !== index)
      .map((block) => block.text)
      .join(", ");
    const previousStart = blocks[index]?.start ?? nextValue.length;
    commitAtomicHistory();
    onChange(nextValue);
    setUnlockedIndex(null);
    setSuggestions([]);
    setPopup(null);
    requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      const nextCaret = Math.min(previousStart, nextValue.length);
      element.focus();
      element.setSelectionRange(nextCaret, nextCaret);
      selectionRef.current = { start: nextCaret, end: nextCaret };
      setCaret(nextCaret);
      setFocused(true);
    });
  };

  const choose = (tag: LocalTag) => {
    const element = ref.current;
    const position = element?.selectionStart ?? caret;
    const term = currentTerm(value, position);
    const before = value.slice(0, term.start);
    const after = value.slice(position);
    const prefix = before.endsWith(",") ? `${before} ` : before && !/[\s,]$/.test(before) ? `${before}, ` : before;
    const inserted = `${tagPrefix ?? ""}${tag.display}`;
    const suffix = after.startsWith(",") ? "" : ", ";
    const next = `${prefix}${inserted}${suffix}${after}`;
    commitAtomicHistory();
    onChange(next);
    setSuggestions([]);
    setPopup(null);
    setUnlockedIndex(null);
    onSelectTag?.(tag);

    requestAnimationFrame(() => {
      if (!element) return;
      const nextCaret = (prefix + inserted + suffix).length;
      element.focus();
      element.setSelectionRange(nextCaret, nextCaret);
      selectionRef.current = { start: nextCaret, end: nextCaret };
      setCaret(nextCaret);
    });
  };

  const startBlockPress = (block: PromptBlock) => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressTriggeredRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      focusBlock(block, true);
      longPressRef.current = null;
    }, 430);
  };

  const endBlockPress = (block: PromptBlock) => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    if (!longPressTriggeredRef.current) focusBlock(block, false);
    longPressTriggeredRef.current = false;
  };

  const suggestionList = suggestions.length > 0 && popup && focused ? (
    <div
      className="suggestion-list caret-suggestion-list"
      style={{
        left: popup.left,
        top: popup.top,
        width: popup.width,
        maxHeight: popup.maxHeight,
      }}
    >
      {suggestions.map((tag) => {
        const isCharacter = tag.category === "character";
        const saved = isCharacter
          ? characterEntries.some((entry) => entry.raw === tag.raw)
          : favorites.includes(tag.raw);
        return (
          <div className="suggestion-row" key={tag.raw}>
            <button
              className="suggestion-main"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(tag)}
            >
              <span className={`tag-dot ${tag.category}`} />
              <span>{tag.display}</span>
            </button>
            <button
              className={`favorite-button ${saved ? "active" : ""}`}
              title={isCharacter ? "캐릭터 도감에 저장" : "즐겨찾기"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => isCharacter ? toggleCharacter(tag) : toggle(tag.raw)}
            >
              ★
            </button>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="autocomplete-wrap prompt-block-editor">
      {historyKey && (
        <div className="prompt-history-controls" aria-label="Prompt history">
          <button
            type="button"
            disabled={!canUndo}
            title="되돌리기 (Ctrl+Z)"
            aria-label="되돌리기"
            onPointerDown={(event) => event.preventDefault()}
            onClick={runUndo}
          >↶</button>
          <button
            type="button"
            disabled={!canRedo}
            title="다시 실행 (Ctrl+Shift+Z / Ctrl+Y)"
            aria-label="다시 실행"
            onPointerDown={(event) => event.preventDefault()}
            onClick={runRedo}
          >↷</button>
        </div>
      )}
      {blocks.length > 0 && (
        <div className="prompt-block-list" aria-label="Prompt blocks">
          {blocks.map((block) => (
            <div
              className={`prompt-block ${unlockedIndex === block.index ? "unlocked" : ""}`}
              key={`${block.start}-${block.text}`}
            >
              <button
                type="button"
                className="prompt-block-main"
                onPointerDown={() => startBlockPress(block)}
                onPointerUp={() => endBlockPress(block)}
                onPointerCancel={() => {
                  if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
                  longPressRef.current = null;
                  longPressTriggeredRef.current = false;
                }}
                title="길게 눌러 글자 단위 편집"
              >
                {block.text}
              </button>
              <button
                type="button"
                className="prompt-block-remove"
                aria-label={`${block.text} 블록 삭제`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  removeBlock(block.index);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="prompt-textarea"
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={(event) => {
          setFocused(true);
          syncCaret(event.currentTarget);
        }}
        onBlur={() => {
          setFocused(false);
          setSuggestions([]);
          setPopup(null);
          setUnlockedIndex(null);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextCaret = event.target.selectionStart ?? 0;
          const nextEnd = event.target.selectionEnd ?? nextCaret;
          const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
          const mergeableTextEdit = [
            "insertText",
            "insertCompositionText",
            "deleteContentBackward",
            "deleteContentForward",
          ].includes(inputType);
          if (historyKey) {
            const now = Date.now();
            const previous: PromptSnapshot = {
              value,
              selectionStart: selectionRef.current.start,
              selectionEnd: selectionRef.current.end,
            };
            if (!mergeableTextEdit || now - lastTextEditAtRef.current > 700) {
              checkpoint(historyKey, previous);
            } else {
              clearHistoryFuture(historyKey);
            }
            lastTextEditAtRef.current = mergeableTextEdit ? now : 0;
          }
          const nextBlocks = promptBlocks(nextValue);
          const nextBlock = blockIndexAtCaret(nextBlocks, nextValue, nextCaret);
          const insertedSeparator = /[,\n]/.test(nextValue.slice(Math.max(0, nextCaret - 1), nextCaret));
          if (nextValue.length > value.length && nextBlock >= 0 && !insertedSeparator) {
            setUnlockedIndex(nextBlock);
          } else if (unlockedIndex !== null) {
            setUnlockedIndex(nextBlock >= 0 ? nextBlock : null);
          }
          onChange(nextValue);
          selectionRef.current = { start: nextCaret, end: nextEnd };
          setCaret(nextCaret);
        }}
        onKeyDown={(event) => {
          const modifier = event.ctrlKey || event.metaKey;
          const key = event.key.toLowerCase();
          if (historyKey && modifier && key === "z") {
            event.preventDefault();
            if (event.shiftKey) runRedo();
            else runUndo();
            return;
          }
          if (historyKey && modifier && key === "y") {
            event.preventDefault();
            runRedo();
            return;
          }
          if (event.key !== "Backspace") return;
          if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return;
          const position = event.currentTarget.selectionStart ?? 0;
          const blockIndex = blockIndexAtCaret(blocks, value, position);
          if (blockIndex < 0 || blockIndex === unlockedIndex) return;
          event.preventDefault();
          removeBlock(blockIndex);
        }}
        onClick={(event) => syncCaret(event.currentTarget)}
        onKeyUp={(event) => syncCaret(event.currentTarget)}
        onSelect={(event) => syncCaret(event.currentTarget)}
      />
      {suggestionList && createPortal(suggestionList, document.body)}
    </div>
  );
}
