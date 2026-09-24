import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerationStore } from "./generationStore";
import { useCharacterLibraryStore } from "./characterLibraryStore";
import { generateNovelAiImage, upscaleNovelAiImage } from "../adapters/novelai/client";
import { buildNovelAiRequest } from "../adapters/novelai/buildRequest";

vi.mock("../adapters/novelai/client", () => ({
  generateNovelAiImage: vi.fn(),
  cachedImageSrc: (path: string) => path,
  upscaleNovelAiImage: vi.fn(),
}));

vi.mock("../features/tags/localTagIndex", () => ({ searchLocalTags: vi.fn(async () => []) }));

beforeEach(() => {
  vi.clearAllMocks();
  useGenerationStore.setState(useGenerationStore.getInitialState(), true);
  useCharacterLibraryStore.setState({ entries: [
    { raw: "manual", display: "manual", series: "folder", addedAt: 1 },
    { raw: "a", display: "A", series: "series", addedAt: 2, prombotFavorite: true },
    { raw: "b", display: "B", series: "series", addedAt: 3, prombotFavorite: true },
  ] });
  vi.mocked(generateNovelAiImage).mockResolvedValue([
    { path: "fixture.png", index: 0, seed: 1, width: 832, height: 1216 },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("random character requests", () => {
  it("draws on each Generate and changes only request characters, preserving saved editor state", async () => {
    useGenerationStore.setState({
      artistPrompt: "artist:test", otherPrompt: "1girl, outdoors", qualityPrompt: "best quality",
      negativePrompt: "bad quality", randomCharacterEnabled: true, useCharacterCoords: true,
      characters: [{ id: "saved", name: "Saved", prompt: "saved, red dress", negative: "bad hands",
        enabled: true, position: { x: 0.2, y: 0.8 } }],
    });
    const saved = useGenerationStore.getState();
    const baseline = buildNovelAiRequest(saved);
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    await saved.generate();
    await saved.generate();
    const requests = vi.mocked(generateNovelAiImage).mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    for (const [index, name] of ["A", "B"].entries()) {
      const expected = structuredClone(baseline);
      expected.parameters.v4_prompt.caption.char_captions[0].char_caption = `${name}, red dress`;
      expect(requests[index]).toEqual(expected);
    }
    expect(random).toHaveBeenCalledTimes(2);
    const current = useGenerationStore.getState();
    expect(current.characters).toBe(saved.characters);
    expect(current.settings).toBe(saved.settings);
    expect(buildNovelAiRequest(current)).toEqual(baseline);
    expect(current.lastRandomCharacter).toBe("B");
  });

  it("refuses to enable with an empty pool but always allows turning mode off", () => {
    useCharacterLibraryStore.setState({ entries: [] });
    useGenerationStore.getState().setRandomCharacterEnabled(true);
    expect(useGenerationStore.getState().randomCharacterEnabled).toBe(false);
    useGenerationStore.setState({ randomCharacterEnabled: true });
    useGenerationStore.getState().setRandomCharacterEnabled(false);
    expect(useGenerationStore.getState().randomCharacterEnabled).toBe(false);
  });

  it("uses the current pool and blocks a persisted mode when favorites are gone", async () => {
    useGenerationStore.setState({ randomCharacterEnabled: true });
    useCharacterLibraryStore.setState({ entries: [] });
    await useGenerationStore.getState().generate();
    expect(generateNovelAiImage).not.toHaveBeenCalled();
    expect(useGenerationStore.getState().errorMessage).toContain("Prombot");
  });
});

describe("upscale from the viewer", () => {
  it("upscales the image at the given index, not the current one", async () => {
    const image = (path: string) => ({ src: path, filePath: path, index: 0, seed: 7, width: 832, height: 1216,
      positivePrompt: path, kind: "generation" as const, createdAt: 1 });
    useGenerationStore.setState({ images: [image("old.png"), image("current.png")], activeImage: 1 });
    vi.mocked(upscaleNovelAiImage).mockResolvedValue([{ path: "up.png", index: 0, seed: 7, width: 1664, height: 2432 }]);
    await useGenerationStore.getState().upscaleActive(0);
    expect(upscaleNovelAiImage).toHaveBeenCalledWith("old.png");
    const state = useGenerationStore.getState();
    expect(state.images.at(-1)).toMatchObject({ filePath: "up.png", kind: "upscale", positivePrompt: "old.png" });
    expect(state.activeImage).toBe(2);
  });
});
