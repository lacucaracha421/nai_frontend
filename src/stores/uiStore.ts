import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  FINISH_PRESETS,
  sanitizeFinishParams,
  type FinishParamKey,
  type FinishParams,
  type FinishPresetKey,
} from "../features/generator/finish/finishFilter";
import type { SaveFormat } from "../features/generator/save/prepareSave";

type PersistedUi = {
  showFixedPrompts: boolean;
  /** Stage "마무리" filter preview; when on, Save writes the filtered PNG. */
  finishEnabled: boolean;
  /** Preset the current values started from (target of "프리셋 값으로"). */
  finishPreset: FinishPresetKey;
  finishParams: FinishParams;
  /** Save file format: verified lossy WebP (default, NovelAI-readable) or the original PNG. */
  saveFormat: SaveFormat;
};

type State = PersistedUi & {
  setShowFixedPrompts: (value: boolean) => void;
  setFinishEnabled: (value: boolean) => void;
  /** Loads a preset's exact values and turns the filter on. */
  applyFinishPreset: (preset: FinishPresetKey) => void;
  /** Changes one detail value (clamped) and turns the filter on. */
  setFinishParam: (key: FinishParamKey, value: number) => void;
  setSaveFormat: (format: SaveFormat) => void;
};

export const UI_STORE_VERSION = 1;

const DEFAULT_UI: PersistedUi = {
  showFixedPrompts: false,
  finishEnabled: false,
  finishPreset: "anime",
  finishParams: { ...FINISH_PRESETS.anime },
  saveFormat: "webp",
};

function isPresetKey(value: unknown): value is FinishPresetKey {
  return value === "anime" || value === "watercolor";
}

/** Upgrades/validates persisted UI state. v0 only had `grainEnabled` (old grain on → 애니 마무리 on). */
export function migrateUiState(persisted: unknown, version: number): PersistedUi {
  const old = persisted && typeof persisted === "object" ? (persisted as Record<string, unknown>) : {};
  const showFixedPrompts = typeof old.showFixedPrompts === "boolean" ? old.showFixedPrompts : DEFAULT_UI.showFixedPrompts;
  const saveFormat: SaveFormat = old.saveFormat === "png" ? "png" : "webp";
  if (version < 1) {
    return { ...DEFAULT_UI, showFixedPrompts, finishEnabled: old.grainEnabled === true, saveFormat };
  }
  const finishPreset = isPresetKey(old.finishPreset) ? old.finishPreset : DEFAULT_UI.finishPreset;
  return {
    showFixedPrompts,
    finishEnabled: old.finishEnabled === true,
    finishPreset,
    finishParams: sanitizeFinishParams(old.finishParams, FINISH_PRESETS[finishPreset]),
    saveFormat,
  };
}

export const useUiStore = create<State>()(
  persist(
    (set, get) => ({
      ...DEFAULT_UI,
      finishParams: { ...DEFAULT_UI.finishParams },
      setShowFixedPrompts: (showFixedPrompts) => set({ showFixedPrompts }),
      setFinishEnabled: (finishEnabled) => set({ finishEnabled }),
      applyFinishPreset: (finishPreset) =>
        set({ finishPreset, finishParams: { ...FINISH_PRESETS[finishPreset] }, finishEnabled: true }),
      setFinishParam: (key, value) => {
        const current = get().finishParams;
        set({ finishParams: sanitizeFinishParams({ ...current, [key]: value }, current), finishEnabled: true });
      },
      setSaveFormat: (saveFormat) => set({ saveFormat }),
    }),
    {
      name: "nai-v5-s11-ui",
      version: UI_STORE_VERSION,
      migrate: (persisted, version) => migrateUiState(persisted, version) as State,
      // Re-validate after load so partial or hand-edited storage cannot break the filter.
      merge: (persisted, current) => ({ ...current, ...migrateUiState(persisted, UI_STORE_VERSION) }),
      partialize: (state): PersistedUi => ({
        showFixedPrompts: state.showFixedPrompts,
        finishEnabled: state.finishEnabled,
        finishPreset: state.finishPreset,
        finishParams: state.finishParams,
        saveFormat: state.saveFormat,
      }),
    },
  ),
);
