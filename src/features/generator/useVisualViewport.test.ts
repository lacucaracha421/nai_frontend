import { describe, expect, it } from "vitest";
import { viewportBox } from "./useVisualViewport";

describe("viewportBox", () => {
  it("reports no keyboard when the visual viewport fills the layout", () => {
    expect(viewportBox(1280, { height: 1280, offsetTop: 0 })).toEqual({ height: 1280, top: 0, keyboard: false });
    expect(viewportBox(1280, null)).toEqual({ height: 1280, top: 0, keyboard: false });
  });

  it("detects an overlaying keyboard from the visual viewport", () => {
    expect(viewportBox(1280, { height: 800, offsetTop: 0 })).toEqual({ height: 800, top: 0, keyboard: true });
  });

  it("detects a resizing keyboard from the remembered full height", () => {
    expect(viewportBox(800, { height: 800, offsetTop: 0 }, 1280)).toEqual({ height: 800, top: 0, keyboard: true });
    // Small changes (browser bars) are not a keyboard.
    expect(viewportBox(1220, { height: 1220, offsetTop: 0 }, 1280).keyboard).toBe(false);
  });
});
