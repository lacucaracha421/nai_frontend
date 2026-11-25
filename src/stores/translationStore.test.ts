import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_TRANSLATION_MODEL,
  DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  DEFAULT_NEURALWATT_TRANSLATION_MODEL,
  migrateTranslationSettings,
} from "./translationStore";

describe("translation settings migration", () => {
  it.each([0, 1])("defaults Neuralwatt and Gemini for version %s while preserving existing settings", (version) => {
    const existing = { provider: "openrouter", openRouterModel: "custom/model", ollamaModel: "gemma3" };
    expect(migrateTranslationSettings(existing, version)).toEqual({
      ...existing,
      neuralwattModel: DEFAULT_NEURALWATT_TRANSLATION_MODEL,
      geminiModel: DEFAULT_GEMINI_TRANSLATION_MODEL,
    });
    expect(existing).not.toHaveProperty("neuralwattModel");
    expect(existing).not.toHaveProperty("geminiModel");
  });

  it("defaults Gemini for version 2 while preserving user-selected Gemini model", () => {
    expect(migrateTranslationSettings({ provider: "neuralwatt" }, 2)).toMatchObject({
      geminiModel: DEFAULT_GEMINI_TRANSLATION_MODEL,
    });
    expect(migrateTranslationSettings({ geminiModel: "gemini-2.5-flash" }, 2)).toMatchObject({
      geminiModel: "gemini-2.5-flash",
    });
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
