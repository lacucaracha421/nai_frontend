import { describe, expect, it, vi } from "vitest";
import { BACK_PRIORITY, createBackStack } from "./backStack";

describe("back layer stack", () => {
  it("reports nothing open", () => {
    expect(createBackStack().handleBack()).toBe(false);
  });

  it("closes by priority, then most recent", () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.push(BACK_PRIORITY.typing, () => calls.push("typing"));
    stack.push(BACK_PRIORITY.viewer, () => calls.push("viewer"));
    stack.push(BACK_PRIORITY.sheet, () => calls.push("sheet"));
    const removeBubble = stack.push(BACK_PRIORITY.popover, () => calls.push("bubble"));
    stack.push(BACK_PRIORITY.sheet, () => calls.push("second sheet"));
    expect(stack.handleBack()).toBe(true);
    expect(calls).toEqual(["bubble"]);
    removeBubble();
    stack.handleBack();
    expect(calls).toEqual(["bubble", "second sheet"]);
  });

  it("follows removals made when layers close", () => {
    const stack = createBackStack();
    const order: string[] = [];
    const register = (name: string, priority: number) => {
      const remove = stack.push(priority, () => {
        order.push(name);
        remove();
      });
    };
    register("typing", BACK_PRIORITY.typing);
    register("viewer", BACK_PRIORITY.viewer);
    register("sheet", BACK_PRIORITY.sheet);
    register("menu", BACK_PRIORITY.menu);
    register("bubble", BACK_PRIORITY.popover);
    while (stack.handleBack());
    expect(order).toEqual(["bubble", "menu", "sheet", "viewer", "typing"]);
    expect(stack.size()).toBe(0);
  });

  it("removes a layer without calling it", () => {
    const stack = createBackStack();
    const close = vi.fn();
    const remove = stack.push(BACK_PRIORITY.sheet, close);
    remove();
    expect(stack.handleBack()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
