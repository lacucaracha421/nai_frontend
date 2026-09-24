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

const CHARACTER_SUBJECT_TAGS = new Set(["girl", "boy", "female", "male", "other", "1girl", "1boy", "1other"]);

/** Replace exact identity tags, retaining actions, clothing, emphasis and other text. */
export function chooseCharacterTag(prompt: string, previousName: string, tag: string) {
  const previousKey = normalizedCharacterTag(previousName);
  const tagKey = normalizedCharacterTag(tag);
  let replaced = false;
  const blocks = prompt.split(/[,\n]/).map((value) => value.trim()).filter(Boolean).flatMap((value) => {
    // Numeric emphasis and brace emphasis belong to the tag being replaced.
    const match = value.match(/^((?:[+-]?(?:\d+(?:\.\d+)?)\s*::\s*)?[{\[]*)(.*?)([}\]]*(?:\s*::)?)$/)!;
    const key = normalizedCharacterTag(match[2]);
    if (key !== tagKey && (!previousKey || key !== previousKey)) return [value];
    if (replaced) return [];
    replaced = true;
    return [`${match[1]}${tag}${match[3]}`];
  });
  if (!replaced) {
    let insertAt = 0;
    while (insertAt < blocks.length && CHARACTER_SUBJECT_TAGS.has(normalizedCharacterTag(blocks[insertAt]))) insertAt += 1;
    blocks.splice(insertAt, 0, tag);
  }
  return blocks.join(", ");
}
