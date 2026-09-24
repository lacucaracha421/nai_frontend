import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchLocalTags, type LocalTag, type TagCategory } from "./localTagIndex";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { usePromptHistoryStore, type PromptSnapshot } from "../../stores/promptHistoryStore";
import { useTranslationStore } from "../../stores/translationStore";
import {
  createPromptToken,
  insertionForSuggestion,
  movePromptToken,
  promptTokenDomKey,
  reconcilePromptTokens,
  selectionOrWhole,
  serializePromptTokens,
  tokensFromPrompt,
  type PromptToken,
} from "./promptEditorModel";
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

function stripArtistPrefix(query: string) {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("artist\\:")) return trimmed.slice("artist\\:".length).trimStart();
  if (lower.startsWith("artist:")) return trimmed.slice("artist:".length).trimStart();
  return trimmed;
}

export function autocompleteQuery(query: string, tagPrefix?: string) {
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
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const removeArmTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const lastTextEditAtRef = useRef(0);
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 });
  const [items, setItems] = useState<PromptToken[]>(() => [
    ...tokensFromPrompt(value),
    createPromptToken(),
  ]);
  const itemsRef = useRef<PromptToken[]>(items);
  const activeIndexRef = useRef(items.length - 1);
  const [activeIndex, setActiveIndexState] = useState(items.length - 1);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<LocalTag[]>([]);
  const [popup, setPopup] = useState<PopupPosition | null>(null);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 });
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [inputWidth, setInputWidth] = useState(78);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const pressRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    target: HTMLButtonElement;
  } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const suppressChipClickRef = useRef(false);
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
  const activeText = items[activeIndex]?.text ?? "";

  const setActiveIndex = (index: number) => {
    activeIndexRef.current = index;
    setActiveIndexState(index);
  };

  const setItemsSynced = (next: PromptToken[]) => {
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
    if (index < 0 || !items[index]?.text.trim()) return;
    if (removeArmTimerRef.current !== null) window.clearTimeout(removeArmTimerRef.current);
    setArmedIndex(index);
    removeArmTimerRef.current = window.setTimeout(() => {
      setArmedIndex(null);
      removeArmTimerRef.current = null;
    }, 1400);
  };

  const emitItems = (next: PromptToken[]) => {
    setItemsSynced(next);
    onChange(serializePromptTokens(next));
  };

  const currentSnapshot = (): PromptSnapshot => {
    const input = inputRef.current;
    return {
      value: serializePromptTokens(itemsRef.current),
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
    const next = [...tokensFromPrompt(snapshot.value), createPromptToken()];
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
    const rawStart = input.selectionStart ?? 0;
    const rawEnd = input.selectionEnd ?? rawStart;
    const sourceIndex = activeIndexRef.current;
    const sourceText = input.value;
    const { start, end } = selectionOrWhole(rawStart, rawEnd, sourceText.length);
    if (end <= start) {
      setTranslationError("번역할 블록을 선택하시와요.");
      return;
    }
    const sourceValue = serializePromptTokens(itemsRef.current);
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
      while (next.length <= sourceIndex) next.push(createPromptToken());
      next[sourceIndex] = { ...next[sourceIndex], text: nextText };
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
    if (index < 0 || next[index].text.trim()) {
      next.push(createPromptToken());
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
    if (!itemsRef.current[index]?.text.trim()) return;
    setActiveIndex(index);
    setFocused(true);
    clearRemovalArm();
    setSuggestions([]);
    setTranslationError(null);
    focusActive();
  };

  const previousNonEmpty = (before: number) => {
    for (let index = Math.min(before - 1, itemsRef.current.length - 1); index >= 0; index -= 1) {
      if (itemsRef.current[index]?.text.trim()) return index;
    }
    return -1;
  };

  const nextNonEmpty = (after: number) => {
    for (let index = Math.max(0, after + 1); index < itemsRef.current.length; index += 1) {
      if (itemsRef.current[index]?.text.trim()) return index;
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
      next.push(createPromptToken());
      nextActive = 0;
    } else if (nextActive >= next.length) {
      next.push(createPromptToken());
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
    const currentToken = next[activeIndexRef.current];
    const current = currentToken?.text.trim() ?? "";
    if (!current || !currentToken) {
      clearRemovalArm();
      return;
    }
    next[activeIndexRef.current] = { ...currentToken, text: current };
    const nextIndex = activeIndexRef.current + 1;
    if (nextIndex >= next.length || next[nextIndex].text.trim()) {
      next.splice(nextIndex, 0, createPromptToken());
    }
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
      while (next.length <= activeIndexRef.current) next.push(createPromptToken());
      next[activeIndexRef.current] = { ...next[activeIndexRef.current], text: nextText };
      emitItems(next);
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
      return;
    }

    const pieces = nextText.split(/[,\n]/);
    const tail = pieces.pop() ?? "";
    const committed = pieces.map((piece) => piece.trim()).filter(Boolean);
    const next = [...itemsRef.current];
    const replacement = [
      ...committed.map((text) => createPromptToken(text)),
      createPromptToken(tail),
    ];
    next.splice(activeIndexRef.current, 1, ...replacement);
    const nextIndex = activeIndexRef.current + committed.length;
    emitItems(next);
    setActiveIndex(nextIndex);
    setSuggestions([]);
    focusActive();
  };

  useEffect(() => {
    const external = serializePromptTokens(tokensFromPrompt(value));
    const local = serializePromptTokens(itemsRef.current);
    if (external === local) return;
    const stable = reconcilePromptTokens(itemsRef.current, value);
    const currentBlank = itemsRef.current.find((token) => !token.text.trim());
    const next = [...stable, currentBlank ?? createPromptToken()];
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

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const measured = Math.ceil(measure.getBoundingClientRect().width) + 30;
    setInputWidth(Math.max(78, measured));
  }, [activeText, placeholder, focused]);

  useEffect(() => {
    return () => {
      if (removeArmTimerRef.current !== null) window.clearTimeout(removeArmTimerRef.current);
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
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

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const resetDrag = () => {
    draggingIdRef.current = null;
    dragOverIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const beginChipPress = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    clearLongPress();
    pressRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target: event.currentTarget,
    };
    longPressTimerRef.current = window.setTimeout(() => {
      const press = pressRef.current;
      if (!press || press.id !== id) return;
      draggingIdRef.current = id;
      dragOverIdRef.current = id;
      setDraggingId(id);
      setDragOverId(id);
      suppressChipClickRef.current = true;
      try {
        press.target.setPointerCapture(press.pointerId);
      } catch {
        // Pointer capture is best-effort on Android WebView.
      }
    }, 360);
  };

  const moveChipPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press) return;
    if (!draggingIdRef.current) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 10) {
        clearLongPress();
        pressRef.current = null;
      }
      return;
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const host = target?.closest<HTMLElement>("[data-prompt-token-id]");
    const id = host?.dataset.promptTokenId;
    if (!id || !itemsRef.current.some((token) => token.id === id)) return;
    dragOverIdRef.current = id;
    setDragOverId(id);
  };

  const finishChipPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    clearLongPress();
    const fromId = draggingIdRef.current;
    const toId = dragOverIdRef.current;
    if (fromId) {
      event.preventDefault();
      const activeId = itemsRef.current[activeIndexRef.current]?.id;
      if (toId && fromId !== toId) {
        checkpointAtomic();
        const ordered = movePromptToken(itemsRef.current, fromId, toId);
        const blank = ordered.find((token) => !token.text.trim()) ?? createPromptToken();
        const next = [...ordered.filter((token) => token.text.trim()), blank];
        emitItems(next);
        if (activeId) {
          const nextActive = next.findIndex((token) => token.id === activeId);
          if (nextActive >= 0) setActiveIndex(nextActive);
        }
      }
      if (focused) focusActive();
      try {
        if (press?.target.hasPointerCapture(event.pointerId)) {
          press.target.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore capture cleanup failures.
      }
    }
    pressRef.current = null;
    resetDrag();
    window.setTimeout(() => { suppressChipClickRef.current = false; }, 0);
  };

  const cancelChipPress = () => {
    clearLongPress();
    pressRef.current = null;
    suppressChipClickRef.current = false;
    resetDrag();
  };

  const choose = (tag: LocalTag) => {
    checkpointAtomic();
    const inserted = insertionForSuggestion(tag.display, tag.category, tagPrefix);
    const next = [...itemsRef.current];
    while (next.length <= activeIndexRef.current) next.push(createPromptToken());
    next[activeIndexRef.current] = { ...next[activeIndexRef.current], text: inserted };
    const nextIndex = activeIndexRef.current + 1;
    if (nextIndex >= next.length || next[nextIndex].text.trim()) {
      next.splice(nextIndex, 0, createPromptToken());
    }
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
  const hasActiveText = focused && Boolean(activeText.trim());

  return (
    <div className="autocomplete-wrap prompt-block-editor">
      <span ref={measureRef} className="prompt-token-measure" aria-hidden="true">
        {activeText || (items.every((token) => !token.text.trim()) ? placeholder : "") || " "}
      </span>
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
            disabled={translating || (!hasSelection && !hasActiveText)}
            title={hasSelection ? "선택 영역을 한국어에서 영어로 번역" : "활성 블록 전체를 한국어에서 영어로 번역"}
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
          const text = item.text.trim();
          const isActive = focused && index === activeIndex;
          if (isActive) {
            const tokenOrder = items.slice(0, index).filter((candidate) => candidate.text.trim()).length;
            return (
              <input
                key={promptTokenDomKey(item.id, true)}
                ref={inputRef}
                className="prompt-token-input"
                value={item.text}
                placeholder={items.every((candidate) => !candidate.text.trim()) ? placeholder : undefined}
                autoComplete="off"
                spellCheck={false}
                data-prompt-token-order={tokenOrder}
                data-prompt-token-id={item.id}
                style={{ width: inputWidth }}
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
            <span
              className={`prompt-token-chip ${armed ? "armed" : ""} ${draggingId === item.id ? "dragging" : ""} ${dragOverId === item.id && draggingId !== item.id ? "drag-over" : ""}`}
              key={promptTokenDomKey(item.id, false)}
              data-prompt-token-id={item.id}
            >
              <button
                type="button"
                className="prompt-token-chip-main"
                title="짧게 눌러 편집 · 길게 눌러 이동"
                onPointerDown={(event) => beginChipPress(event, item.id)}
                onPointerMove={moveChipPress}
                onPointerUp={finishChipPress}
                onPointerCancel={cancelChipPress}
                onClick={() => {
                  if (suppressChipClickRef.current) {
                    suppressChipClickRef.current = false;
                    return;
                  }
                  activateChip(index);
                }}
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
        {!focused && !items.some((item) => item.text.trim()) && (
          <span className="prompt-token-placeholder">{placeholder}</span>
        )}
      </div>
      {suggestionList && createPortal(suggestionList, document.body)}
    </div>
  );
}
