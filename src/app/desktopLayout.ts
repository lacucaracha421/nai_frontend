import { useSyncExternalStore } from "react";

export const DESKTOP_MEDIA = "(min-width: 1180px) and (min-aspect-ratio: 5/4)";

export function isDesktopPlatform(userAgent: string) {
  return !/Android/i.test(userAgent);
}

export function desktopLayoutEnabled(userAgent: string, wide: boolean) {
  return isDesktopPlatform(userAgent) && wide;
}

export function isDesktopLayout() {
  return typeof window !== "undefined" && desktopLayoutEnabled(navigator.userAgent, window.matchMedia(DESKTOP_MEDIA).matches);
}

function subscribe(change: () => void) {
  const media = window.matchMedia(DESKTOP_MEDIA);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

export function useDesktopLayout() {
  return useSyncExternalStore(subscribe, isDesktopLayout, () => false);
}

export function nativeTextTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])");
}
