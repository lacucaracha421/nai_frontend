import { describe, expect, it, vi } from "vitest";

// The store binds window.localStorage when the module loads, so provide one before the imports run.
const storage = vi.hoisted(() => {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  return map;
});

import { FINISH_PRESETS } from "../features/generator/finish/finishFilter";
import { migrateUiState, useUiStore } from "./uiStore";

describe("UI settings migration", () => {
  it("maps the old grain toggle to the 애니 마무리 finish filter", () => {
    expect(migrateUiState({ showFixedPrompts: true, grainEnabled: true }, 0)).toEqual({
      showFixedPrompts: true,
      finishEnabled: true,
      finishPreset: "anime",
      finishParams: FINISH_PRESETS.anime,
      saveFormat: "webp",
      showTagDiff: false,
      showHints: false,
    });
    expect(migrateUiState({ grainEnabled: false }, 0)).toMatchObject({ finishEnabled: false, finishPreset: "anime" });
    expect(migrateUiState(undefined, 0)).toMatchObject({ showFixedPrompts: false, finishEnabled: false });
  });

  it("keeps and validates current settings", () => {
    const migrated = migrateUiState(
      { showFixedPrompts: false, finishEnabled: true, finishPreset: "watercolor", finishParams: { pstr: 70, sat: 500 } },
      1,
    );
    expect(migrated).toEqual({
      showFixedPrompts: false,
      finishEnabled: true,
      finishPreset: "watercolor",
      finishParams: { ...FINISH_PRESETS.watercolor, pstr: 70, sat: 130 },
      saveFormat: "webp",
      showTagDiff: false,
      showHints: false,
    });
    expect(migrateUiState({ finishPreset: "film" }, 1).finishPreset).toBe("anime");
    expect(migrateUiState({ showTagDiff: true, showHints: "yes" }, 2)).toMatchObject({ showTagDiff: true, showHints: false });
  });

  it("defaults the save format to WebP and keeps a saved PNG choice", () => {
    expect(migrateUiState({ finishEnabled: false }, 1).saveFormat).toBe("webp");
    expect(migrateUiState({ saveFormat: "png" }, 1).saveFormat).toBe("png");
    expect(migrateUiState({ saveFormat: "gif" }, 1).saveFormat).toBe("webp");
  });

  it("persists the save format through storage", async () => {
    expect(useUiStore.getState().saveFormat).toBe("webp");
    useUiStore.getState().setSaveFormat("png");
    expect(JSON.parse(storage.get("nai-v5-s11-ui")!).state.saveFormat).toBe("png");
    useUiStore.setState({ saveFormat: "webp" });
    storage.set("nai-v5-s11-ui", JSON.stringify({ state: { saveFormat: "png" }, version: 1 }));
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().saveFormat).toBe("png");
  });
});

it("softens untouched v1 presets, retaining custom tuning and the enabled state", () => {
  const anime = { temp: 6, curve: 14, lift: 4, sat: 106, glow: 35, gthr: 72, grad: 16,
    chroma: 0.75, vig: 10, pstr: 0, pscale: 100, strength: 3.5, sharp: 30 };
  const watercolor = { temp: 3, curve: 0, lift: 6, sat: 94, glow: 0, gthr: 75, grad: 14,
    chroma: 0, vig: 0, pstr: 55, pscale: 120, strength: 2, sharp: 0 };
  for (const [finishPreset, finishParams] of [["anime", anime], ["watercolor", watercolor]] as const) {
    expect(migrateUiState({ finishPreset, finishParams, finishEnabled: true }, 1)).toMatchObject({
      finishParams: FINISH_PRESETS[finishPreset], finishEnabled: true,
    });
    const custom = { ...finishParams, strength: 4.1 };
    expect(migrateUiState({ finishPreset, finishParams: custom }, 1).finishParams).toEqual(custom);
    expect(migrateUiState({ finishPreset, finishParams }, 2).finishParams).toEqual(finishParams);
  }
});
