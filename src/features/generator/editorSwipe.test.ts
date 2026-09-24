import { describe, expect, it } from "vitest";
import { classifyEditorSwipe } from "./editorSwipe";

const base = { dx: 0, dy: 0, expanded: false, listAtTop: true };

describe("editor swipe", () => {
  it("expands on a mostly vertical upward swipe in the normal state", () => {
    expect(classifyEditorSwipe({ ...base, dy: -60 })).toBe("expand");
    expect(classifyEditorSwipe({ ...base, dy: -60, dx: 20 })).toBe("expand");
    expect(classifyEditorSwipe({ ...base, dy: -60, expanded: true })).toBe("none");
  });

  it("ignores short, horizontal or diagonal moves and taps", () => {
    expect(classifyEditorSwipe({ ...base, dy: -30 })).toBe("none");
    expect(classifyEditorSwipe({ ...base, dy: -60, dx: 80 })).toBe("none");
    expect(classifyEditorSwipe(base)).toBe("none");
  });

  it("collapses on a downward swipe only when the list is at the top", () => {
    const expanded = { ...base, expanded: true };
    expect(classifyEditorSwipe({ ...expanded, dy: 70 })).toBe("collapse");
    expect(classifyEditorSwipe({ ...expanded, dy: 70, listAtTop: false })).toBe("none");
    expect(classifyEditorSwipe({ ...expanded, dy: 70, listAtTop: false, onHandle: true })).toBe("collapse");
    expect(classifyEditorSwipe({ ...base, dy: 70 })).toBe("none");
  });
});
