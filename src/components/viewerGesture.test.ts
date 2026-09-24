import { describe, expect, it } from "vitest";
import { FIT, clampTransform, classifyRelease, dragMode, fittedSize, panBy, pinchTo } from "./viewerGesture";

const base = { dx: 0, dy: 0, durationMs: 120, pinched: false, zoomed: false };
const stage = { width: 800, height: 1000 };
const fitted = fittedSize({ width: 832, height: 1216 }, stage);

describe("viewer gesture state machine", () => {
  it("drags as swipe at fit, pan when zoomed, pinch with two fingers", () => {
    expect(dragMode(1, false)).toBe("swipe");
    expect(dragMode(1, true)).toBe("pan");
    expect(dragMode(2, false)).toBe("pinch");
    expect(dragMode(2, true)).toBe("pinch");
  });

  it("treats a short, still press as a tap (zoomed or not)", () => {
    expect(classifyRelease(base)).toBe("tap");
    expect(classifyRelease({ ...base, dx: 6, dy: -5, zoomed: true })).toBe("tap");
  });

  it("does not treat long presses, pinches or moves as taps", () => {
    expect(classifyRelease({ ...base, durationMs: 600 })).toBe("none");
    expect(classifyRelease({ ...base, pinched: true })).toBe("none");
    expect(classifyRelease({ ...base, dx: 30 })).toBe("none");
  });

  it("swipes and swipe-down close only at fit size", () => {
    expect(classifyRelease({ ...base, dx: -120, durationMs: 200 })).toBe("next");
    expect(classifyRelease({ ...base, dx: 120, durationMs: 200 })).toBe("previous");
    expect(classifyRelease({ ...base, dy: 150, durationMs: 200 })).toBe("close");
    expect(classifyRelease({ ...base, dx: -120, durationMs: 200, zoomed: true })).toBe("none");
    expect(classifyRelease({ ...base, dy: 150, durationMs: 200, zoomed: true })).toBe("none");
  });
});

describe("pan and zoom", () => {
  it("fits the image inside the stage", () => {
    expect(fitted.height).toBeCloseTo(1000);
    expect(fitted.width).toBeCloseTo(684.2, 1);
  });

  it("cannot pan at fit size and pans within the edges when zoomed", () => {
    expect(panBy(FIT, 100, 100, fitted, stage)).toEqual(FIT);
    const zoomed = { scale: 2, x: 0, y: 0 };
    const moved = panBy(zoomed, 50, -40, fitted, stage);
    expect(moved).toEqual({ scale: 2, x: 50, y: -40 });
    // 2× height 2000 → 500 px of travel each way; width 1368 → 284 px.
    const far = panBy(zoomed, 5000, 5000, fitted, stage);
    expect(far.x).toBeCloseTo(284.2, 1);
    expect(far.y).toBeCloseTo(500);
  });

  it("zooms around the pinch midpoint and pans with it", () => {
    const start = FIT;
    const mid = { x: 100, y: 200 };
    const zoomed = pinchTo(start, mid, mid, 2, fitted, stage);
    // The image point under the fingers stays under them.
    expect((mid.x - zoomed.x) / zoomed.scale).toBeCloseTo(mid.x);
    expect((mid.y - zoomed.y) / zoomed.scale).toBeCloseTo(mid.y);
    const moved = pinchTo(start, mid, { x: 130, y: 200 }, 2, fitted, stage);
    expect(moved.x - zoomed.x).toBeCloseTo(30);
    expect(clampTransform({ scale: 9, x: 0, y: 0 }, fitted, stage).scale).toBe(5);
    expect(pinchTo(start, mid, mid, 0.5, fitted, stage)).toEqual(FIT);
  });
});
