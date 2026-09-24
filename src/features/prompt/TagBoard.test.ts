import { describe, expect, it } from "vitest";
import { KEEPS_BUBBLE, closesBubble } from "./TagBoard";

const target = (matches: boolean) => ({ closest: (selector: string) => (selector === KEEPS_BUBBLE && matches ? {} : null) });

describe("chip bubble outside tap", () => {
  it("closes on taps outside the bubble, chips and selection tools", () => {
    expect(closesBubble(target(false))).toBe(true);
    expect(closesBubble(null)).toBe(true);
  });

  it("stays open for the bubble, another chip or 번역", () => {
    expect(closesBubble(target(true))).toBe(false);
    expect(KEEPS_BUBBLE).toContain(".tag-bubble");
    expect(KEEPS_BUBBLE).toContain(".tag-chip");
    expect(KEEPS_BUBBLE).toContain("[data-keeps-selection]");
  });
});

describe("empty-area tap", async () => {
  const { emptyAreaTap } = await import("./TagBoard");
  const tap = { dx: 2, dy: 3, durationMs: 120, typing: false };

  it("starts a new tag on a short, still tap", () => {
    expect(emptyAreaTap(tap)).toBe("start-input");
  });

  it("starts input in the same tap even when a bubble was open (the caller closes it)", () => {
    expect(emptyAreaTap(tap)).toBe("start-input");
  });

  it("ignores swipes, scrolls, long presses and taps while typing", () => {
    expect(emptyAreaTap({ ...tap, dy: -60 })).toBe("none");
    expect(emptyAreaTap({ ...tap, dx: 12 })).toBe("none");
    expect(emptyAreaTap({ ...tap, durationMs: 900 })).toBe("none");
    expect(emptyAreaTap({ ...tap, typing: true })).toBe("none");
  });
});
