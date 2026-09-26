/**
 * Android WebView turns a finished tap into compatibility mouse events and a `click`
 * *after* touchend, hit-tested at that moment. When the viewer closes on pointerup, that
 * click lands on whatever the closed viewer revealed underneath: 태그사전 or 번역 in the
 * right column, or the current-image thumbnail on the left, which reopens the viewer
 * (seen as "the image does not fit and flickers") (NAI-011).
 * `swallowGhostClicks` drops those events for a short window after the close.
 */
export const GHOST_CLICK_MS = 450;
const EVENTS = ["click", "mousedown", "mouseup", "dblclick", "contextmenu"] as const;

/** Swallows click-type events on `target` (capture phase) for `ms`; returns a cancel function. */
export function swallowGhostClicks(target: EventTarget = window, ms = GHOST_CLICK_MS) {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of EVENTS) target.addEventListener(type, swallow, { capture: true });
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const type of EVENTS) target.removeEventListener(type, swallow, { capture: true });
  };
  const timer = setTimeout(stop, ms);
  return stop;
}
