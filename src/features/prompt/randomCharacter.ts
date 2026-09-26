import { chooseCharacterTag, detectCharacterTagFromPrompt } from "./characterTag";
import type { GenerationDraft } from "../../adapters/novelai/types";
import type { CharacterLibraryEntry } from "../../stores/characterLibraryStore";

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

export async function applyRandomCharacter(
  draft: GenerationDraft,
  entry: CharacterLibraryEntry,
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
