import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { favoriteLocalTags, searchLocalTags, type LocalTag, type TagCategory } from "./localTagIndex";
import { useTagStore } from "../../stores/tagStore";

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
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<LocalTag[]>([]);
  const [caret, setCaret] = useState(0);
  const [popup, setPopup] = useState<PopupPosition | null>(null);
  const favorites = useTagStore((s) => s.favorites);
  const toggle = useTagStore((s) => s.toggleFavorite);

  useEffect(() => {
    const term = currentTerm(value, caret);
    const query = autocompleteQuery(term.query, tagPrefix);
    let cancelled = false;
    const commit = (next: LocalTag[]) => {
      if (!cancelled) setSuggestions(next);
    };
    const id = setTimeout(() => {
      if (query.length < 2) {
        favoriteLocalTags(favorites, categories).then(commit);
        return;
      }
      searchLocalTags(query, categories).then(commit);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [value, caret, categories, favorites, tagPrefix]);

  useEffect(() => {
    if (!suggestions.length || !ref.current) {
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
  }, [suggestions.length, caret, value]);

  const syncCaret = (element: HTMLTextAreaElement) => {
    const next = element.selectionStart ?? 0;
    setCaret(next);
    if (suggestions.length) setPopup(caretPopupPosition(element, next));
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
    onChange(next);
    setSuggestions([]);
    setPopup(null);
    onSelectTag?.(tag);

    requestAnimationFrame(() => {
      if (!element) return;
      const nextCaret = (prefix + inserted + suffix).length;
      element.focus();
      element.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const suggestionList = suggestions.length > 0 && popup ? (
    <div
      className="suggestion-list caret-suggestion-list"
      style={{
        left: popup.left,
        top: popup.top,
        width: popup.width,
        maxHeight: popup.maxHeight,
      }}
    >
      {suggestions.map((tag) => (
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
            className={`favorite-button ${favorites.includes(tag.raw) ? "active" : ""}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => toggle(tag.raw)}
          >
            ★
          </button>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="autocomplete-wrap">
      <textarea
        ref={ref}
        className="prompt-textarea"
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          syncCaret(event.target);
        }}
        onClick={(event) => syncCaret(event.currentTarget)}
        onKeyUp={(event) => syncCaret(event.currentTarget)}
        onSelect={(event) => syncCaret(event.currentTarget)}
      />
      {suggestionList && createPortal(suggestionList, document.body)}
    </div>
  );
}
