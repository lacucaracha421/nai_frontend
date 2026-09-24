import type { NovelAiQuota, NovelAiUsage } from "./client";

/** NovelAI subscription tier number for Opus. */
export const OPUS_TIER = 3;
/** Opus free-generation limits (one image, "Normal" size class, ≤ 28 steps). */
export const OPUS_FREE_MAX_PIXELS = 1024 * 1024;
export const OPUS_FREE_MAX_STEPS = 28;
export const OPUS_FREE_MAX_SAMPLES = 1;
/** The site's fixed 2× upscale. */
export const UPSCALE_ANLAS = 1;

export type AnlasEstimateInput = {
  width: number;
  height: number;
  steps: number;
  samples?: number;
};

/**
 * Anlas cost of one generation, or `null` when it is not known.
 *
 * Only the case verified for V5 is answered: Opus, within the V5 usage limit,
 * one image of Normal size or smaller with ≤ 28 steps costs 0. Everything
 * else (other tiers, past the usage limit, larger images, more steps) has no
 * published V5 formula, so no number is invented.
 */
export function estimateAnlas(input: AnlasEstimateInput, quota: NovelAiQuota | null | undefined): number | null {
  if (!quota || quota.tier !== OPUS_TIER) return null;
  if (!isWithinUsageLimit(quota.usage)) return null;
  const samples = input.samples ?? 1;
  if (
    samples <= OPUS_FREE_MAX_SAMPLES &&
    input.width * input.height <= OPUS_FREE_MAX_PIXELS &&
    input.steps <= OPUS_FREE_MAX_STEPS
  ) {
    return 0;
  }
  return null;
}

export function isWithinUsageLimit(usage: NovelAiUsage | null | undefined) {
  if (!usage) return false;
  if (usage.isNegative === true) return false;
  if (usage.isNegative === false) return true;
  return typeof usage.percent === "number" && usage.percent > 0;
}

export function formatAnlasCost(cost: number | null) {
  return cost === null ? "비용 미확인" : `${cost.toLocaleString()} Anlas`;
}

/** "사용 한도 72%" pill text, or null when the account has no usage data. */
export function formatUsageLabel(usage: NovelAiUsage | null | undefined) {
  if (!usage) return null;
  if (usage.isNegative === true) return "사용 한도 초과";
  if (typeof usage.percent !== "number") return null;
  return `사용 한도 ${Math.round(usage.percent)}%`;
}

/** Tooltip/hint for the usage pill. `timeUntilNextPercent` is assumed to be seconds. */
export function formatUsageHint(
  usage: NovelAiUsage | null | undefined,
  receivedAt: number | null = null,
  now = Date.now(),
) {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.isNegative === true) parts.push("V5 사용 한도를 넘어 생성마다 Anlas가 차감됩니다");
  // A full battery has nothing to recover; NovelAI still reports a fixed per-percent
  // interval there, which would otherwise sit on screen unchanged.
  const full = usage.isNegative !== true && typeof usage.percent === "number" && usage.percent >= 100;
  const duration = usage.timeUntilNextPercent;
  if (!full && typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const seconds = Math.max(0, duration - (receivedAt === null ? 0 : Math.max(0, now - receivedAt) / 1000));
    if (seconds === 0) {
      parts.push("회복 시간 도달 · 갱신 대기");
    } else {
      const totalMinutes = Math.ceil(seconds / 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const span = hours > 0 ? `${hours}시간${minutes ? ` ${minutes}분` : ""}` : `${minutes}분`;
      parts.push(`다음 1% 회복까지 약 ${span}`);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}
