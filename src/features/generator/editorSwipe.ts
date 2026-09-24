/** Minimum vertical travel (px) for a swipe on the editor to change its size. */
export const EDITOR_SWIPE_MIN = 40;

export type EditorSwipe = "expand" | "collapse" | "none";

/**
 * Bottom-sheet rules for the tag editor. Up expands (image band shrinks), down
 * collapses; the swipe must be mostly vertical. In the expanded state the list
 * scrolls normally, so down only collapses when the list is already at the top.
 * On the handle bar (`onHandle`) the scroll position does not matter.
 */
export function classifyEditorSwipe(input: {
  dx: number;
  dy: number;
  expanded: boolean;
  listAtTop: boolean;
  onHandle?: boolean;
}): EditorSwipe {
  const { dx, dy, expanded, listAtTop, onHandle = false } = input;
  if (Math.abs(dy) < EDITOR_SWIPE_MIN || Math.abs(dy) < Math.abs(dx) * 1.5) return "none";
  if (dy < 0) return expanded ? "none" : "expand";
  if (!expanded) return "none";
  return onHandle || listAtTop ? "collapse" : "none";
}
