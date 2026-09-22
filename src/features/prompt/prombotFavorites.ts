import {
  UNCATEGORIZED_SERIES,
  inferCharacterSeries,
  type CharacterLibraryEntry,
} from "../../stores/characterLibraryStore";

export type PrombotTag = { raw: string; display: string; series?: string };

function displayRaw(raw: string) {
  return raw.replace(/\\+([(){}\[\]])/g, "$1").replace(/_/g, " ");
}

export function resolvePrombotTags(keys: string[], resolved: PrombotTag[]) {
  const byRaw = new Map(resolved.map((tag) => [tag.raw, tag]));
  return keys.map((raw) => byRaw.get(raw) ?? { raw, display: displayRaw(raw) });
}

export function mergePrombotFavorites(
  existing: CharacterLibraryEntry[],
  incoming: PrombotTag[],
  now = Date.now(),
) {
  const incomingRaw = new Set(incoming.map((tag) => tag.raw));
  let removed = 0;
  const next = existing.flatMap<CharacterLibraryEntry>((entry) => {
    if (incomingRaw.has(entry.raw)) return [{ ...entry }];

    const legacyManaged = entry.prombotManaged === undefined && entry.prombotFavorite !== undefined;
    if (entry.prombotManaged === true || legacyManaged) {
      removed += 1;
      return [];
    }

    if (entry.prombotFavorite !== undefined) {
      const { prombotFavorite: _prombotFavorite, ...manualEntry } = entry;
      return [manualEntry];
    }
    return [{ ...entry }];
  });
  const index = new Map(next.map((entry, i) => [entry.raw, i]));
  let added = 0;
  let already = 0;
  for (const tag of incoming) {
    const at = index.get(tag.raw);
    const inferredSeries = tag.series?.trim()
      ? displayRaw(tag.series)
      : inferCharacterSeries(tag.display);
    if (at !== undefined) {
      already += 1;
      const current = next[at];
      const prombotManaged = current.prombotManaged
        ?? (current.prombotFavorite !== undefined);
      next[at] = {
        ...current,
        prombotFavorite: true,
        prombotManaged,
        series: current.series === UNCATEGORIZED_SERIES && inferredSeries !== UNCATEGORIZED_SERIES
          ? inferredSeries
          : current.series,
      };
      continue;
    }

    const entry: CharacterLibraryEntry = {
      raw: tag.raw,
      display: tag.display,
      series: inferredSeries,
      addedAt: now,
      prombotFavorite: true,
      prombotManaged: true,
    };
    index.set(entry.raw, next.length);
    next.push(entry);
    added += 1;
  }

  return { entries: next, stats: { added, existing: already, removed, total: incoming.length } };
}
