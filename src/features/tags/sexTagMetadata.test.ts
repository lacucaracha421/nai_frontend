import { describe, expect, it } from "vitest";
import { classifySexTag } from "./sexTagMetadata";

describe("classifySexTag", () => {
  it("classifies core positions under 체위 with Korean labels even when acts appears first", () => {
    expect(
      classifySexTag({
        raw: "sex from behind",
        display: "sex from behind",
        count: 77879,
        groups: ["acts", "core", "positions"],
        actGroups: ["other"],
        positionGroups: ["rear"],
      }),
    ).toEqual({ title: "후배위", category: "체위", isNoise: false });
  });

  it("classifies act groups cleanly into Korean categories", () => {
    expect(
      classifySexTag({ raw: "paizuri", display: "paizuri", count: 48105, groups: ["acts", "core"], actGroups: ["breast"] }),
    ).toEqual({ title: "파이즈리", category: "가슴", isNoise: false });

    expect(
      classifySexTag({ raw: "cum in pussy", display: "cum in pussy", count: 118205, groups: ["acts"], actGroups: ["fluids"] }),
    ).toEqual({ title: "질내 사정", category: "체액", isNoise: false });

    expect(
      classifySexTag({ raw: "sex", display: "sex", count: 314574, groups: ["acts", "positions"], actGroups: ["penetration"] }),
    ).toEqual({ title: "섹스", category: "삽입", isNoise: false });
  });

  it("demotes wiki-scrape noise tags to 기타", () => {
    expect(
      classifySexTag({ raw: "tail", display: "tail", count: 939268, groups: ["acts"], actGroups: ["other"] }),
    ).toEqual({ title: "tail", category: "기타", isNoise: true });
  });
});
