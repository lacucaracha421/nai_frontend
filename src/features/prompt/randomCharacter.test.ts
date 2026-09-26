import { describe, expect, it, vi } from "vitest";
import { applyRandomCharacter, characterIdentity, pickRandomCharacter, randomCharacterPool, randomPickLabel } from "./randomCharacter";
import type { CharacterLibraryEntry } from "../../stores/characterLibraryStore";
import type { GenerationDraft } from "../../adapters/novelai/types";

vi.mock("../tags/localTagIndex", () => ({ searchLocalTags: vi.fn(async () => []) }));

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

  it("counts and draws each bookmarked character once (NAI-011: 378명 vs. far fewer)", () => {
    const entry = (raw: string, prombotFavorite?: boolean): CharacterLibraryEntry => ({
      raw, display: raw.replace(/_/g, " "), series: "s", addedAt: 1, prombotFavorite,
    });
    const entries = [
      entry("rupa_(girls_band_cry)", true),
      entry("rupa (girls band cry)", true),
      entry("Rupa_\\(girls_band_cry\\)", true),
      entry('"tharja_(""normal_girl"")_(fire_emblem)"', true),
      entry('tharja_("normal_girl")_(fire_emblem)', true),
      entry("nina_iseri", true),
      entry("manual_only"),
      entry("unstarred", false),
    ];
    const pool = randomCharacterPool(entries);
    expect(pool.map((item) => item.raw)).toEqual([
      "rupa_(girls_band_cry)",
      '"tharja_(""normal_girl"")_(fire_emblem)"',
      "nina_iseri",
    ]);
    expect(characterIdentity(entries[3])).toBe(characterIdentity(entries[4]));
    // Every draw lands inside the counted pool, and every pooled character can be drawn.
    const drawn = new Set(Array.from({ length: pool.length }, (_, i) =>
      pickRandomCharacter(entries, () => (i + 0.5) / pool.length)?.raw));
    expect(drawn).toEqual(new Set(pool.map((item) => item.raw)));
    expect(randomCharacterPool(entries.filter((item) => !item.prombotFavorite))).toEqual([]);
  });

  it("replaces only the structured character for the request and preserves its slot settings", async () => {
    const next = await applyRandomCharacter(draft, library[2]);
    expect(next.artistPrompt).toBe(draft.artistPrompt);
    expect(next.otherPrompt).toBe(draft.otherPrompt);
    expect(next.settings).toBe(draft.settings);
    expect(next.characters).toHaveLength(1);
    expect(next.characters[0]).toMatchObject({
      name: "nina",
      prompt: "nina, red dress",
      negative: "bad hands",
      position: { x: 0.3, y: 0.7 },
      enabled: true,
    });
    expect(draft.characters[0].prompt).toBe("old, red dress");
  });
});

it("keeps other slots and matches weighted, underscored identity tags without deleting actions", async () => {
  const other = { ...draft.characters[0], id: "slot-2", prompt: "other, waving" };
  const source = { ...draft, characters: [
    { ...draft.characters[0], name: "old name", prompt: "1girl, 1.2::old_name::, waving, red dress, old name cosplay" },
    other,
  ] };
  const result = await applyRandomCharacter(source, library[2]);
  expect(result.characters[0].prompt).toBe("1girl, 1.2::nina::, waving, red dress, old name cosplay");
  expect(result.characters[1]).toBe(other);
  expect(source.characters[0].prompt).toContain("old_name");
});

it("adds an identity to an action-only prompt and supports an empty slot list", async () => {
  const source = { ...draft, characters: [{ ...draft.characters[0], name: "", prompt: "1girl, waving, red dress" }] };
  expect((await applyRandomCharacter(source, library[2])).characters[0].prompt).toBe("1girl, nina, waving, red dress");
  expect((await applyRandomCharacter({ ...draft, characters: [] }, library[2])).characters[0].prompt).toBe("nina");
});

it("resolves a character from the prompt before the UI's debounced label has updated", async () => {
  const { searchLocalTags } = await import("../tags/localTagIndex");
  vi.mocked(searchLocalTags).mockResolvedValueOnce([
    { raw: "new_name", display: "new name", category: "character", count: 1 },
  ]);
  const source = { ...draft, characters: [{ ...draft.characters[0], name: "old", prompt: "new_name, waving" }] };
  expect((await applyRandomCharacter(source, library[2])).characters[0].prompt).toBe("nina, waving");
});

describe("random pick label", () => {
  it("names the character without repeating its series", () => {
    expect(randomPickLabel({ display: "nina (girls band cry)", series: "girls band cry" })).toEqual({ name: "nina", series: "girls band cry" });
    expect(randomPickLabel({ display: "iseri_nina_\\(girls_band_cry\\)", series: "Girls Band Cry" })).toEqual({ name: "iseri nina", series: "Girls Band Cry" });
  });
  it("keeps names whose brackets are not the series and hides the uncategorized folder", () => {
    expect(randomPickLabel({ display: "saber (fate)", series: "fate/stay night" })).toEqual({ name: "saber (fate)", series: "fate/stay night" });
    expect(randomPickLabel({ display: "rupa", series: "미분류" })).toEqual({ name: "rupa", series: "" });
  });
});
