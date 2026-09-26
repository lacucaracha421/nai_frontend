import { describe, expect, it, vi } from "vitest";
import { createBackStack } from "./backStack";

describe("back layer stack", () => {
  it("reports nothing open", () => {
    expect(createBackStack().handleBack()).toBe(false);
  });

  it("closes the most recently opened layer first", () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.push(() => calls.push("editing"));
    const removeSuggestions = stack.push(() => calls.push("suggestions"));
    expect(stack.handleBack()).toBe(true);
    expect(calls).toEqual(["suggestions"]);
    removeSuggestions();
    stack.handleBack();
    expect(calls).toEqual(["suggestions", "editing"]);
  });

  it("closes a sheet opened over an older popover before the popover", () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.push(() => calls.push("diff popover"));
    stack.push(() => calls.push("settings sheet"));
    stack.handleBack();
    expect(calls).toEqual(["settings sheet"]);
  });

  it("follows removals made when layers close", () => {
    const stack = createBackStack();
    const order: string[] = [];
    const register = (name: string) => {
      const remove = stack.push(() => {
        order.push(name);
        remove();
      });
    };
    register("expanded editor");
    register("editing");
    register("suggestions");
    while (stack.handleBack());
    register("viewer");
    register("menu");
    while (stack.handleBack());
    expect(order).toEqual(["suggestions", "editing", "expanded editor", "menu", "viewer"]);
    expect(stack.size()).toBe(0);
  });

  it("puts a layer that reopens back on top", () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.push(() => calls.push("editing"));
    const remove = stack.push(() => calls.push("old suggestions"));
    remove();
    stack.push(() => calls.push("suggestions"));
    stack.handleBack();
    expect(calls).toEqual(["suggestions"]);
  });

  it("removes a layer without calling it", () => {
    const stack = createBackStack();
    const close = vi.fn();
    const remove = stack.push(close);
    remove();
    expect(stack.handleBack()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
