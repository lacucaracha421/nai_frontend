import { expect, it, vi } from "vitest";
import { migrateCharacterLibrary } from "./characterLibraryStore";
it("preserves every legacy bookmark and folder while stripping obsolete import metadata", () => {
  const prefix = "prom" + "bot";
  const entries = Array.from({ length: 379 }, (_, i) => ({ raw: `c${i}`, display: `C${i}`, series: `folder ${i % 9}`, addedAt: i, [prefix + "Favorite"]: i % 2 === 0, [prefix + "Managed"]: true }));
  const next = migrateCharacterLibrary({ entries, legacyFavoritesMigrated: true, [prefix + "ImportSummary"]: "old" });
  expect(next.entries).toEqual(entries.map(({ raw, display, series, addedAt }) => ({ raw, display, series, addedAt })));
  expect(next.entries).toHaveLength(379);
  expect(next.randomScope).toBe("all");
  expect(next).not.toHaveProperty(prefix + "ImportSummary");
});

it("runs version 1 hydration through persist and writes version 2 without dropping bookmarks", async () => {
  const { createJSONStorage } = await import("zustand/middleware");

  const prefix = "prom" + "bot";
  const entries = Array.from({ length: 379 }, (_, i) => ({ raw: `tag${i}`, display: `Tag ${i}`, series: `custom ${i % 8}`, addedAt: i, [prefix + "Managed"]: true }));
  let value = JSON.stringify({ version: 1, state: { entries, legacyFavoritesMigrated: true } });
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => {}, clear: () => {}, key: () => null, length: 1 };
  vi.stubGlobal("window", { localStorage: storage });
  vi.resetModules();
  const { useCharacterLibraryStore } = await import("./characterLibraryStore");
  useCharacterLibraryStore.persist.setOptions({ storage: createJSONStorage(() => storage) });
  await useCharacterLibraryStore.persist.rehydrate();
  expect(useCharacterLibraryStore.getState().entries).toHaveLength(379);
  const saved = JSON.parse(value);
  expect(saved.version).toBe(2);
  expect(saved.state.entries[378]).toEqual({ raw: "tag378", display: "Tag 378", series: "custom 2", addedAt: 378 });
  expect(value).not.toContain(prefix);
  vi.unstubAllGlobals();
});
