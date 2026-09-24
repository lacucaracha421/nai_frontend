import { describe, expect, it } from "vitest";
import { joinPositivePrompt } from "../../../adapters/novelai/buildRequest";
import { mapNovelAiMetadata, splitBasePrompt } from "./mapNovelAiMetadata";
import { v5Comment } from "./testFixtures";

describe("Comment JSON mapping", () => {
  it("maps prompts, characters with positions and negatives, exact seed and every setting", () => {
    const loaded = mapNovelAiMetadata({ Comment: v5Comment(), Source: "NovelAI Diffusion V5 0ADF9AB7" }, { qualityPrompt: "high complexity" });
    expect(loaded).toEqual({
      artistPrompt: "artist:foo",
      otherPrompt: "1girl, solo, beach",
      qualityPrompt: "high complexity",
      negativePrompt: "worst quality, 1.5::official art ::",
      characters: [
        { prompt: "hinata natsumi, red hair", negative: "bad hands", position: { x: 0.29686946, y: 0.38612437 } },
        { prompt: "keroro", negative: "", position: { x: 0.7, y: 0.9 } },
      ],
      useCharacterCoords: true,
      settings: {
        seed: 2181637352,
        steps: 23,
        guidance: 4.5,
        guidanceRescale: 0.2,
        width: 832,
        height: 1216,
        noiseSchedule: "exponential",
        sampler: "k_dpmpp_2m",
        model: "nai-diffusion-5-full",
      },
      skipped: [],
    });
  });

  it("lists unsupported features and does not apply an unknown sampler", () => {
    const loaded = mapNovelAiMetadata(
      {
        Comment: v5Comment({
          sampler: "k_dpmpp_2s_ancestral",
          reference_information_extracted_multiple: [1],
          director_reference_descriptions: [{ caption: "x" }],
          sm: true,
          skip_cfg_above_sigma: 19,
          model_name: "NovelAI Diffusion V4.5",
        }),
      },
      { qualityPrompt: "" },
    )!;
    expect(loaded.settings.sampler).toBeUndefined();
    expect(loaded.settings.model).toBeUndefined();
    expect(loaded.skipped).toEqual([
      "샘플러 k_dpmpp_2s_ancestral",
      "모델 NovelAI Diffusion V4.5",
      "바이브 트랜스퍼",
      "캐릭터 레퍼런스",
      "SMEA",
      "Variety+",
    ]);
  });

  it("falls back to V3-style prompt/uc and to Description only", () => {
    const v3 = mapNovelAiMetadata(
      { Comment: JSON.stringify({ prompt: "cat", uc: "lowres", seed: 1, sampler: "k_euler" }) },
      { qualityPrompt: "best quality" },
    )!;
    expect(v3).toMatchObject({ otherPrompt: "cat", qualityPrompt: "", negativePrompt: "lowres", characters: [], useCharacterCoords: false });
    expect(v3.settings).toEqual({ seed: 1, sampler: "k_euler" });
    expect(mapNovelAiMetadata({ Description: "dog, park" }, { qualityPrompt: "" })).toMatchObject({ otherPrompt: "dog, park", settings: {} });
    expect(mapNovelAiMetadata({ Software: "NovelAI" }, { qualityPrompt: "" })).toBeNull();
    expect(mapNovelAiMetadata({ Comment: "not json" }, { qualityPrompt: "" })).toBeNull();
  });
});

describe("base prompt split", () => {
  it("round-trips through the app's own prompt join", () => {
    for (const [base, quality] of [
      ["1girl, solo, artist:a, artist:b, beach, high complexity", "high complexity"],
      ["1girl, year 2026, artist:mochigome02, ::, high complexity, no text", "high complexity"],
      ["1.2::artist:a ::, cat", "best quality"],
    ]) {
      const split = splitBasePrompt(base, quality);
      expect(joinPositivePrompt(split)).toBe(base);
    }
  });

  it("keeps Quality only when the image ends with it", () => {
    expect(splitBasePrompt("cat, best quality", "best quality").qualityPrompt).toBe("best quality");
    expect(splitBasePrompt("cat, masterpiece", "best quality")).toEqual({ artistPrompt: "", otherPrompt: "cat, masterpiece", qualityPrompt: "" });
  });
});
