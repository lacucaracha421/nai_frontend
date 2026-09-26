import { EMPTY_USAGE_TRACK, loadUsageTrack, trackUsage } from "../../stores/connectionStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchQuotaClock } from "./useQuotaClock";
import { formatUsageHint } from "../../adapters/novelai/anlas";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("ticks elapsed wall time, polls, catches up on Android resume and cleans up", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  const refresh = vi.fn(async () => {});
  const tick = vi.fn();
  const stop = watchQuotaClock(tick, refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(tick).toHaveBeenLastCalledWith(1_060_000);
  doc.visibilityState = "hidden";
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.setSystemTime(2_000_000);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(tick).toHaveBeenLastCalledWith(2_000_000);
  expect(refresh).toHaveBeenCalledTimes(3);
  win.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(4);
  stop();
  tick.mockClear();
  vi.advanceTimersByTime(60_000);
  win.dispatchEvent(new Event("focus"));
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(tick).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(4);
});

describe("usage countdown", () => {
  const usage = { percent: 72, isNegative: false, timeUntilNextPercent: 120 };
  it("counts down between replies and does not invent a recovered percentage at expiry", () => {
    expect(formatUsageHint(usage, 1000, 1000)).toContain("2분");
    expect(formatUsageHint(usage, 1000, 61_000)).toContain("1분");
    expect(formatUsageHint(usage, 1000, 121_000)).toBe("회복 시간 도달 · 갱신 대기 · 가득 차기까지 약 54분");
    expect(formatUsageHint(usage, 1000, 999_000)).toContain("회복 시간 도달 · 갱신 대기");
    expect(usage.percent).toBe(72);
  });
  it("handles hour rollover without displaying 1 hour 60 minutes", () => {
    expect(formatUsageHint({ ...usage, timeUntilNextPercent: 7199 })).toContain("2시간");
  });
});

describe("usage recovery interval (value does not count down)", () => {
  const usage = { percent: 72, isNegative: false, timeUntilNextPercent: 7888 };
  it("shows the per-percent rate until a rise is seen, then counts from the rise", () => {
    const flat = { countdown: false, risenAt: null };
    expect(formatUsageHint(usage, 1000, 61_000, flat)).toBe("1% 회복에 약 2시간 12분 · 가득 차기까지 최대 약 2일 13시간 · 하루 약 11%");
    const risen = { countdown: false, risenAt: 0 };
    expect(formatUsageHint(usage, 60_000, 3_600_000, risen)).toContain("다음 1% 회복까지 약 1시간 12분");
    expect(formatUsageHint(usage, 60_000, 7_888_000 + 60_000, risen)).toContain("다음 1% 회복까지 약 2시간 11분");
  });
  it("keeps the countdown once the value was seen counting down", () => {
    expect(formatUsageHint({ ...usage, timeUntilNextPercent: 120 }, 1000, 61_000, { countdown: true, risenAt: null })).toContain("1분");
  });
});

describe("trackUsage", () => {
  const quota = (percent: number, seconds: number) =>
    ({ anlas: null, subscriptionAnlas: null, paidAnlas: null, tier: null, usage: { percent, isNegative: false, timeUntilNextPercent: seconds } });
  it("detects a countdown and a percentage rise across polls", () => {
    let track = trackUsage(EMPTY_USAGE_TRACK, quota(72, 7888), 0);
    track = trackUsage(track, quota(72, 7888), 60_000);
    expect(track).toMatchObject({ countdown: false, risenAt: null });
    track = trackUsage(track, quota(73, 7888), 120_000);
    expect(track.risenAt).toBe(120_000);
    expect(trackUsage(track, quota(73, 7800), 180_000).countdown).toBe(true);
  });
});

describe("usage time to full and persisted rise", () => {
  it("adds the time until 100 % and nothing at a full battery", () => {
    const at99 = { percent: 99, isNegative: false, timeUntilNextPercent: 7888 };
    // One percent missing: the next percent is the full battery, so the time is said once.
    expect(formatUsageHint(at99, 0, 0, { countdown: false, risenAt: null })).toBe("가득 차기까지 최대 약 2시간 12분 · 하루 약 11%");
    expect(formatUsageHint(at99, 0, 3_600_000, { countdown: false, risenAt: 0 })).toBe("가득 차기까지 약 1시간 12분 · 하루 약 11%");
    expect(formatUsageHint({ ...at99, timeUntilNextPercent: 3600 }, 0, 600_000)).toBe("가득 차기까지 약 50분 · 하루 약 24%");
    expect(formatUsageHint({ ...at99, percent: 98.5 }, 0, 0, { countdown: false, risenAt: 0 }))
      .toBe("다음 1% 회복까지 약 2시간 12분 · 가득 차기까지 약 4시간 23분 · 하루 약 11%");
    expect(formatUsageHint({ ...at99, percent: 100 }, 0, 0, { countdown: false, risenAt: null })).toBeNull();
  });
  it("keeps the rise across a restart but does not time a rise seen after a long gap", () => {
    const quota = (percent: number) => ({ anlas: null, subscriptionAnlas: null, paidAnlas: null, tier: null, usage: { percent, isNegative: false, timeUntilNextPercent: 7888 } });
    const stored = new Map<string, string>();
    const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
    stored.set("nai-v5-usage-track", JSON.stringify({ percent: 73, risenAt: 5_000, at: 6_000 }));
    const restored = loadUsageTrack(storage);
    expect(restored).toMatchObject({ percent: 73, risenAt: 5_000 });
    // Reopened hours later at a higher percent: the rise time is unknown, keep the anchor.
    expect(trackUsage(restored, quota(75), 10_000_000).risenAt).toBe(5_000);
    // Leaving 100 % between close polls starts a new interval.
    const full = trackUsage(EMPTY_USAGE_TRACK, quota(100), 0);
    expect(trackUsage(full, quota(99), 60_000).risenAt).toBe(60_000);
  });
});
