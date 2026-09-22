import type { GenerationDraft } from "../../adapters/novelai/types";
import type { CharacterLibraryEntry } from "../../stores/characterLibraryStore";

export function pickRandomCharacter(
  entries: CharacterLibraryEntry[],
  random: () => number = Math.random,
) {
  const pool = entries.filter((entry) => entry.prombotFavorite === true);
  if (!pool.length) return null;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length));
  return pool[index];
}

export function applyRandomCharacter(
  draft: GenerationDraft,
  entry: CharacterLibraryEntry,
): GenerationDraft {
  const template = draft.characters.find((character) => character.enabled) ?? draft.characters[0];
  const position = template?.position ?? { x: 0.5, y: 0.5 };
  return {
    ...draft,
    characters: [{
      id: template?.id ?? "random-character",
      name: entry.display,
      prompt: entry.display,
      negative: template?.negative ?? "",
      enabled: true,
      position: { ...position },
    }],
  };
}
