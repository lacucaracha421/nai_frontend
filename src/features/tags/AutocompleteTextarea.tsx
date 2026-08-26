import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchLocalTags, type LocalTag, type TagCategory } from "./localTagIndex";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
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
};

type PopupPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

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
}: Props) {
  const initial = splitPrompt(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const removeArmTimerRef = useRef<number | null>(null);
  const [items, setItems] = useState<string[]>(() => [...initial, ""]);
  const [activeIndex, setActiveIndex] = useState(initial.length);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<LocalTag[]>([]);
  const [popup, setPopup] = useState<PopupPosition | null>(null);
  const [focused, setFocused] = useState(false);
  const favorites = useTagStore((state) => state.favorites);
  const toggle = useTagStore((state) => state.toggleFavorite);
  const characterEntries = useCharacterLibraryStore((state) => state.entries);
  const toggleCharacter = useCharacterLibraryStore((state) => state.toggleTag);
  const activeText = items[activeIndex] ?? "";

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
    setItems(next);
    onChange(serializeItems(next));
  };

  const focusActive = (selectAll = false) => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(selectAll ? 0 : end, end);
    });
  };

  const ensureEndSlot = () => {
    let next = [...items];
    let index = next.length - 1;
    if (index < 0 || next[index].trim()) {
      next.push("");
      index = next.length - 1;
      setItems(next);
    }
    setActiveIndex(index);
    setFocused(true);
    clearRemovalArm();
    setSuggestions([]);
    focusActive();
  };

  const activateChip = (index: number) => {
    if (!items[index]?.trim()) return;
    setActiveIndex(index);
    setFocused(true);
    clearRemovalArm();
    setSuggestions([]);
    focusActive();
  };

  const previousNonEmpty = (before: number) => {
    for (let index = Math.min(before - 1, items.length - 1); index >= 0; index -= 1) {
      if (items[index]?.trim()) return index;
    }
    return -1;
  };

  const nextNonEmpty = (after: number) => {
    for (let index = Math.max(0, after + 1); index < items.length; index += 1) {
      if (items[index]?.trim()) return index;
    }
    return -1;
  };

  const deleteItem = (index: number) => {
    if (index < 0 || index >= items.length) return;
    const next = [...items];
    next.splice(index, 1);
    let nextActive = activeIndex;
    if (index < activeIndex) nextActive -= 1;
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
    const next = [...items];
    const current = (next[activeIndex] ?? "").trim();
    if (!current) {
      clearRemovalArm();
      return;
    }
    next[activeIndex] = current;
    const nextIndex = activeIndex + 1;
    if (nextIndex >= next.length || next[nextIndex].trim()) next.splice(nextIndex, 0, "");
    emitItems(next);
    setActiveIndex(nextIndex);
    clearRemovalArm();
    setSuggestions([]);
    focusActive();
  };

  const updateActiveText = (nextText: string) => {
    clearRemovalArm();

    if (!/[,\n]/.test(nextText)) {
      const next = [...items];
      while (next.length <= activeIndex) next.push("");
      next[activeIndex] = nextText;
      emitItems(next);
      return;
    }

    const pieces = nextText.split(/[,\n]/);
    const tail = pieces.pop() ?? "";
    const committed = pieces.map((piece) => piece.trim()).filter(Boolean);
    const next = [...items];
    next.splice(activeIndex, 1, ...committed, tail);
    const nextIndex = activeIndex + committed.length;
    emitItems(next);
    setActiveIndex(nextIndex);
    setSuggestions([]);
    focusActive();
  };

  useEffect(() => {
    const external = splitPrompt(value).join(", ");
    const local = serializeItems(items);
    if (external === local) return;
    const next = splitPrompt(value);
    next.push("");
    setItems(next);
    setActiveIndex((current) => Math.min(current, next.length - 1));
    setSuggestions([]);
    setArmedIndex(null);
  }, [value]);

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
    const inserted = `${tagPrefix ?? ""}${tag.display}`;
    const next = [...items];
    while (next.length <= activeIndex) next.push("");
    next[activeIndex] = inserted;
    const nextIndex = activeIndex + 1;
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

  return (
    <div className="autocomplete-wrap prompt-block-editor">
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
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  setFocused(false);
                  setSuggestions([]);
                  setPopup(null);
                  clearRemovalArm();
                }}
                onChange={(event) => updateActiveText(event.target.value)}
                onKeyDown={(event) => {
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
                    const previous = previousNonEmpty(activeIndex);
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
                    const next = nextNonEmpty(activeIndex);
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
