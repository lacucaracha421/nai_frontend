import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerationStore } from "../../../stores/generationStore";
import { loadImageIntoStudio, undoImageLoad } from "./loadImage";
import { pngWithText, v5Comment } from "./testFixtures";

vi.mock("../../../adapters/novelai/client", () => ({
  generateNovelAiImage: vi.fn(),
  cachedImageSrc: (path: string) => path,
  upscaleNovelAiImage: vi.fn(),
}));

const noStealth = async () => null;

beforeEach(() => {
  useGenerationStore.setState(useGenerationStore.getInitialState(), true);
  useGenerationStore.setState({
    artistPrompt: "artist:mine",
    otherPrompt: "1boy, forest",
    negativePrompt: "blurry",
    randomCharacterEnabled: true,
    characters: [{ id: "c1", name: "Mine", prompt: "mine", negative: "", enabled: true, position: { x: 0.1, y: 0.1 } }],
  });
});

describe("loading an image into the studio", () => {
  it("applies immediately with a fixed seed, and undo restores the previous state", async () => {
    const before = useGenerationStore.getState();
    expect(before.settings.seed).toBeNull();
    const png = await pngWithText([{ type: "tEXt", keyword: "Comment", text: v5Comment() }]);
    const outcome = await loadImageIntoStudio(png, noStealth);
    expect(outcome).toMatchObject({ kind: "applied", source: "png-text", skipped: [] });

    const after = useGenerationStore.getState();
    expect(after.settings).toMatchObject({ seed: 2181637352, steps: 23, guidance: 4.5, sampler: "k_dpmpp_2m", width: 832, height: 1216 });
    expect(after.artistPrompt).toBe("artist:foo");
    expect(after.randomCharacterEnabled).toBe(false);
    expect(after.useCharacterCoords).toBe(true);
    expect(after.characters.map((c) => [c.prompt, c.negative, c.position, c.enabled])).toEqual([
      ["hinata natsumi, red hair", "bad hands", { x: 0.29686946, y: 0.38612437 }, true],
      ["keroro", "", { x: 0.7, y: 0.9 }, true],
    ]);
    expect(new Set(after.characters.map((c) => c.id)).size).toBe(2);

    if (outcome.kind !== "applied") throw new Error("expected applied");
    undoImageLoad(outcome.snapshot);
    const restored = useGenerationStore.getState();
    for (const key of ["artistPrompt", "otherPrompt", "qualityPrompt", "negativePrompt", "characters", "useCharacterCoords", "randomCharacterEnabled", "settings"] as const) {
      expect(restored[key]).toEqual(before[key]);
    }
  });

  it("leaves the state untouched when the image has no NovelAI information", async () => {
    const before = useGenerationStore.getState();
    const outcome = await loadImageIntoStudio(await pngWithText([{ type: "tEXt", keyword: "Software", text: "GIMP" }]), noStealth);
    expect(outcome).toEqual({ kind: "none" });
    expect(useGenerationStore.getState().artistPrompt).toBe(before.artistPrompt);
    expect(useGenerationStore.getState().settings).toBe(before.settings);
  });

  it("uses one empty character slot when the image has no characters", async () => {
    const png = await pngWithText([{ type: "tEXt", keyword: "Comment", text: JSON.stringify({ prompt: "cat", seed: 3 }) }]);
    await loadImageIntoStudio(png, noStealth);
    const state = useGenerationStore.getState();
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0].prompt).toBe("");
    expect(state.settings.seed).toBe(3);
  });
});
