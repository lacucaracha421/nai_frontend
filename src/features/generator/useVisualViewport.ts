import { useEffect, useRef, useState } from "react";

/**
 * Visible box of the page.
 *
 * One keyboard model (NAI-011): on Android the native side shrinks the WebView above the
 * soft keyboard (MainActivity pads the content view by the IME inset), so the layout
 * viewport itself is the space left above the keyboard and the shell simply fills it
 * (CSS, no JS lag). Only when the visual viewport is smaller than the layout viewport
 * (an overlaying keyboard in a browser, pinch zoom) is the shell pinned to it in px;
 * `min` never subtracts the keyboard twice.
 */
export type ViewportBox = {
  height: number;
  top: number;
  /** A keyboard (or similar) takes the bottom of the screen. */
  keyboard: boolean;
  /** The visual viewport is smaller than or offset from the layout viewport: pin the shell to it. */
  pinned: boolean;
};

/** Height the soft keyboard (or other overlay) takes from the bottom of the layout viewport. */
export const KEYBOARD_MIN_INSET = 120;

export function viewportBox(
  layoutHeight: number,
  visual: { height: number; offsetTop: number } | null | undefined,
  /** Tallest layout height seen at this width (a resizing WebView shrinks innerHeight too). */
  fullHeight = layoutHeight,
): ViewportBox {
  const height = visual ? Math.min(layoutHeight, visual.height) : layoutHeight;
  const top = visual ? Math.max(0, visual.offsetTop) : 0;
  return {
    height,
    top,
    keyboard: Math.max(fullHeight, layoutHeight) - height > KEYBOARD_MIN_INSET,
    pinned: top > 0 || layoutHeight - height > 1,
  };
}

export function useVisualViewport(): ViewportBox {
  const full = useRef({ width: 0, height: 0 });
  const read = () => {
    // Rotation or a window resize changes the baseline; the keyboard only changes height.
    if (full.current.width !== window.innerWidth) full.current = { width: window.innerWidth, height: 0 };
    full.current.height = Math.max(full.current.height, window.innerHeight);
    return viewportBox(window.innerHeight, window.visualViewport, full.current.height);
  };
  const [box, setBox] = useState<ViewportBox>(read);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const next = read();
      setBox((current) =>
        current.height === next.height && current.top === next.top && current.keyboard === next.keyboard && current.pinned === next.pinned
          ? current
          : next,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return box;
}

/** Delay after the finger lifts before a layout may expand again (after the click fires). */
export const RELEASE_DELAY_MS = 120;

/**
 * Follows `raw`, but a change to false waits until no pointer is down and the tap's
 * click has been delivered, so the layout never moves between pointerdown and click.
 * A change to true applies in the same render.
 */
export function useSettledFlag(raw: boolean) {
  const [value, setValue] = useState(raw);
  const pointers = useRef(0);
  const [released, setReleased] = useState(0);
  useEffect(() => {
    const down = () => { pointers.current += 1; };
    const up = () => {
      pointers.current = Math.max(0, pointers.current - 1);
      if (!pointers.current) setReleased((count) => count + 1);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  useEffect(() => {
    if (raw) {
      setValue(true);
      return;
    }
    if (pointers.current) return;
    const timer = window.setTimeout(() => setValue(false), RELEASE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [raw, released]);
  return raw || value;
}
