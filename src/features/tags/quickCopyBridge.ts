import type { LocalTag } from "./localTagIndex";

export type QuickCopyKind = "artist" | "action" | "tag";

const normalizedTag = (value: string) => value
  .replace(/\\+([(){}\[\]])/g, "$1")
  .replace(/_/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

export function quickCopyArtistQuery(text: string) {
  const trimmed = text.trim();
  if (!trimmed || /[,\n]/.test(trimmed)) return null;
  return trimmed.replace(/^artist\\?:/i, "").trim() || null;
}

export function exactArtistTag(text: string, rows: LocalTag[]) {
  const query = quickCopyArtistQuery(text);
  if (!query) return false;
  const expected = normalizedTag(query);
  return rows.some((tag) => tag.category === "artist"
    && (normalizedTag(tag.raw) === expected || normalizedTag(tag.display) === expected));
}

export function quickCopyInsertion(data: {
  text?: unknown;
  kind?: QuickCopyKind;
  tab?: string;
}, artistConfirmed = false) {
  const text = String(data.text ?? "").trim();
  if (!text || data.kind !== "artist" || !artistConfirmed || /^artist\\?:/i.test(text)) return text;
  return `artist:${text}`;
}
