import { describe, expect, it } from "vitest";
import { mergePrombotFavorites, prombotImportMessage, resolvePrombotTags, type PrombotFavoriteCatalog } from "./prombotFavorites";
import { UNCATEGORIZED_SERIES, type CharacterLibraryEntry } from "../../stores/characterLibraryStore";

const entry = (patch: Partial<CharacterLibraryEntry>): CharacterLibraryEntry => ({
  raw: "rupa",
  display: "rupa",
  series: "직접 만든 폴더",
  addedAt: 1,
  ...patch,
});

describe("Prombot favorites import", () => {
  it("removes characters no longer bookmarked when Prombot imported them", () => {
    const existing = [entry({ prombotFavorite: true, prombotManaged: true }), entry({ raw: "manual" })];
    const before = structuredClone(existing);
    const result = mergePrombotFavorites(existing, [{ raw: "new", display: "new" }]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual(existing[1]);
    expect(result.entries[1]).toMatchObject({ raw: "new", prombotFavorite: true, prombotManaged: true });
    expect(result.stats.removed).toBe(1);
    expect(existing).toEqual(before);
  });

  it("removes legacy Prombot-linked entries on an empty refresh", () => {
    const existing = [
      entry({ prombotFavorite: true }),
      entry({ raw: "stale", prombotFavorite: false }),
      entry({ raw: "manual" }),
    ];
    const result = mergePrombotFavorites(existing, []);
    expect(result.entries).toEqual([existing[2]]);
    expect(result.stats).toEqual({ added: 0, existing: 0, removed: 2, total: 0 });
  });

  it("preserves a manual entry after its Prombot bookmark is removed", () => {
    const imported = mergePrombotFavorites([entry({ raw: "manual" })], [
      { raw: "manual", display: "manual" },
    ]);
    expect(imported.entries[0].prombotManaged).toBe(false);

    const refreshed = mergePrombotFavorites(imported.entries, []);
    expect(refreshed.entries).toEqual([entry({ raw: "manual", prombotManaged: false })]);
  });

  it("upgrades uncategorized entries and falls back to name inference without metadata", () => {
    const result = mergePrombotFavorites([entry({ series: UNCATEGORIZED_SERIES })], [
      { raw: "rupa", display: "rupa", series: "girls_band_cry" },
      { raw: "missing_(some_series)", display: "missing (some series)" },
    ]);
    expect(result.entries.map((item) => item.series)).toEqual(["girls band cry", "some series"]);
  });

  it("keeps manual series placement while marking existing favorites and classifying new ones", () => {
    const existing = [entry({})];
    const incoming = [
      { raw: "rupa", display: "rupa", series: "girls_band_cry" },
      { raw: "nina_iseri", display: "nina iseri", series: "girls_band_cry" },
    ];

    const result = mergePrombotFavorites(existing, incoming, 100);
    expect(result.entries.find((item) => item.raw.startsWith("rupa"))?.series).toBe("직접 만든 폴더");
    expect(result.entries.find((item) => item.raw.startsWith("rupa"))?.prombotFavorite).toBe(true);
    expect(result.entries.find((item) => item.raw.startsWith("nina"))?.series).toBe("girls band cry");
    expect(result.stats).toEqual({ added: 1, existing: 1, removed: 0, total: 2 });
  });

  it("preserves Prombot order and creates a readable fallback when the local tag DB misses a favorite", () => {
    const resolved = resolvePrombotTags(
      ["known_(series)", "missing_character_(other_series)"],
      [{ raw: "known_(series)", display: "known (series)" }],
    );

    expect(resolved).toEqual([
      { raw: "known_(series)", display: "known (series)" },
      { raw: "missing_character_(other_series)", display: "missing character (other series)" },
    ]);
  });

  it("imports only individual bookmarks and replaces an earlier inflated import (NAI-005)", () => {
    // An earlier import stored every member of a series ☆ (379 characters).
    const inflated = mergePrombotFavorites([], Array.from({ length: 379 }, (_, index) => ({
      raw: index < 333 ? `touhou_${index}` : `pick_${index}`,
      display: `c${index}`,
    }))).entries;
    expect(inflated.filter((item) => item.prombotFavorite).length).toBe(379);

    const catalog: PrombotFavoriteCatalog = {
      available: true,
      characters: Array.from({ length: 43 }, (_, index) => `pick_${index + 333}`),
      series: {},
      unknown: ["renamed_character", "removed_character"],
      seriesFavorites: [{ series: "touhou", members: 333, favorited: 333 }],
      total: 378,
      largestGroups: [{ series: "fate_(series)", members: 10, favorited: 7 }],
    };
    const result = mergePrombotFavorites(
      inflated,
      catalog.characters.map((raw) => ({ raw, display: raw })),
    );
    expect(result.entries.filter((item) => item.prombotFavorite).length).toBe(43);
    expect(result.stats).toEqual({ added: 0, existing: 43, removed: 336, total: 43 });
    expect(prombotImportMessage(catalog, result.stats)).toBe([
      "Prombot 원본 378명 → 43명 · 시리즈 ☆ 1개(333명) 제외 · 알 수 없는 이름 2개 제외",
      "도감 신규 0 · 기존 43 · 제거 336",
      "제외한 시리즈: touhou 333/333명",
      "가장 많이 담긴 시리즈(유지): fate (series) 7/10명",
      "알 수 없는 이름: renamed character, removed character",
    ].join("\n"));
  });

  it("says so, with the reason, when Prombot's character list could not be loaded", () => {
    const message = prombotImportMessage(
      { available: false, error: "HTTP 503", total: 1, characters: ["a"], series: {}, unknown: [], seriesFavorites: [] },
      { added: 1, existing: 0, removed: 0, total: 1 },
    );
    expect(message).toBe([
      "Prombot 원본 1명 → 1명 · 캐릭터 목록을 받지 못해 필터 없이 가져옴",
      "도감 신규 1 · 기존 0 · 제거 0",
      "목록 오류: HTTP 503",
    ].join("\n"));
  });
});
