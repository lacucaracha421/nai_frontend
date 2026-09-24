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
    expect(formatUsageHint(usage, 1000, 121_000)).toBe("회복 시간 도달 · 갱신 대기");
    expect(formatUsageHint(usage, 1000, 999_000)).toBe("회복 시간 도달 · 갱신 대기");
    expect(usage.percent).toBe(72);
  });
  it("handles hour rollover without displaying 1 hour 60 minutes", () => {
    expect(formatUsageHint({ ...usage, timeUntilNextPercent: 7199 })).toContain("2시간");
  });
});
