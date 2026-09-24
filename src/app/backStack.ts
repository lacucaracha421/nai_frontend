import { useEffect, useRef } from "react";

/**
 * Android Back closes the topmost open layer. Higher priority wins; among equal
 * priorities the most recently opened one wins.
 */
export const BACK_PRIORITY = {
  expandedEditor: 5,
  typing: 10,
  viewer: 20,
  sheet: 30,
  nestedSheet: 35,
  menu: 40,
  popover: 50,
} as const;

type Layer = { id: number; priority: number; close: () => void };

export function createBackStack() {
  let layers: Layer[] = [];
  let nextId = 1;
  return {
    /** Registers an open layer; returns its removal function. */
    push(priority: number, close: () => void) {
      const layer = { id: nextId++, priority, close };
      layers.push(layer);
      return () => {
        layers = layers.filter((item) => item.id !== layer.id);
      };
    },
    /** Closes the topmost layer; false when nothing is open. */
    handleBack() {
      if (!layers.length) return false;
      const top = layers.reduce((best, layer) =>
        layer.priority > best.priority || (layer.priority === best.priority && layer.id > best.id) ? layer : best);
      top.close();
      return true;
    },
    size: () => layers.length,
  };
}

export const backStack = createBackStack();

/** Keeps a layer registered while `open` is true; `close` may change between renders. */
export function useBackLayer(open: boolean, close: () => void, priority: number) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return backStack.push(priority, () => closeRef.current());
  }, [open, priority]);
}

/** Time after the "한 번 더 누르면 종료" toast in which a second Back leaves the app. */
export const EXIT_WINDOW_MS = 2000;
