import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  DEFAULT_NEURALWATT_TRANSLATION_MODEL,
  migrateTranslationSettings,
} from "./translationStore";

describe("translation settings migration", () => {
  it.each([0, 1])("defaults Neuralwatt for version %s while preserving existing settings", (version) => {
    const existing = { provider: "openrouter", openRouterModel: "custom/model", ollamaModel: "gemma3" };
    expect(migrateTranslationSettings(existing, version)).toEqual({
      ...existing,
      neuralwattModel: DEFAULT_NEURALWATT_TRANSLATION_MODEL,
    });
    expect(existing).not.toHaveProperty("neuralwattModel");
  });

  it("preserves a user-selected Neuralwatt model", () => {
    expect(migrateTranslationSettings({ neuralwattModel: "deepseek-v4.1-flash" }, 1)).toMatchObject({
      neuralwattModel: "deepseek-v4.1-flash",
    });
  });

  it.each([undefined, "", "google/gemini-2.5-flash-lite"])(
    "moves the legacy OpenRouter model %s to Gemini 3.5 Flash Lite",
    (openRouterModel) => {
      expect(migrateTranslationSettings({ openRouterModel }, 0)).toMatchObject({
        openRouterModel: DEFAULT_OPENROUTER_TRANSLATION_MODEL,
      });
    },
  );

  it("preserves a user-selected OpenRouter model", () => {
    expect(migrateTranslationSettings({ openRouterModel: "anthropic/claude-sonnet-4" }, 0)).toMatchObject({
      openRouterModel: "anthropic/claude-sonnet-4",
    });
  });
});
