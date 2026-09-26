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

/** Result of `prombot_favorite_catalog` (Rust): raw Prombot bookmarks split up. */
export type PrombotFavoriteCatalog = {
  /** False when Prombot's character list could not be loaded (nothing filtered). */
  available: boolean;
  /** Why the character list could not be loaded. */
  error?: string | null;
  /** Distinct raw bookmarks read from Prombot. */
  total?: number;
  /** Individually bookmarked characters, in Prombot order. */
  characters: string[];
  series: Record<string, string>;
  /** Bookmarks missing from Prombot's characters.csv (renamed/removed). */
  unknown: string[];
  /** Series-level ☆ that Prombot expanded to every member. */
  seriesFavorites: PrombotSeriesCount[];
  /** Kept groups with the most bookmarks (to spot a series ☆ the filter missed). */
  largestGroups?: PrombotSeriesCount[];
};

export type PrombotSeriesCount = { series: string; members: number; favorited: number };

function seriesLabel(series: string) {
  return series ? displayRaw(series) : "Other series";
}

function seriesCounts(items: PrombotSeriesCount[]) {
  return items.map((item) => `${seriesLabel(item.series)} ${item.favorited}/${item.members}명`).join(", ");
}

/**
 * One-line breakdown of the last import, kept so the random screen can show
 * where its count came from, e.g. "Prombot 원본 378명 → 45명 · 시리즈 ☆ 1개(333명) 제외 · 알 수 없는 이름 0개".
 */
export function prombotImportBreakdown(catalog: PrombotFavoriteCatalog) {
  const raw = catalog.total ?? catalog.characters.length;
  const head = `Prombot 원본 ${raw}명 → ${catalog.characters.length}명`;
  if (!catalog.available) return `${head} · 캐릭터 목록을 받지 못해 필터 없이 가져옴`;
  const excluded = catalog.seriesFavorites.reduce((sum, item) => sum + item.favorited, 0);
  return `${head} · 시리즈 ☆ ${catalog.seriesFavorites.length}개(${excluded}명) 제외 · 알 수 없는 이름 ${catalog.unknown.length}개 제외`;
}

/** Import summary shown after importing: the breakdown, merge counts and details. */
export function prombotImportMessage(
  catalog: PrombotFavoriteCatalog,
  stats: { added: number; existing: number; removed: number; total: number },
) {
  const lines = [
    prombotImportBreakdown(catalog),
    `도감 신규 ${stats.added} · 기존 ${stats.existing} · 제거 ${stats.removed}`,
  ];
  if (!catalog.available && catalog.error) lines.push(`목록 오류: ${catalog.error}`);
  if (catalog.seriesFavorites.length) lines.push(`제외한 시리즈: ${seriesCounts(catalog.seriesFavorites)}`);
  if (catalog.largestGroups?.length) lines.push(`가장 많이 담긴 시리즈(유지): ${seriesCounts(catalog.largestGroups)}`);
  if (catalog.unknown.length) {
    const sample = catalog.unknown.slice(0, 5).map(displayRaw).join(", ");
    lines.push(`알 수 없는 이름: ${sample}${catalog.unknown.length > 5 ? ` 외 ${catalog.unknown.length - 5}개` : ""}`);
  }
  return lines.join("\n");
}
