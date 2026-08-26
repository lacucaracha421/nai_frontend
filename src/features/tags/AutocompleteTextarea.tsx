import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchLocalTags, type LocalTag, type TagCategory } from "./localTagIndex";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { usePromptHistoryStore, type PromptSnapshot } from "../../stores/promptHistoryStore";
import { useTranslationStore } from "../../stores/translationStore";
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

type SelectionRange = { start: number; end: number };

function splitPrompt(value: string) {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function serializeItems(items: string[]) {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
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

function popupPositionForInput(input: HTMLInputElement): PopupPosition {
  const rect = input.getBoundingClientRect();
  const hostRect = input.closest(".prompt-token-editor")?.getBoundingClientRect() ?? rect;
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  const width = Math.min(
    Math.max(280, hostRect.width * 0.72),
    520,
    Math.max(220, viewportWidth - 16),
  );
  const left = Math.min(
    Math.max(rect.left, viewportLeft + 8),
    Math.max(viewportLeft + 8, viewportRight - width - 8),
  );
  const below = viewportBottom - rect.bottom - 10;
  const above = rect.top - viewportTop - 10;
  const preferAbove = below < 150 && above > below;

  if (preferAbove) {
    const maxHeight = Math.max(96, Math.min(280, above - 8));
    return {
      left,
      top: Math.max(viewportTop + 8, rect.top - maxHeight - 6),
      width,
      maxHeight,
    };
  }

  return {
    left,
    top: rect.bottom + 6,
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
  const initial = splitPrompt(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const removeArmTimerRef = useRef<number | null>(null);
  const lastTextEditAtRef = useRef(0);
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 });
  const activeIndexRef = useRef(initial.length);
  const itemsRef = useRef<string[]>([...initial, ""]);
  const [items, setItems] = useState<string[]>(() => [...initial, ""]);
  const [activeIndex, setActiveIndexState] = useState(initial.length);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<LocalTag[]>([]);
  const [popup, setPopup] = useState<PopupPosition | null>(null);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 });
  const [translationError, setTranslationError] = useState<string | null>(null);
  const favorites = useTagStore((state) => state.favorites);
  const toggle = useTagStore((state) => state.toggleFavorite);
  const characterEntries = useCharacterLibraryStore((state) => state.entries);
  const toggleCharacter = useCharacterLibraryStore((state) => state.toggleTag);
  const checkpoint = usePromptHistoryStore((state) => state.checkpoint);
  const clearHistoryFuture = usePromptHistoryStore((state) => state.clearFuture);
  const undoHistory = usePromptHistoryStore((state) => state.undo);
  const redoHistory = usePromptHistoryStore((state) => state.redo);
  const canUndo = usePromptHistoryStore((state) => !!historyKey && (state.histories[historyKey]?.past.length ?? 0) > 0);
  const canRedo = usePromptHistoryStore((state) => !!historyKey && (state.histories[historyKey]?.future.length ?? 0) > 0);
  const translateSelected = useTranslationStore((state) => state.translate);
  const translating = useTranslationStore((state) => state.translating);
  const activeText = items[activeIndex] ?? "";

  const setActiveIndex = (index: number) => {
    activeIndexRef.current = index;
    setActiveIndexState(index);
  };

  const setItemsSynced = (next: string[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  const syncSelection = (input: HTMLInputElement) => {
    const next = {
      start: input.selectionStart ?? 0,
      end: input.selectionEnd ?? input.selectionStart ?? 0,
    };
    selectionRef.current = next;
    setSelection(next);
  };

  const clearRemovalArm = () => {
    if (removeArmTimerRef.current !== null) {
      window.clearTimeout(removeArmTimerRef.current);
      removeArmTimerRef.current = null;
    }
    setArmedIndex(null);
  };

  const armRemoval = (index: number) => {
    if (index < 0 || !items[index]?.trim()) return;
    if (removeArmTimerRef.current !== null) window.clearTimeout(removeArmTimerRef.current);
    setArmedIndex(index);
    removeArmTimerRef.current = window.setTimeout(() => {
      setArmedIndex(null);
      removeArmTimerRef.current = null;
    }, 1400);
  };

  const emitItems = (next: string[]) => {
    setItemsSynced(next);
    onChange(serializeItems(next));
  };

  const currentSnapshot = (): PromptSnapshot => {
    const input = inputRef.current;
    return {
      value: serializeItems(itemsRef.current),
      selectionStart: input?.selectionStart ?? selectionRef.current.start,
      selectionEnd: input?.selectionEnd ?? selectionRef.current.end,
      activeIndex: activeIndexRef.current,
    };
  };

  const checkpointAtomic = () => {
    if (!historyKey) return;
    checkpoint(historyKey, currentSnapshot());
    lastTextEditAtRef.current = 0;
  };

  const focusActive = (selectAll = false, range?: SelectionRange) => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      const start = range ? Math.min(range.start, end) : selectAll ? 0 : end;
      const finish = range ? Math.min(range.end, end) : end;
      input.setSelectionRange(start, finish);
      syncSelection(input);
    });
  };

  const restoreSnapshot = (snapshot: PromptSnapshot) => {
    lastTextEditAtRef.current = 0;
    const next = splitPrompt(snapshot.value);
    next.push("");
    const index = Math.max(0, Math.min(snapshot.activeIndex ?? next.length - 1, next.length - 1));
    setItemsSynced(next);
    setActiveIndex(index);
    onChange(snapshot.value);
    setFocused(true);
    setSuggestions([]);
    setPopup(null);
    clearRemovalArm();
    setTranslationError(null);
    focusActive(false, {
      start: snapshot.selectionStart,
      end: snapshot.selectionEnd,
    });
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

  const runTranslate = async () => {
    if (!historyKey || translating) return;
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    if (end <= start) return;

    const sourceIndex = activeIndexRef.current;
    const sourceText = input.value;
    const sourceValue = serializeItems(itemsRef.current);
    const selectedText = sourceText.slice(start, end);
    const leading = selectedText.match(/^\s*/)?.[0] ?? "";
    const trailing = selectedText.match(/\s*$/)?.[0] ?? "";
    const innerEnd = selectedText.length - trailing.length;
    const inner = selectedText.slice(leading.length, innerEnd);
    if (!inner.trim()) {
      setTranslationError("번역할 텍스트를 선택하시와요.");
      return;
    }

    setTranslationError(null);
    try {
      const translated = await translateSelected(inner);
      if (activeIndexRef.current !== sourceIndex || inputRef.current?.value !== sourceText) {
        setTranslationError("번역 중 프롬프트가 변경되어 결과를 적용하지 않았사와요.");
        return;
      }

      checkpoint(historyKey, {
        value: sourceValue,
        selectionStart: start,
        selectionEnd: end,
        activeIndex: sourceIndex,
      });
      lastTextEditAtRef.current = 0;

      const replacement = `${leading}${translated}${trailing}`;
      const nextText = `${sourceText.slice(0, start)}${replacement}${sourceText.slice(end)}`;
      const next = [...itemsRef.current];
      while (next.length <= sourceIndex) next.push("");
      next[sourceIndex] = nextText;
      emitItems(next);
      setActiveIndex(sourceIndex);
      setSuggestions([]);
      setPopup(null);
      clearRemovalArm();
      focusActive(false, { start, end: start + replacement.length });
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : String(error));
    }
  };

  const ensureEndSlot = () => {
    let next = [...itemsRef.current];
    let index = next.length - 1;
    if (index < 0 || next[index].trim()) {
      next.push("");
      index = next.length - 1;
      setItemsSynced(next);
    }
    setActiveIndex(index);
    setFocused(true);
    clearRemovalArm();
    setSuggestions([]);
    focusActive();
  };

  const activateChip = (index: number) => {
    if (!itemsRef.current[index]?.trim()) return;
    setActiveIndex(index);
    setFocused(true);
    clearRemovalArm();
    setSuggestions([]);
    setTranslationError(null);
    focusActive();
  };

  const previousNonEmpty = (before: number) => {
    for (let index = Math.min(before - 1, itemsRef.current.length - 1); index >= 0; index -= 1) {
      if (itemsRef.current[index]?.trim()) return index;
    }
    return -1;
  };

  const nextNonEmpty = (after: number) => {
    for (let index = Math.max(0, after + 1); index < itemsRef.current.length; index += 1) {
      if (itemsRef.current[index]?.trim()) return index;
    }
    return -1;
  };

  const deleteItem = (index: number) => {
    if (index < 0 || index >= itemsRef.current.length) return;
    checkpointAtomic();
    const next = [...itemsRef.current];
    next.splice(index, 1);
    let nextActive = activeIndexRef.current;
    if (index < nextActive) nextActive -= 1;
    if (next.length === 0) {
      next.push("");
      nextActive = 0;
    } else if (nextActive >= next.length) {
      next.push("");
      nextActive = next.length - 1;
    }
    emitItems(next);
    setActiveIndex(Math.max(0, nextActive));
    clearRemovalArm();
    setSuggestions([]);
    focusActive();
  };

  const commitAndAdvance = () => {
    const next = [...itemsRef.current];
    const current = (next[activeIndexRef.current] ?? "").trim();
    if (!current) {
      clearRemovalArm();
      return;
    }
    next[activeIndexRef.current] = current;
    const nextIndex = activeIndexRef.current + 1;
    if (nextIndex >= next.length || next[nextIndex].trim()) next.splice(nextIndex, 0, "");
    emitItems(next);
    setActiveIndex(nextIndex);
    clearRemovalArm();
    setSuggestions([]);
    focusActive();
  };

  const updateActiveText = (
    nextText: string,
    nextSelection: SelectionRange,
    inputType: string,
  ) => {
    clearRemovalArm();
    if (historyKey) {
      const mergeable = [
        "insertText",
        "insertCompositionText",
        "deleteContentBackward",
        "deleteContentForward",
      ].includes(inputType);
      const now = Date.now();
      if (!mergeable || now - lastTextEditAtRef.current > 700) {
        checkpoint(historyKey, currentSnapshot());
      } else {
        clearHistoryFuture(historyKey);
      }
      lastTextEditAtRef.current = mergeable ? now : 0;
    }

    if (!/[,\n]/.test(nextText)) {
      const next = [...itemsRef.current];
      while (next.length <= activeIndexRef.current) next.push("");
      next[activeIndexRef.current] = nextText;
      emitItems(next);
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
      return;
    }

    const pieces = nextText.split(/[,\n]/);
    const tail = pieces.pop() ?? "";
    const committed = pieces.map((piece) => piece.trim()).filter(Boolean);
    const next = [...itemsRef.current];
    next.splice(activeIndexRef.current, 1, ...committed, tail);
    const nextIndex = activeIndexRef.current + committed.length;
    emitItems(next);
    setActiveIndex(nextIndex);
    setSuggestions([]);
    focusActive();
  };

  useEffect(() => {
    const external = splitPrompt(value).join(", ");
    const local = serializeItems(itemsRef.current);
    if (external === local) return;
    const next = splitPrompt(value);
    next.push("");
    setItemsSynced(next);
    setActiveIndex(Math.min(activeIndexRef.current, next.length - 1));
    setSuggestions([]);
    setArmedIndex(null);
  }, [value]);

  useEffect(() => {
    lastTextEditAtRef.current = 0;
    selectionRef.current = { start: 0, end: 0 };
    setSelection({ start: 0, end: 0 });
    setTranslationError(null);
  }, [historyKey]);

  useEffect(() => {
    if (!autoFocus) return;
    setFocused(true);
    focusActive();
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (removeArmTimerRef.current !== null) window.clearTimeout(removeArmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!focused) {
      setSuggestions([]);
      setPopup(null);
      return;
    }

    const query = autocompleteQuery(activeText, tagPrefix);
    if (query.length < 2) {
      setSuggestions([]);
      setPopup(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchLocalTags(query, categories, 12).then((next) => {
        if (cancelled) return;
        setSuggestions(next.slice(0, 8));
      });
    }, 110);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeText, categories, focused, tagPrefix]);

  useEffect(() => {
    if (!focused || !suggestions.length || !inputRef.current) {
      setPopup(null);
      return;
    }

    const input = inputRef.current;
    const update = () => setPopup(popupPositionForInput(input));
    update();
    const viewport = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [suggestions.length, focused, activeIndex]);

  const choose = (tag: LocalTag) => {
    checkpointAtomic();
    const inserted = `${tagPrefix ?? ""}${tag.display}`;
    const next = [...itemsRef.current];
    while (next.length <= activeIndexRef.current) next.push("");
    next[activeIndexRef.current] = inserted;
    const nextIndex = activeIndexRef.current + 1;
    if (nextIndex >= next.length || next[nextIndex].trim()) next.splice(nextIndex, 0, "");
    emitItems(next);
    setActiveIndex(nextIndex);
    setSuggestions([]);
    setPopup(null);
    clearRemovalArm();
    onSelectTag?.(tag);
    focusActive();
  };

  const suggestionList = suggestions.length > 0 && popup && focused ? (
    <div
      className="suggestion-list caret-suggestion-list"
      style={{ left: popup.left, top: popup.top, width: popup.width, maxHeight: popup.maxHeight }}
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

  const minHeight = Math.max(118, rows * 23 + 22);
  const hasSelection = selection.end > selection.start;

  return (
    <div className="autocomplete-wrap prompt-block-editor">
      {historyKey && (
        <div className="prompt-history-controls" aria-label="Prompt history and translation">
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
          <button
            type="button"
            className="prompt-translate-button"
            disabled={translating || !hasSelection}
            title={!hasSelection ? "활성 태그에서 번역할 텍스트를 선택하시와요." : "선택 영역을 한국어에서 영어로 번역"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void runTranslate()}
          >{translating ? "번역 중…" : "번역"}</button>
        </div>
      )}
      {translationError && <div className="prompt-translation-error">{translationError}</div>}
      <div
        className={`prompt-token-editor ${focused ? "focused" : ""}`}
        style={{ minHeight }}
        role="group"
        aria-label="Prompt editor"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          ensureEndSlot();
        }}
      >
        {items.map((item, index) => {
          const text = item.trim();
          const isActive = focused && index === activeIndex;
          if (isActive) {
            const tokenOrder = items.slice(0, index).filter((candidate) => candidate.trim()).length;
            return (
              <input
                key={`active-${index}`}
                ref={inputRef}
                className="prompt-token-input"
                value={item}
                placeholder={items.every((candidate) => !candidate.trim()) ? placeholder : undefined}
                autoComplete="off"
                spellCheck={false}
                data-prompt-token-order={tokenOrder}
                style={{ width: `${Math.max(7, Math.min(34, item.length + 2))}ch` }}
                onFocus={(event) => {
                  setFocused(true);
                  syncSelection(event.currentTarget);
                }}
                onBlur={() => {
                  setFocused(false);
                  setSuggestions([]);
                  setPopup(null);
                  clearRemovalArm();
                }}
                onSelect={(event) => syncSelection(event.currentTarget)}
                onClick={(event) => syncSelection(event.currentTarget)}
                onKeyUp={(event) => syncSelection(event.currentTarget)}
                onChange={(event) => {
                  const nextSelection = {
                    start: event.currentTarget.selectionStart ?? 0,
                    end: event.currentTarget.selectionEnd ?? event.currentTarget.selectionStart ?? 0,
                  };
                  const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
                  updateActiveText(event.target.value, nextSelection, inputType);
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
                  if (event.key === "," || event.key === "Enter") {
                    event.preventDefault();
                    commitAndAdvance();
                    return;
                  }
                  if (event.key === "Escape") {
                    setSuggestions([]);
                    clearRemovalArm();
                    return;
                  }
                  if (event.key === "Backspace") {
                    const start = event.currentTarget.selectionStart ?? 0;
                    const end = event.currentTarget.selectionEnd ?? 0;
                    if (start !== end || start > 0) {
                      clearRemovalArm();
                      return;
                    }
                    const previous = previousNonEmpty(activeIndexRef.current);
                    if (previous < 0) return;
                    event.preventDefault();
                    if (armedIndex === previous) deleteItem(previous);
                    else armRemoval(previous);
                    return;
                  }
                  if (event.key === "Delete") {
                    const start = event.currentTarget.selectionStart ?? 0;
                    const end = event.currentTarget.selectionEnd ?? 0;
                    if (start !== end || end < event.currentTarget.value.length) {
                      clearRemovalArm();
                      return;
                    }
                    const next = nextNonEmpty(activeIndexRef.current);
                    if (next < 0) return;
                    event.preventDefault();
                    if (armedIndex === next) deleteItem(next);
                    else armRemoval(next);
                    return;
                  }
                  clearRemovalArm();
                }}
              />
            );
          }

          if (!text) return null;
          const armed = armedIndex === index;
          return (
            <span className={`prompt-token-chip ${armed ? "armed" : ""}`} key={`${index}-${text}`}>
              <button
                type="button"
                className="prompt-token-chip-main"
                title="눌러서 이 태그 편집"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => activateChip(index)}
              >
                {text}
              </button>
              <button
                type="button"
                className="prompt-token-chip-remove"
                aria-label={`${text} 삭제`}
                title={armed ? "한 번 더 누르면 삭제" : "삭제 준비"}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (armed) deleteItem(index);
                  else armRemoval(index);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        {!focused && !items.some((item) => item.trim()) && (
          <span className="prompt-token-placeholder">{placeholder}</span>
        )}
      </div>
      {suggestionList && createPortal(suggestionList, document.body)}
    </div>
  );
}
