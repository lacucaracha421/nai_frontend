import { adjustEmphasis } from "./weight";

/**
 * Pure tag operations for the main-screen chip editor (NAI-010).
 * A prompt section is a comma/newline separated list. Commas inside an open
 * `1.2::…::` weight group or inside ()/[]/{} brackets do not split, so such a
 * group is one chip. Every edit rewrites only the affected tag's text range;
 * the separators and line breaks around it are kept as typed.
 */

export type TagRange = { start: number; end: number };

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

/** Positions of the commas/newlines that separate tags (not those inside a group). */
export function topLevelSeparators(value: string): number[] {
  const separators: number[] = [];
  let segmentStart = 0;
  let depth = 0;
  let inWeight = false;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (char === ":" && value[cursor + 1] === ":") {
      if (inWeight) inWeight = false;
      // `N::` opens a weight group only right after a number at the start of the tag.
      else if (/^\s*-?\d+(?:\.\d+)?$/.test(value.slice(segmentStart, cursor))) inWeight = true;
      cursor += 1;
      continue;
    }
    if (OPEN.has(char)) depth += 1;
    else if (CLOSE.has(char)) depth = Math.max(0, depth - 1);
    else if ((char === "," || char === "\n") && depth === 0 && !inWeight) {
      separators.push(cursor);
      segmentStart = cursor + 1;
    }
  }
  return separators;
}

export function tagRanges(value: string): TagRange[] {
  const ranges: TagRange[] = [];
  let segmentStart = 0;
  for (const end of [...topLevelSeparators(value), value.length]) {
    const segment = value.slice(segmentStart, end);
    const leading = segment.match(/^\s*/)?.[0].length ?? 0;
    const trailing = segment.match(/\s*$/)?.[0].length ?? 0;
    const start = segmentStart + leading;
    const stop = end - trailing;
    if (stop > start) ranges.push({ start, end: stop });
    segmentStart = end + 1;
  }
  return ranges;
}

export function splitTags(value: string): string[] {
  return tagRanges(value).map((range) => value.slice(range.start, range.end));
}

const WEIGHTED = /^\s*(-?\d+(?:\.\d+)?)::([\s\S]*?)::\s*$/;

/** Splits `1.2::soft smile ::` into its weight and text; plain tags have weight 1. */
export function tagWeight(tag: string): { weight: number; content: string; weighted: boolean } {
  const match = tag.match(WEIGHTED);
  if (!match) return { weight: 1, content: tag.trim(), weighted: false };
  return { weight: Number(match[1]), content: match[2].trim(), weighted: true };
}

/** Same weight wrapper around new text (used after translating a weighted tag). */
export function withWeightOf(tag: string, content: string) {
  const { weight, weighted } = tagWeight(tag);
  return weighted ? `${weight.toFixed(1)}::${content} ::` : content;
}

/** Removes one tag with the separator after it (or before it, for the last tag). */
export function removeTagAt(value: string, index: number) {
  const ranges = tagRanges(value);
  const range = ranges[index];
  if (!range) return value;
  if (index < ranges.length - 1) return value.slice(0, range.start) + value.slice(ranges[index + 1].start);
  if (index > 0) return value.slice(0, ranges[index - 1].end) + value.slice(range.end);
  return value.slice(0, range.start) + value.slice(range.end);
}

/** Replaces one tag's text; text with commas becomes several tags, empty text removes it. */
export function replaceTagAt(value: string, index: number, text: string) {
  const range = tagRanges(value)[index];
  if (!range) return value;
  const pieces = splitTags(text);
  if (!pieces.length) return removeTagAt(value, index);
  return value.slice(0, range.start) + pieces.join(", ") + value.slice(range.end);
}

/** Adds `delta` to one tag's weight with the existing `1.2::tag ::` syntax (1.0 drops the wrapper). */
export function adjustTagWeightAt(value: string, index: number, delta: number) {
  const range = tagRanges(value)[index];
  if (!range) return value;
  const tag = value.slice(range.start, range.end);
  return value.slice(0, range.start) + adjustEmphasis(tag, 0, tag.length, delta).text + value.slice(range.end);
}

/** Swaps one tag with its left (-1) or right (+1) neighbour; separators stay where they are. */
export function moveTagAt(value: string, index: number, direction: -1 | 1) {
  const ranges = tagRanges(value);
  const target = index + direction;
  if (!ranges[index] || !ranges[target]) return value;
  const [first, second] = direction === 1 ? [ranges[index], ranges[target]] : [ranges[target], ranges[index]];
  return value.slice(0, first.start)
    + value.slice(second.start, second.end)
    + value.slice(first.end, second.start)
    + value.slice(first.start, first.end)
    + value.slice(second.end);
}

/** Inserts typed text (possibly several tags) before tag `at`, or after the last tag. */
export function insertTagsAt(value: string, text: string, at = Number.POSITIVE_INFINITY) {
  const pieces = splitTags(text);
  if (!pieces.length) return value;
  const insertion = pieces.join(", ");
  const ranges = tagRanges(value);
  if (!ranges.length) return insertion;
  if (at >= ranges.length) {
    const last = ranges[ranges.length - 1];
    return `${value.slice(0, last.end)}, ${insertion}${value.slice(last.end)}`;
  }
  const start = ranges[Math.max(0, at)].start;
  return `${value.slice(0, start)}${insertion}, ${value.slice(start)}`;
}

/** Comparable form of a tag: case, underscores and spacing do not count as a change. */
export function normalizeTag(tag: string) {
  return tag.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export type TagDiff = { added: string[]; removed: string[] };

/**
 * Tags added to / removed from `previous` in `current` (order-insensitive, duplicates counted).
 * Returns null when there is no previous prompt to compare with.
 */
export function promptTagDiff(previous: string | null | undefined, current: string): TagDiff | null {
  if (previous === null || previous === undefined) return null;
  return {
    added: unmatched(splitTags(current), splitTags(previous)),
    removed: unmatched(splitTags(previous), splitTags(current)),
  };
}

/** Tags of `from` that have no counterpart left in `against`. */
function unmatched(from: string[], against: string[]) {
  const pool = new Map<string, number>();
  for (const tag of against) {
    const key = normalizeTag(tag);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  return from.filter((tag) => {
    const key = normalizeTag(tag);
    const count = pool.get(key) ?? 0;
    if (count === 0) return true;
    pool.set(key, count - 1);
    return false;
  });
}

/** "+2 −1" label, or null when nothing changed. */
export function formatTagDiff(diff: TagDiff | null) {
  if (!diff || (!diff.added.length && !diff.removed.length)) return null;
  return `+${diff.added.length} −${diff.removed.length}`;
}
