import { describe, expect, it } from "vitest";
import { desktopLayoutEnabled, isDesktopPlatform } from "./desktopLayout";

describe("desktop layout gating", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36";
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  it("never enables the PC layout on Android, even in a wide window", () => {
    expect(isDesktopPlatform(android)).toBe(false);
    expect(desktopLayoutEnabled(android, true)).toBe(false);
    expect(desktopLayoutEnabled(android, false)).toBe(false);
  });
  it("requires a wide window on desktop, including browser previews", () => {
    expect(isDesktopPlatform(desktop)).toBe(true);
    expect(desktopLayoutEnabled(desktop, true)).toBe(true);
    expect(desktopLayoutEnabled(desktop, false)).toBe(false);
  });
});
