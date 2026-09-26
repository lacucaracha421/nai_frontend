import { describe, expect, it } from "vitest";
import { viewportBox } from "./useVisualViewport";

describe("viewportBox", () => {
  it("reports no keyboard when the visual viewport fills the layout", () => {
    expect(viewportBox(1280, { height: 1280, offsetTop: 0 })).toEqual({ height: 1280, top: 0, keyboard: false, pinned: false });
    expect(viewportBox(1280, null)).toEqual({ height: 1280, top: 0, keyboard: false, pinned: false });
  });

  it("detects an overlaying keyboard from the visual viewport and pins the shell to it", () => {
    expect(viewportBox(1280, { height: 800, offsetTop: 0 })).toEqual({ height: 800, top: 0, keyboard: true, pinned: true });
  });

  it("detects a resizing keyboard without pinning (the layout viewport already shrank)", () => {
    expect(viewportBox(800, { height: 800, offsetTop: 0 }, 1280)).toEqual({ height: 800, top: 0, keyboard: true, pinned: false });
    // Sub-pixel differences between the two viewports are not an overlay.
    expect(viewportBox(800, { height: 799.5, offsetTop: 0 }, 1280).pinned).toBe(false);
    // Small changes (browser bars) are not a keyboard.
    expect(viewportBox(1220, { height: 1220, offsetTop: 0 }, 1280).keyboard).toBe(false);
  });

  it("follows a panned visual viewport", () => {
    expect(viewportBox(1280, { height: 1280, offsetTop: 40 }).pinned).toBe(true);
  });
});
