import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LocalTag } from "../features/tags/localTagIndex";

export type CharacterLibraryEntry = {
  raw: string;
  display: string;
  series: string;
  addedAt: number;
};

type State = {
  entries: CharacterLibraryEntry[];
  legacyFavoritesMigrated: boolean;
  addTag: (tag: Pick<LocalTag, "raw" | "display">, series?: string) => void;
  addMany: (tags: Array<Pick<LocalTag, "raw" | "display">>) => void;
  toggleTag: (tag: Pick<LocalTag, "raw" | "display">) => void;
  removeTag: (raw: string) => void;
  moveTag: (raw: string, series: string) => void;
  isSaved: (raw: string) => boolean;
  finishLegacyMigration: () => void;
};

export const UNCATEGORIZED_SERIES = "미분류";

export function inferCharacterSeries(display: string) {
  const clean = display.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!clean.endsWith(")")) return UNCATEGORIZED_SERIES;

  let depth = 0;
  for (let index = clean.length - 1; index >= 0; index -= 1) {
    const character = clean[index];
    if (character === ")") {
      depth += 1;
      continue;
    }
    if (character !== "(") continue;
    depth -= 1;
    if (depth === 0) {
      const suffix = clean.slice(index + 1, -1).trim();
      return suffix || UNCATEGORIZED_SERIES;
    }
  }

  return UNCATEGORIZED_SERIES;
}

function makeEntry(tag: Pick<LocalTag, "raw" | "display">, series?: string): CharacterLibraryEntry {
  return {
    raw: tag.raw,
    display: tag.display,
    series: series?.trim() || inferCharacterSeries(tag.display),
    addedAt: Date.now(),
  };
}

export const useCharacterLibraryStore = create<State>()(
  persist(
    (set, get) => ({
      entries: [],
      legacyFavoritesMigrated: false,
      addTag: (tag, series) => set((state) => {
        if (state.entries.some((entry) => entry.raw === tag.raw)) return state;
        return { entries: [makeEntry(tag, series), ...state.entries] };
      }),
      addMany: (tags) => set((state) => {
        const seen = new Set(state.entries.map((entry) => entry.raw));
        const incoming = tags
          .filter((tag) => !seen.has(tag.raw))
          .map((tag) => {
            seen.add(tag.raw);
            return makeEntry(tag);
          });
        return incoming.length ? { entries: [...incoming, ...state.entries] } : state;
      }),
      toggleTag: (tag) => set((state) => {
        if (state.entries.some((entry) => entry.raw === tag.raw)) {
          return { entries: state.entries.filter((entry) => entry.raw !== tag.raw) };
        }
        return { entries: [makeEntry(tag), ...state.entries] };
      }),
      removeTag: (raw) => set((state) => ({ entries: state.entries.filter((entry) => entry.raw !== raw) })),
      moveTag: (raw, series) => set((state) => ({
        entries: state.entries.map((entry) => entry.raw === raw
          ? { ...entry, series: series.trim() || UNCATEGORIZED_SERIES }
          : entry),
      })),
      isSaved: (raw) => get().entries.some((entry) => entry.raw === raw),
      finishLegacyMigration: () => set({ legacyFavoritesMigrated: true }),
    }),
    { name: "nai-v5-character-library-v1", version: 1 },
  ),
);
