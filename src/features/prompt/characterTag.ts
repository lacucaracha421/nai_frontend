import { searchLocalTags, type LocalTag } from "../tags/localTagIndex";

export function normalizedCharacterTag(value: string) {
  return value
    .replace(/\\+([(){}\[\]])/g, "$1")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function promptTerms(prompt: string) {
  return prompt
    .split(/[,\n]+/)
    .map((term) => term
      .trim()
      .replace(/^[+-]?(?:\d+(?:\.\d+)?)\s*::\s*/, "")
      .replace(/\s*::\s*$/, "")
      .trim())
    .filter((term) => term.length >= 2);
}

export async function detectCharacterTagFromPrompt(prompt: string): Promise<LocalTag | null> {
  for (const term of promptTerms(prompt).slice(0, 12)) {
    const target = normalizedCharacterTag(term);
    const matches = await searchLocalTags(term, ["character"], 8);
    const exact = matches.find((tag) =>
      normalizedCharacterTag(tag.display) === target || normalizedCharacterTag(tag.raw) === target
    );
    if (exact) return exact;
  }
  return null;
}
