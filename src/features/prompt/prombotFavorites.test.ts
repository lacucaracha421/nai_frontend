import { describe, expect, it } from "vitest";
import { mergePrombotFavorites, resolvePrombotTags } from "./prombotFavorites";
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
});
