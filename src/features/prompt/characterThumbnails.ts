import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isWebServerRuntime } from "../../adapters/webApi";
export type Thumbnail = { status: "loading" | "ready" | "missing" | "failed"; src?: string };
const images = new Map<string, Thumbnail>();
const listeners = new Set<() => void>();
const queue: string[] = [];
let active = 0;
let version = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function notify() { version++; for (const listener of listeners) listener(); }
async function fetchThumbnailSrc(raw: string): Promise<string | null> {
  if (isWebServerRuntime()) {
    const url = `/api/character-thumbnail?raw=${encodeURIComponent(raw)}`;
    const response = await fetch(url);
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Thumbnail fetch failed (${response.status})`);
    return url;
  }
  return invoke<string | null>("character_thumbnail", { raw });
}
function pump() {
  while (active < 2 && queue.length) {
    const raw = queue.shift()!;
    active++;
    void fetchThumbnailSrc(raw).then(src => {
      images.set(raw, src ? { status: "ready", src } : { status: "missing" });
    }).catch(() => { images.set(raw, { status: "failed" }); }).finally(() => {
      active--; notify(); pump();
    });
  }
}
export function requestThumbnail(raw: string, priority = false, retry = false) {
  const old = images.get(raw);
  if (old && !(retry && old.status === "failed")) {
    if (priority) { const i = queue.indexOf(raw); if (i > 0) { queue.splice(i, 1); queue.unshift(raw); } }
    return;
  }
  images.set(raw, { status: "loading" });
  if (priority) queue.unshift(raw); else queue.push(raw);
  notify(); pump();
}
export function prefetchThumbnails(names: string[]) {
  // Failed requests wait for explicit retry, so opening the sheet offline does not loop.
  for (const name of names) requestThumbnail(name);
}
export function useThumbnailProgress(names: string[]) {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const saved = names.filter(name => images.get(name)?.status === "ready").length;
  const failed = names.filter(name => images.get(name)?.status === "failed").length;
  const pending = [...images.values()].filter(image => image.status === "loading").length;
  return { saved, failed, pending };
}
export function useThumbnail(raw: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    const element = ref.current;
    if (!element || !raw) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); requestThumbnail(raw, true); observer.disconnect(); }
    }, { rootMargin: "160px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [raw]);
  return { ref, image: raw ? images.get(raw) ?? { status: "loading" as const } : { status: "missing" as const }, visible,
    retry: () => { if (raw) requestThumbnail(raw, true, true); } };
}
