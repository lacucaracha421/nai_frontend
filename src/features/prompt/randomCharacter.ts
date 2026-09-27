import { detectCharacterTagFromPrompt } from "./characterTag";
import type { GenerationDraft } from "../../adapters/novelai/types";
import { UNCATEGORIZED_SERIES, type CharacterLibraryEntry } from "../../stores/characterLibraryStore";

import { characterKey, insertCharacter } from "./characterCatalog";
import { loadCharacterCatalog } from "./characterCatalogClient";
import type { FinderPreferences } from "../../stores/characterLibraryStore";
import { isThumbnailSuspect } from "./thumbnailSuspects";

export function characterIdentity(entry: Pick<CharacterLibraryEntry, "raw">) { return characterKey(entry.raw); }

export function randomCharacterPool(entries: CharacterLibraryEntry[], preferences?: Pick<FinderPreferences, "randomScope" | "randomSeries">) {
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (preferences?.randomScope === "series" && !preferences.randomSeries.includes(entry.series)) return false;
    const key = characterIdentity(entry);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function pickRandomCharacter(
  entries: CharacterLibraryEntry[],
  random: () => number = Math.random,
  preferences?: Pick<FinderPreferences, "randomScope" | "randomSeries">,
) {
  const pool = randomCharacterPool(entries, preferences);
  if (!pool.length) return null;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length));
  return pool[index];
}

/** What the 🎲 drew for one generation, kept on the image so it can be shown later. */
export type RandomCharacterPick = { display: string; series: string };

export function toRandomPick(entry: Pick<CharacterLibraryEntry, "display" | "series">): RandomCharacterPick {
  return { display: entry.display, series: entry.series };
}

/**
 * Name and series for display. Danbooru-style names carry the series in brackets
 * ("nina (girls band cry)"); that suffix is dropped when it repeats the series, and the
 * "미분류" placeholder is never shown as a series.
 */
export function randomPickLabel(pick: RandomCharacterPick) {
  const clean = (text: string) => text.replace(/\\+([()])/g, "$1").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  let name = clean(pick.display);
  const series = clean(pick.series);
  const showSeries = !!series && series !== UNCATEGORIZED_SERIES;
  if (showSeries) {
    const suffix = ` (${series.toLowerCase()})`;
    if (name.toLowerCase().endsWith(suffix) && name.length > suffix.length) name = name.slice(0, -suffix.length).trim();
  }
  return { name, series: showSeries ? series : "" };
}

export async function applyRandomCharacter(
  draft: GenerationDraft,
  entry: Pick<CharacterLibraryEntry, "display"> & { raw?: string },
  mode: "name" | "features" = "name",
): Promise<GenerationDraft> {
  const template = draft.characters.find((character) => character.enabled) ?? draft.characters[0];
  const position = template?.position ?? { x: 0.5, y: 0.5 };
  // Resolve from the actual prompt, not the UI's debounced name label.
  const detected = template?.prompt ? await detectCharacterTagFromPrompt(template.prompt) : null;
  const base = { prompt: template?.prompt ?? "", name: detected?.display ?? template?.name ?? "", finderTags: template?.finderTags };
  const catalog = mode === "features" ? await loadCharacterCatalog() : [];
  const row = catalog.find(row => characterKey(row.raw) === characterKey(entry.raw ?? entry.display))
    ?? { raw: entry.raw ?? entry.display, display: entry.display, series: "", features: [], attire: [], isNew: false, posts: 0 };
  const insertion = insertCharacter(base, row, isThumbnailSuspect(row.raw) ? "name" : mode);
  const replacement = {
    id: template?.id ?? "random-character",
    ...insertion,
    negative: template?.negative ?? "",
    enabled: true,
    position: { ...position },
  };
  return {
    ...draft,
    characters: template
      ? draft.characters.map((character) => character === template ? replacement : character)
      : [replacement],
  };
}
