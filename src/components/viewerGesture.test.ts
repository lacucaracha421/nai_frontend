import { describe, expect, it } from "vitest";
import {
  FIT,
  ViewerGestureTracker,
  clampTransform,
  classifyRelease,
  dragMode,
  fittedSize,
  isZoomed,
  panBy,
  pinchTo,
} from "./viewerGesture";

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

describe("viewer tracker: tapping a zoomed image (NAI-011)", () => {
  const geometry = { stage, fitted, centre: { x: 400, y: 500 } };
  const at = (id: number, x: number, y: number, time: number, primary = false) => ({ id, x, y, time, primary });

  /** Two-finger pinch that ends zoomed in (~2.3×); fingers lift one after the other. */
  function zoomIn(tracker: ViewerGestureTracker, t = 0, liftSecond = true) {
    tracker.down(at(1, 300, 500, t, true), geometry);
    tracker.down(at(2, 500, 500, t + 20), geometry);
    for (let step = 1; step <= 5; step += 1) {
      tracker.move(at(1, 300 - step * 30, 500, t + 20 + step * 16), geometry);
      tracker.move(at(2, 500 + step * 30, 500, t + 28 + step * 16), geometry);
    }
    expect(tracker.end(at(1, 150, 500, t + 140), geometry)).toBe("none");
    if (liftSecond) expect(tracker.end(at(2, 650, 500, t + 180), geometry)).toBe("none");
    expect(isZoomed(tracker.transform)).toBe(true);
    expect(tracker.active).toBe(!liftSecond);
  }

  it("fits again after a slightly slow, slightly wobbly tap, without nudging the image first", () => {
    const tracker = new ViewerGestureTracker();
    zoomIn(tracker);
    const zoomed = tracker.transform;
    // A natural finger tap on the tablet: ~8 px of wobble, released after 380 ms.
    tracker.down(at(3, 420, 610, 1000, true), geometry);
    expect(tracker.move(at(3, 426, 614, 1100), geometry)).toBe(false);
    expect(tracker.move(at(3, 427, 616, 1250), geometry)).toBe(false);
    expect(tracker.transform).toBe(zoomed);
    expect(tracker.end(at(3, 427, 616, 1380), geometry)).toBe("fit");
    expect(tracker.transform).toEqual(FIT);
    expect(tracker.active).toBe(false);
  });

  it("recovers when a finger's pointerup never arrived (ghost finger)", () => {
    const tracker = new ViewerGestureTracker();
    zoomIn(tracker, 0, false); // finger 2's pointerup is lost
    // The next tap is a new primary pointer: it must not pinch against the ghost.
    tracker.down(at(3, 420, 610, 1000, true), geometry);
    const before = tracker.transform;
    expect(tracker.move(at(3, 424, 612, 1060), geometry)).toBe(false);
    expect(tracker.transform).toBe(before);
    expect(tracker.end(at(3, 424, 612, 1120), geometry)).toBe("fit");
    expect(tracker.transform).toEqual(FIT);
    expect(tracker.active).toBe(false);
    // The late event for the ghost does nothing.
    expect(tracker.end(at(2, 650, 500, 1200), geometry)).toBe("none");
    expect(tracker.transform).toEqual(FIT);
  });

  it("ignores events of unknown fingers during a tap", () => {
    const tracker = new ViewerGestureTracker();
    zoomIn(tracker);
    tracker.down(at(3, 420, 610, 1000, true), geometry);
    expect(tracker.end(at(99, 10, 10, 1050), geometry)).toBe("none");
    expect(tracker.end(at(3, 420, 610, 1100), geometry)).toBe("fit");
  });

  it("pans only past the tap slop, without a jump, and stays zoomed after a pan", () => {
    const tracker = new ViewerGestureTracker();
    zoomIn(tracker);
    const zoomed = tracker.transform;
    tracker.down(at(3, 400, 500, 1000, true), geometry);
    tracker.move(at(3, 412, 500, 1030), geometry); // crosses the slop: pan starts here
    expect(tracker.transform).toBe(zoomed);
    tracker.move(at(3, 452, 500, 1060), geometry);
    expect(tracker.transform.x - zoomed.x).toBeCloseTo(40);
    expect(tracker.end(at(3, 452, 500, 1090), geometry)).toBe("none");
    expect(isZoomed(tracker.transform)).toBe(true);
    // Coming back to the start point is still a pan, not a tap.
    tracker.down(at(4, 400, 500, 2000, true), geometry);
    tracker.move(at(4, 440, 500, 2030), geometry);
    tracker.move(at(4, 401, 500, 2060), geometry);
    expect(tracker.end(at(4, 401, 500, 2090), geometry)).toBe("none");
    expect(isZoomed(tracker.transform)).toBe(true);
  });

  it("does not treat a cancelled pointer as a tap", () => {
    const tracker = new ViewerGestureTracker();
    zoomIn(tracker);
    tracker.down(at(3, 5, 610, 1000, true), geometry);
    expect(tracker.end(at(3, 5, 610, 1040), geometry, true)).toBe("none");
    expect(isZoomed(tracker.transform)).toBe(true);
    // At fit size a cancelled touch does not close the viewer either.
    const fit = new ViewerGestureTracker();
    fit.down(at(1, 5, 610, 0, true), geometry);
    expect(fit.end(at(1, 5, 610, 40), geometry, true)).toBe("none");
  });

  it("keeps the fit-size gestures: tap closes, swipes change image or close", () => {
    const tracker = new ViewerGestureTracker();
    tracker.down(at(1, 400, 500, 0, true), geometry);
    expect(tracker.end(at(1, 402, 501, 120), geometry)).toBe("close");
    tracker.down(at(2, 600, 500, 1000, true), geometry);
    tracker.move(at(2, 450, 510, 1100), geometry);
    expect(tracker.transform).toEqual(FIT);
    expect(tracker.end(at(2, 450, 510, 1150), geometry)).toBe("next");
    tracker.down(at(3, 400, 300, 2000, true), geometry);
    tracker.move(at(3, 405, 500, 2100), geometry);
    expect(tracker.end(at(3, 405, 500, 2150), geometry)).toBe("close");
  });
});
