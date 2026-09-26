import { describe, expect, it } from "vitest";
import { estimateAnlas, formatAnlasCost, formatUsageHint, formatUsageLabel, UPSCALE_ANLAS } from "./anlas";
import type { NovelAiQuota } from "./client";

const opus = (usage: NovelAiQuota["usage"]): NovelAiQuota => ({
  anlas: 9898,
  subscriptionAnlas: 9898,
  paidAnlas: 0,
  tier: 3,
  usage,
});
const withinLimit = { percent: 72, isNegative: false, timeUntilNextPercent: 7888 };

describe("estimateAnlas", () => {
  it("is 0 only for the verified Opus free case within the V5 usage limit", () => {
    expect(estimateAnlas({ width: 832, height: 1216, steps: 28 }, opus(withinLimit))).toBe(0);
    expect(estimateAnlas({ width: 1216, height: 832, steps: 23 }, opus(withinLimit))).toBe(0);
    expect(estimateAnlas({ width: 1024, height: 1024, steps: 28 }, opus(withinLimit))).toBe(0);
  });

  it("returns null instead of inventing a price", () => {
    expect(estimateAnlas({ width: 1024, height: 1536, steps: 28 }, opus(withinLimit))).toBeNull();
    expect(estimateAnlas({ width: 832, height: 1216, steps: 29 }, opus(withinLimit))).toBeNull();
    expect(estimateAnlas({ width: 832, height: 1216, steps: 28, samples: 2 }, opus(withinLimit))).toBeNull();
    expect(estimateAnlas({ width: 832, height: 1216, steps: 28 }, opus({ ...withinLimit, isNegative: true }))).toBeNull();
    expect(estimateAnlas({ width: 832, height: 1216, steps: 28 }, opus(null))).toBeNull();
    expect(estimateAnlas({ width: 832, height: 1216, steps: 28 }, { ...opus(withinLimit), tier: 2 })).toBeNull();
    expect(estimateAnlas({ width: 832, height: 1216, steps: 28 }, null)).toBeNull();
  });

  it("formats the cost and the fixed upscale price", () => {
    expect(formatAnlasCost(0)).toBe("0 Anlas");
    expect(formatAnlasCost(null)).toBe("비용 미확인");
    expect(formatAnlasCost(UPSCALE_ANLAS)).toBe("1 Anlas");
  });
});

describe("usage limit display", () => {
  it("shows the percentage and the recharge hint", () => {
    expect(formatUsageLabel(withinLimit)).toBe("사용 한도 72%");
    expect(formatUsageHint(withinLimit)).toContain("다음 1% 회복까지 약 2시간 12분");
  });

  it("adds the implied daily rate only when it is meaningful", () => {
    expect(formatUsageHint({ percent: 50, isNegative: false, timeUntilNextPercent: 7888 })).toContain("· 하루 약 11%");
    expect(formatUsageHint({ percent: 50, isNegative: false, timeUntilNextPercent: 20_000 })).toContain("· 하루 약 4.3%");
    expect(formatUsageHint({ percent: 50, isNegative: false, timeUntilNextPercent: 600 })).not.toContain("하루");
  });

  it("shows no recovery countdown when the battery is full", () => {
    const full = { percent: 100, isNegative: false, timeUntilNextPercent: 7920 };
    expect(formatUsageLabel(full)).toBe("사용 한도 100%");
    expect(formatUsageHint(full)).toBeNull();
  });

  it("tolerates missing fields and flags a negative battery", () => {
    expect(formatUsageLabel(null)).toBeNull();
    expect(formatUsageLabel({ percent: null, isNegative: null, timeUntilNextPercent: null })).toBeNull();
    expect(formatUsageHint({ percent: 50, isNegative: null, timeUntilNextPercent: null })).toBeNull();
    const negative = { percent: 0, isNegative: true, timeUntilNextPercent: 90 };
    expect(formatUsageLabel(negative)).toBe("사용 한도 초과");
    expect(formatUsageHint(negative)).toBe("V5 사용 한도를 넘어 생성마다 Anlas가 차감됩니다 · 다음 1% 회복까지 약 2분");
  });
});
