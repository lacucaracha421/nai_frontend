import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  migrateTranslationSettings,
} from "./translationStore";

describe("translation settings migration", () => {
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
