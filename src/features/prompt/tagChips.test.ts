import { describe, expect, it } from "vitest";
import {
  adjustTagWeightAt,
  formatTagDiff,
  insertTagsAt,
  moveTagAt,
  promptTagDiff,
  removeTagAt,
  replaceTagAt,
  splitTags,
  tagWeight,
  withWeightOf,
} from "./tagChips";

const value = "1girl, solo,\nsoft smile, backlight";

describe("tag chip bubble operations", () => {
  it("splits on commas and newlines", () => {
    expect(splitTags(value)).toEqual(["1girl", "solo", "soft smile", "backlight"]);
  });

  it("keeps weight groups and brackets with commas as one chip", () => {
    expect(splitTags("a, 1.2::b, c ::, d")).toEqual(["a", "1.2::b, c ::", "d"]);
    expect(splitTags("{x, y}, [z, w], (p, q), r")).toEqual(["{x, y}", "[z, w]", "(p, q)", "r"]);
    expect(splitTags("artist:toma, 0.8::a ::")).toEqual(["artist:toma", "0.8::a ::"]);
    // An unclosed group keeps the rest together instead of splitting it wrongly.
    expect(splitTags("a, {b, c")).toEqual(["a", "{b, c"]);
  });

  it("raises and lowers one tag's weight with the existing syntax", () => {
    const up = adjustTagWeightAt(value, 2, 0.1);
    expect(up).toBe("1girl, solo,\n1.1::soft smile ::, backlight");
    expect(tagWeight(splitTags(up)[2])).toEqual({ weight: 1.1, content: "soft smile", weighted: true });
    expect(adjustTagWeightAt(up, 2, -0.1)).toBe(value);
    expect(adjustTagWeightAt(value, 0, -0.1)).toBe("0.9::1girl ::, solo,\nsoft smile, backlight");
  });

  it("weights, moves and deletes a group as a whole", () => {
    const text = "a, 1.2::b, c ::, d";
    expect(adjustTagWeightAt(text, 1, 0.1)).toBe("a, 1.3::b, c ::, d");
    expect(moveTagAt(text, 1, 1)).toBe("a, d, 1.2::b, c ::");
    expect(removeTagAt(text, 1)).toBe("a, d");
  });

  it("moves a tag one place and keeps separators and line breaks", () => {
    expect(moveTagAt(value, 1, -1)).toBe("solo, 1girl,\nsoft smile, backlight");
    expect(moveTagAt(value, 1, 1)).toBe("1girl, soft smile,\nsolo, backlight");
    expect(moveTagAt(value, 0, -1)).toBe(value);
    expect(moveTagAt(value, 3, 1)).toBe(value);
  });

  it("deletes one tag without touching the rest", () => {
    expect(removeTagAt(value, 1)).toBe("1girl, soft smile, backlight");
    expect(removeTagAt(value, 3)).toBe("1girl, solo,\nsoft smile");
    expect(removeTagAt("only", 0)).toBe("");
    expect(removeTagAt(value, 9)).toBe(value);
  });

  it("edits a tag in place, splitting commas and removing on empty text", () => {
    expect(replaceTagAt(value, 3, "rim light")).toBe("1girl, solo,\nsoft smile, rim light");
    expect(replaceTagAt(value, 1, "smile, blush")).toBe("1girl, smile, blush,\nsoft smile, backlight");
    expect(replaceTagAt(value, 1, "  ")).toBe("1girl, soft smile, backlight");
  });

  it("adds typed tags at the end or before a tag", () => {
    expect(insertTagsAt(value, "petals, wind")).toBe("1girl, solo,\nsoft smile, backlight, petals, wind");
    expect(insertTagsAt(value, "petals", 1)).toBe("1girl, petals, solo,\nsoft smile, backlight");
    expect(insertTagsAt("", "a")).toBe("a");
    expect(insertTagsAt(value, " , ")).toBe(value);
  });

  it("keeps the weight when a weighted tag's text is replaced", () => {
    expect(withWeightOf("1.2::웃음 ::", "smile")).toBe("1.2::smile ::");
    expect(withWeightOf("웃음", "smile")).toBe("smile");
  });
});

describe("previous-generation tag diff", () => {
  it("is null without a previous prompt", () => {
    expect(promptTagDiff(null, "a, b")).toBeNull();
    expect(formatTagDiff(null)).toBeNull();
  });

  it("lists added and removed tags ignoring order, case and underscores", () => {
    const diff = promptTagDiff("1girl, night, city_lights, smile", "1girl, Smile, backlight, 1.2::soft smile ::");
    expect(diff).toEqual({ added: ["backlight", "1.2::soft smile ::"], removed: ["night", "city_lights"] });
    expect(formatTagDiff(diff)).toBe("+2 −2");
  });

  it("counts duplicates and reports no change as null label", () => {
    expect(promptTagDiff("a, a, b", "a, b")).toEqual({ added: [], removed: ["a"] });
    expect(formatTagDiff(promptTagDiff("a, b", "b, a"))).toBeNull();
  });
});

describe("typing separators", () => {
  it("finds only separators outside groups", async () => {
    const { topLevelSeparators } = await import("./tagChips");
    expect(topLevelSeparators("a, 1.2::b, c")).toEqual([1]);
    expect(topLevelSeparators("a, 1.2::b, c ::,")).toEqual([1, 15]);
    expect(topLevelSeparators("{x, y")).toEqual([]);
  });
});
