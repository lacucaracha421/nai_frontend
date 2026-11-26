import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUICKCOPY_STORAGE_KEY,
  readQuickCopyData,
  saveArtistPreset,
  saveSectionPreset,
} from "./quickCopyStorage";

describe("saveArtistPreset & saveSectionPreset", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepends a new artist combination as an unpinned entry with optional title", () => {
    const res = saveArtistPreset("artist:foo, 0.8::artist:bar::", "몽환 조합");
    expect(res.status).toBe("saved");
    expect(res.entry).toMatchObject({
      name: "artist:foo, 0.8::artist:bar::",
      title: "몽환 조합",
      pinned: false,
    });

    const stored = readQuickCopyData();
    expect(stored.artists[0]).toMatchObject({
      name: "artist:foo, 0.8::artist:bar::",
      title: "몽환 조합",
      pinned: false,
    });
  });

  it("auto-names blank artist presets sequentially and detects duplicates across formatting", () => {
    const first = saveArtistPreset("artist:alpha, artist:beta");
    expect(first.status).toBe("saved");
    expect(first.entry?.title).toBe("새 작가(1)");

    const second = saveArtistPreset("artist:gamma, artist:delta");
    expect(second.status).toBe("saved");
    expect(second.entry?.title).toBe("새 작가(2)");

    const dup = saveArtistPreset("artist:alpha,  artist:beta ");
    expect(dup.status).toBe("duplicate");
    expect(JSON.parse(store.get(QUICKCOPY_STORAGE_KEY)!).artists[1].name).toBe("artist:alpha, artist:beta");
  });

  it("updates the title when saving an already-stored artist combination with a new title", () => {
    saveArtistPreset("artist:alpha, artist:beta");
    const updated = saveArtistPreset("artist:alpha, artist:beta", "수채화 믹스");
    expect(updated.status).toBe("updated");
    expect(updated.entry?.title).toBe("수채화 믹스");
    expect(readQuickCopyData().artists[0].title).toBe("수채화 믹스");
  });

  it("saves scene presets to actions under '장면' category with auto-numbering when blank", () => {
    const unnamed1 = saveSectionPreset("other", "sunset, beach, ocean");
    expect(unnamed1).toEqual({ status: "saved", targetLabel: "행동", title: "새 행동(1)" });

    const unnamed2 = saveSectionPreset("other", "rain, umbrella, night");
    expect(unnamed2).toEqual({ status: "saved", targetLabel: "행동", title: "새 행동(2)" });

    const named = saveSectionPreset("other", "cafe, window light", "카페 창가");
    expect(named).toEqual({ status: "saved", targetLabel: "행동", title: "카페 창가" });

    expect(readQuickCopyData().actions[2]).toMatchObject({
      title: "새 행동(1)",
      prompt: "sunset, beach, ocean",
      category: "장면",
      pinned: false,
    });

    const dup = saveSectionPreset("other", "sunset,  beach, ocean");
    expect(dup.status).toBe("duplicate");
  });

  it("saves quality and negative presets to tags with auto-names while preserving default tags", () => {
    const defaults = [{ title: "로우 앵글", category: "시점", prompt: "from below", pinned: false }];
    const qualityRes = saveSectionPreset("quality", "masterpiece, best quality", "기본 품질", defaults);
    expect(qualityRes).toEqual({ status: "saved", targetLabel: "구도", title: "기본 품질" });

    const negativeRes = saveSectionPreset("negative", "blurry, lowres", "");
    expect(negativeRes).toEqual({ status: "saved", targetLabel: "구도", title: "새 제외(1)" });

    const stored = readQuickCopyData();
    expect(stored.tags.map((t) => [t.category, t.title, t.prompt])).toEqual([
      ["제외", "새 제외(1)", "blurry, lowres"],
      ["품질", "기본 품질", "masterpiece, best quality"],
      ["시점", "로우 앵글", "from below"],
    ]);
  });

  it("returns empty for blank input", () => {
    expect(saveArtistPreset(" ,  ")).toEqual({ status: "empty" });
    expect(saveSectionPreset("other", " , ")).toEqual({ status: "empty", targetLabel: "행동" });
  });
});
