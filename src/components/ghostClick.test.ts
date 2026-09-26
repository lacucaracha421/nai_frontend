import { afterEach, describe, expect, it, vi } from "vitest";
import { GHOST_CLICK_MS, swallowGhostClicks } from "./ghostClick";

describe("ghost click after the viewer closes (NAI-011)", () => {
  afterEach(() => vi.useRealTimers());

  it("swallows the tap's trailing click on the revealed screen, then lets clicks through again", () => {
    vi.useFakeTimers();
    const screen = new EventTarget();
    const onClick = vi.fn();
    swallowGhostClicks(screen);
    screen.addEventListener("click", onClick);

    const ghost = new Event("click", { cancelable: true });
    screen.dispatchEvent(ghost);
    screen.dispatchEvent(new Event("mousedown", { cancelable: true }));
    expect(onClick).not.toHaveBeenCalled();
    expect(ghost.defaultPrevented).toBe(true);

    vi.advanceTimersByTime(GHOST_CLICK_MS);
    screen.dispatchEvent(new Event("click", { cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled early", () => {
    vi.useFakeTimers();
    const screen = new EventTarget();
    const onClick = vi.fn();
    const stop = swallowGhostClicks(screen);
    screen.addEventListener("click", onClick);
    stop();
    screen.dispatchEvent(new Event("click"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
