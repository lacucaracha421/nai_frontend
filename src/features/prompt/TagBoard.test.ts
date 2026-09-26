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

describe("board-only reveal of the input or selected chip", async () => {
  const { REVEAL_MARGIN, revealScrollTop } = await import("./TagBoard");
  const view = { scrollTop: 300, viewHeight: 400, anchorHeight: 52 };

  it("does not move a visible anchor (no jump when the keyboard opens or closes)", () => {
    expect(revealScrollTop({ ...view, anchorTop: 100 })).toBe(300);
    expect(revealScrollTop({ ...view, anchorTop: REVEAL_MARGIN })).toBe(300);
    expect(revealScrollTop({ ...view, anchorTop: 400 - 52 - REVEAL_MARGIN })).toBe(300);
  });

  it("scrolls just enough to show an anchor below the board (keyboard took the space)", () => {
    // Input at 500 in a board that shrank to 400: its bottom plus margin must fit.
    expect(revealScrollTop({ ...view, anchorTop: 500 })).toBe(300 + 500 + 52 + REVEAL_MARGIN - 400);
  });

  it("scrolls up to an anchor above the board, never below zero", () => {
    expect(revealScrollTop({ ...view, anchorTop: -80 })).toBe(300 - 80 - REVEAL_MARGIN);
    expect(revealScrollTop({ ...view, scrollTop: 20, anchorTop: -20 })).toBe(0);
  });

  it("keeps the top of an anchor taller than the board in view", () => {
    expect(revealScrollTop({ ...view, anchorTop: 200, anchorHeight: 600 })).toBe(300 + 200 - REVEAL_MARGIN);
  });
});

describe("section switch while editing", async () => {
  const { initialDraft, switchCarriesEditing } = await import("./TagBoard");

  it("carries editing over only while editing with the keyboard up", () => {
    expect(switchCarriesEditing({ editing: true, keyboard: true })).toBe(true);
    // Keyboard hidden with Back, or not editing: the switch behaves as before.
    expect(switchCarriesEditing({ editing: true, keyboard: false })).toBe(false);
    expect(switchCarriesEditing({ editing: false, keyboard: true })).toBe(false);
    expect(switchCarriesEditing({ editing: false, keyboard: false })).toBe(false);
  });

  it("mounts the next board with a new-tag input at the end", () => {
    expect(initialDraft(true, "a, b, 1.2::c, d ::")).toEqual({ mode: "new", at: 3, text: "" });
    expect(initialDraft(true, "")).toEqual({ mode: "new", at: 0, text: "" });
    expect(initialDraft(false, "a, b")).toBeNull();
    expect(initialDraft(undefined, "a, b")).toBeNull();
  });
});
