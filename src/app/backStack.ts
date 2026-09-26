import { useEffect, useRef } from "react";

/**
 * Android Back closes the most recently opened layer that is still open — the one on
 * top of the screen (NAI-011). Layers open in the order the user sees them stack, so
 * one rule gives the whole order: the system hides the keyboard first (the IME takes
 * Back while it is up), then suggestions/bubble/menu, then sheets and the viewer, then
 * tag editing, then the enlarged editor; with nothing open App shows the exit hint.
 * (A fixed priority table closed invisible popovers behind a sheet first.)
 */
type Layer = { id: number; close: () => void };

export function createBackStack() {
  let layers: Layer[] = [];
  let nextId = 1;
  return {
    /** Registers an open layer; returns its removal function. */
    push(close: () => void) {
      const layer = { id: nextId++, close };
      layers.push(layer);
      return () => {
        layers = layers.filter((item) => item.id !== layer.id);
      };
    },
    /** Closes the topmost (most recently opened) layer; false when nothing is open. */
    handleBack() {
      const top = layers[layers.length - 1];
      if (!top) return false;
      top.close();
      return true;
    },
    size: () => layers.length,
  };
}

export const backStack = createBackStack();

/**
 * Keeps a layer registered while `open` is true; it goes on top when it opens.
 * `close` may change between renders.
 */
export function useBackLayer(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return backStack.push(() => closeRef.current());
  }, [open]);
}

/** Time after the "한 번 더 누르면 종료" toast in which a second Back leaves the app. */
export const EXIT_WINDOW_MS = 2000;
