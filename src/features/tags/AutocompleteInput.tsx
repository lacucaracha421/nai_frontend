import { useEffect, useState } from "react";
import { searchLocalTags, type LocalTag, type TagCategory } from "./localTagIndex";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onPick: (tag: LocalTag) => void;
  categories?: TagCategory[];
  placeholder?: string;
};

export function AutocompleteInput({ value, onChange, onPick, categories, placeholder }: Props) {
  const [list, setList] = useState<LocalTag[]>([]);
  const favorites = useTagStore((state) => state.favorites);
  const toggle = useTagStore((state) => state.toggleFavorite);
  const characterEntries = useCharacterLibraryStore((state) => state.entries);
  const toggleCharacter = useCharacterLibraryStore((state) => state.toggleTag);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setList([]);
      return;
    }

    let cancelled = false;
    const id = window.setTimeout(() => {
      void searchLocalTags(query, categories, 12).then((next) => {
        if (!cancelled) setList(next.slice(0, 8));
      });
    }, 110);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [value, categories]);

  return (
    <div className="autocomplete-wrap">
      <input
        className="tag-search-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {list.length > 0 && (
        <div className="suggestion-list single-line">
          {list.map((tag) => {
            const isCharacter = tag.category === "character";
            const saved = isCharacter
              ? characterEntries.some((entry) => entry.raw === tag.raw)
              : favorites.includes(tag.raw);
            return (
              <div className="suggestion-row" key={tag.raw}>
                <button className="suggestion-main" onClick={() => { onPick(tag); setList([]); }}>
                  <span className={`tag-dot ${tag.category}`} />
                  <span>{tag.display}</span>
                </button>
                <button
                  className={`favorite-button ${saved ? "active" : ""}`}
                  title={isCharacter ? "캐릭터 도감에 저장" : "즐겨찾기"}
                  onClick={() => isCharacter ? toggleCharacter(tag) : toggle(tag.raw)}
                >
                  ★
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
