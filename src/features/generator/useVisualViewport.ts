import { useEffect, useRef, useState } from "react";

export type ViewportBox = { height: number; top: number; keyboard: boolean };

/** Height the soft keyboard (or other overlay) takes from the bottom of the layout viewport. */
export const KEYBOARD_MIN_INSET = 120;

/**
 * Visible box of the page. With a resizing WebView the keyboard shrinks the layout
 * viewport itself; with an overlaying one only the visual viewport shrinks. Pinning
 * the app to the visual viewport keeps the bottom rows directly above the keyboard
 * in both cases.
 */
export function viewportBox(
  layoutHeight: number,
  visual: { height: number; offsetTop: number } | null | undefined,
  /** Tallest layout height seen at this width (a resizing WebView shrinks innerHeight too). */
  fullHeight = layoutHeight,
): ViewportBox {
  const height = visual ? Math.min(layoutHeight, visual.height) : layoutHeight;
  return {
    height,
    top: visual ? Math.max(0, visual.offsetTop) : 0,
    keyboard: Math.max(fullHeight, layoutHeight) - height > KEYBOARD_MIN_INSET,
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
        current.height === next.height && current.top === next.top && current.keyboard === next.keyboard ? current : next,
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

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** Whether an element takes typed text (and so raises the soft keyboard). */
export function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type) && !element.readOnly && !element.disabled;
  return element instanceof HTMLElement && element.isContentEditable;
}

/** True while a text field has focus (Back can hide the keyboard without blurring it). */
export function useEditableFocus() {
  const [focused, setFocused] = useState(() => typeof document !== "undefined" && isEditableElement(document.activeElement));
  useEffect(() => {
    const update = () => setFocused(isEditableElement(document.activeElement));
    // During focusout the next element is not active yet.
    const later = () => window.setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return focused;
}

/** Delay after the finger lifts before a layout may expand again (after the click fires). */
export const RELEASE_DELAY_MS = 120;

/**
 * Follows `raw`, but a change to false waits until no pointer is down and the tap's
 * click has been delivered, so the layout never moves between pointerdown and click.
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
  return value;
}
