import type { TagCategory } from "./localTagIndex";

export type PromptToken = {
  id: string;
  text: string;
};

let fallbackTokenId = 0;

export function createPromptToken(text = ""): PromptToken {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `prompt-token-${Date.now()}-${fallbackTokenId++}`;
  return { id, text };
}

export function tokensFromPrompt(value: string): PromptToken[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text) => createPromptToken(text));
}

export function serializePromptTokens(tokens: PromptToken[]) {
  return tokens
    .map((token) => token.text.trim())
    .filter(Boolean)
    .join(", ");
}
export function insertionForSuggestion(
  display: string,
  category: TagCategory,
  tagPrefix?: string,
) {
  if (tagPrefix?.toLowerCase() === "artist:" && category === "artist") {
    return `${tagPrefix}${display}`;
  }
  return display;
}

export function selectionOrWhole(start: number, end: number, length: number) {
  if (start === end) return { start: 0, end: length };
  return {
    start: Math.max(0, Math.min(start, length)),
    end: Math.max(0, Math.min(end, length)),
  };
}

export function movePromptToken(tokens: PromptToken[], fromId: string, toId: string) {
  const from = tokens.findIndex((token) => token.id === fromId);
  const to = tokens.findIndex((token) => token.id === toId);
  if (from < 0 || to < 0 || from === to) return tokens;
  const next = [...tokens];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
export function reconcilePromptTokens(existing: PromptToken[], value: string) {
  const parts = tokensFromPrompt(value).map((token) => token.text);
  const stable = existing.filter((token) => token.text.trim());
  return parts.map((text, index) => {
    const previous = stable[index];
    return previous ? { ...previous, text } : createPromptToken(text);
  });
}