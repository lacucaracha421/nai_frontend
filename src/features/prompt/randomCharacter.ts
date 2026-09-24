import { chooseCharacterTag, detectCharacterTagFromPrompt } from "./characterTag";
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
