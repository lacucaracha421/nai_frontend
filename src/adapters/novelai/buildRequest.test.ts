import { describe, expect, it } from "vitest";
import { activeReferenceImages, buildNovelAiRequest } from "./buildRequest";
import type { GenerationDraft } from "./types";
import type { PreciseReference } from "../../types/generation";

const baseDraft: GenerationDraft = {
  artistPrompt: "artist:test",
  otherPrompt: "1girl, outdoors",
  qualityPrompt: "high complexity",
  negativePrompt: "lowres",
  characters: [],
  useCharacterCoords: false,
  settings: {
    model: "nai-diffusion-5-full",
    width: 832,
    height: 1216,
    steps: 28,
    guidance: 5,
    guidanceRescale: 0.15,
    sampler: "k_euler_ancestral",
    noiseSchedule: "karras",
    seed: null,
  },
};

const makeRef = (overrides: Partial<PreciseReference>): PreciseReference => ({
  id: "ref-1",
  previewUrl: "blob:preview",
  pngBase64: "iVBORw0KGgo=",
  cacheSecretKey: "e58f907c7e5ae0902238a6ee5af31e59d060633c2b972858677f5a241ff896df",
  mode: "character&style",
  preferSameOutfit: true,
  strength: 1,
  enabled: true,
  ...overrides,
});

describe("buildNovelAiRequest with Precise Reference", () => {
  it("omits director reference fields when no references are enabled", () => {
    const req = buildNovelAiRequest({
      ...baseDraft,
      references: [makeRef({ enabled: false })],
    });
    expect(req.parameters.director_reference_descriptions).toBeUndefined();
    expect(req.parameters.director_reference_images_cached).toBeUndefined();
    expect(req.parameters.normalize_reference_strength_multiple).toBeUndefined();
    expect(activeReferenceImages({ references: [makeRef({ enabled: false })] })).toEqual([]);
  });

  it("matches NovelAI V5 payload fields across modes and preferSameOutfit states", () => {
    const refs: PreciseReference[] = [
      makeRef({ id: "r0", mode: "character&style", preferSameOutfit: true, strength: 1, pngBase64: "AAA" }),
      makeRef({ id: "r1", mode: "character", preferSameOutfit: false, strength: 0.75, pngBase64: "BBB", cacheSecretKey: "1111" }),
      makeRef({ id: "r2", enabled: false, mode: "outfit", pngBase64: "SKIP" }),
      makeRef({ id: "r3", mode: "style", preferSameOutfit: false, strength: 0.6, pngBase64: "CCC", cacheSecretKey: "2222" }),
      makeRef({ id: "r4", mode: "outfit", preferSameOutfit: false, strength: 0.9, pngBase64: "DDD", cacheSecretKey: "3333" }),
    ];
    const req = buildNovelAiRequest({ ...baseDraft, references: refs });
    expect(req.parameters.normalize_reference_strength_multiple).toBe(true);
    expect(req.parameters.director_reference_descriptions).toEqual([
      { caption: { base_caption: "character&style", char_captions: [] }, legacy_uc: false },
      { caption: { base_caption: "character", char_captions: [] }, legacy_uc: false },
      { caption: { base_caption: "style", char_captions: [] }, legacy_uc: false },
      { caption: { base_caption: "outfit", char_captions: [] }, legacy_uc: false },
    ]);
    expect(req.parameters.director_reference_information_extracted).toEqual([1, 1, 1, 1]);
    expect(req.parameters.director_reference_strength_values).toEqual([1, 0.75, 0.6, 0.9]);
    expect(req.parameters.director_reference_secondary_strength_values).toEqual([0, 1, 0, 0]);
    expect(req.parameters.director_reference_images_cached).toEqual([
      { cache_secret_key: refs[0].cacheSecretKey, data: "director_ref_0" },
      { cache_secret_key: "1111", data: "director_ref_1" },
      { cache_secret_key: "2222", data: "director_ref_2" },
      { cache_secret_key: "3333", data: "director_ref_3" },
    ]);
    expect(activeReferenceImages({ references: refs })).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });
});
