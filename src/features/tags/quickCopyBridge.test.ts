import { describe, expect, it } from "vitest";
import { exactArtistTag, quickCopyInsertion } from "./quickCopyBridge";

describe("quick copy bridge", () => {
  it("adds artist prefix exactly once for artist entries", () => {
    expect(quickCopyInsertion({ text: "toma", kind: "artist" }, true)).toBe("artist:toma");
    expect(quickCopyInsertion({ text: "artist:toma", kind: "artist" }, true)).toBe("artist:toma");
    expect(quickCopyInsertion({ text: "artist\\:toma", kind: "artist" }, true)).toBe("artist\\:toma");
  });

  it("does not prefix artist-list presets or non-artist tags", () => {
    expect(quickCopyInsertion({ text: "year 2026, artist:toma", kind: "artist" }, false)).toBe("year 2026, artist:toma");
    expect(quickCopyInsertion({ text: "toon (style)", kind: "artist" }, false)).toBe("toon (style)");
  });

  it("confirms artist type from an exact local tag match", () => {
    const rows = [
      { raw: "toma", display: "toma", category: "artist" as const, count: 10 },
      { raw: "toon_(style)", display: "toon (style)", category: "general" as const, count: 20 },
    ];
    expect(exactArtistTag("toma", rows)).toBe(true);
    expect(exactArtistTag("artist:toma", rows)).toBe(true);
    expect(exactArtistTag("toon (style)", rows)).toBe(false);
    expect(exactArtistTag("year 2026, artist:toma", rows)).toBe(false);
  });
});
