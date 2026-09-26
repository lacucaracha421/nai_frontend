import { chooseCharacterTag, detectCharacterTagFromPrompt } from "./characterTag";
import type { GenerationDraft } from "../../adapters/novelai/types";
import { UNCATEGORIZED_SERIES, type CharacterLibraryEntry } from "../../stores/characterLibraryStore";

/** One key per character, whatever spelling the entry arrived with (Prombot CSV quoting,
 * escaped brackets, underscores or spaces, letter case). */
export function characterIdentity(entry: Pick<CharacterLibraryEntry, "raw">) {
  let raw = entry.raw.trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1).replace(/""/g, '"');
  return raw
    .replace(/\\+([(){}\[\]])/g, "$1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The characters the 🎲 draws from: Prombot bookmarks, one entry per character.
 * The on-screen count must use this too, so the number shown is the number drawn from.
 */
export function randomCharacterPool(entries: CharacterLibraryEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (entry.prombotFavorite !== true) return false;
    const key = characterIdentity(entry);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pickRandomCharacter(
  entries: CharacterLibraryEntry[],
  random: () => number = Math.random,
) {
  const pool = randomCharacterPool(entries);
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
  entry: Pick<CharacterLibraryEntry, "display">,
): Promise<GenerationDraft> {
  const template = draft.characters.find((character) => character.enabled) ?? draft.characters[0];
  const position = template?.position ?? { x: 0.5, y: 0.5 };
  // Resolve from the actual prompt, not the UI's debounced name label.
  const detected = template?.prompt ? await detectCharacterTagFromPrompt(template.prompt) : null;
  const replacement = {
    id: template?.id ?? "random-character",
    name: entry.display,
    prompt: chooseCharacterTag(template?.prompt ?? "", detected?.display ?? template?.name ?? "", entry.display),
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
