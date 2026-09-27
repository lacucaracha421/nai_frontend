/**
 * Catalog thumbnails that probably show a different character (the named one is a side figure).
 * Source: wd-eva02-tagger-2026-canary over all catalog thumbnails (2026-09-27): the tagger clearly
 * saw another, unrelated character (>= 0.85) and not this one. About 10–20 % are false alarms
 * (aliases, near-identical names), so these are only hidden by default and can be shown again.
 * Their 외형/의상 tags come from the same posts, so inserting them defaults to the name only.
 */
import names from "./thumbnailSuspects.json";

const suspects = new Set<string>(names);

export function isThumbnailSuspect(raw: string) {
  return suspects.has(raw);
}
