import { describe, expect, it } from "vitest";
import { applyRandomCharacter, pickRandomCharacter } from "./randomCharacter";
import type { CharacterLibraryEntry } from "../../stores/characterLibraryStore";
import type { GenerationDraft } from "../../adapters/novelai/types";

const library: CharacterLibraryEntry[] = [
  { raw: "manual", display: "manual", series: "x", addedAt: 1 },
  { raw: "rupa", display: "rupa", series: "gbc", addedAt: 2, prombotFavorite: true },
  { raw: "nina", display: "nina", series: "gbc", addedAt: 3, prombotFavorite: true },
];

const draft: GenerationDraft = {
  artistPrompt: "artist:test",
  otherPrompt: "1girl, outdoors",
  qualityPrompt: "best quality",
  negativePrompt: "bad quality",
  characters: [{
    id: "slot-1", name: "old", prompt: "old, red dress", negative: "bad hands",
    enabled: true, position: { x: 0.3, y: 0.7 },
  }],
  useCharacterCoords: true,
  settings: {
    model: "nai-diffusion-5-full", width: 832, height: 1216, steps: 28,
    guidance: 5, guidanceRescale: 0.15, sampler: "k_euler_ancestral",
    noiseSchedule: "karras", seed: null,
  },
};

describe("random character generation", () => {
  it("draws only from Prombot-imported favorites", () => {
    expect(pickRandomCharacter(library, () => 0)?.raw).toBe("rupa");
    expect(pickRandomCharacter(library, () => 0.99)?.raw).toBe("nina");
  });

  it("replaces only the structured character for the request and preserves its slot settings", () => {
    const next = applyRandomCharacter(draft, library[2]);
    expect(next.artistPrompt).toBe(draft.artistPrompt);
    expect(next.otherPrompt).toBe(draft.otherPrompt);
    expect(next.settings).toBe(draft.settings);
    expect(next.characters).toHaveLength(1);
    expect(next.characters[0]).toMatchObject({
      name: "nina",
      prompt: "nina",
      negative: "bad hands",
      position: { x: 0.3, y: 0.7 },
      enabled: true,
    });
    expect(draft.characters[0].prompt).toBe("old, red dress");
  });
});
