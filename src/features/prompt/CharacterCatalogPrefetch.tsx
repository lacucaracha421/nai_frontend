import { useEffect } from "react";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { characterKey } from "./characterCatalog";
import { loadCharacterCatalog } from "./characterCatalogClient";
import { prefetchThumbnails } from "./characterThumbnails";

/** Starts bookmark caching without requiring the finder to stay open. */
export function CharacterCatalogPrefetch() {
  const entries = useCharacterLibraryStore(state => state.entries);
  useEffect(() => {
    if (!entries.length) return;
    let cancelled = false;
    void loadCharacterCatalog().then(rows => {
      if (cancelled) return;
      const saved = new Set(entries.map(entry => characterKey(entry.raw)));
      prefetchThumbnails(rows.filter(row => !row.isNew && saved.has(characterKey(row.raw))).map(row => row.raw));
    }).catch(() => { /* The finder provides the catalog retry control. */ });
    return () => { cancelled = true; };
  }, [entries]);
  return null;
}
