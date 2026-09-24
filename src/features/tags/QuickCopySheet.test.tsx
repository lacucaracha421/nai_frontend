import { expect, it, vi } from "vitest";
import { openDestinationTab } from "./QuickCopySheet";

it.each([
  ["artist", "artists"], ["other", "actions"], ["quality", "tags"], ["negative", "tags"],
] as const)("opens %s on %s using the bundled dictionary's tab action", (section, tab) => {
  const click = vi.fn();
  const querySelector = vi.fn(() => ({ click }));
  openDestinationTab({ contentDocument: { querySelector } } as unknown as HTMLIFrameElement, section);
  expect(querySelector).toHaveBeenCalledWith(`button[data-tab="${tab}"]`);
  expect(click).toHaveBeenCalledOnce();
});
