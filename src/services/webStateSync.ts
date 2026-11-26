import { invoke } from "@tauri-apps/api/core";
import { apiJson, isTauriRuntime, isWebServerRuntime } from "../adapters/webApi";

export const DEFAULT_TAURI_SYNC_URL = "https://laku-tokyo.tail0aa1a3.ts.net:3080";
export const SYNC_URL_STORAGE_KEY = "nai-v5-sync-server-url";

const QUICKCOPY_KEYS = new Set(["artist-tag-quick-copy.v4", "artist-quick-copy.v1"]);
const LOCAL_ONLY_KEYS = new Set([SYNC_URL_STORAGE_KEY]);

export function isAppStorageKey(key: string) {
  if (LOCAL_ONLY_KEYS.has(key)) return false;
  return key.startsWith("nai-v5-") || QUICKCOPY_KEYS.has(key) || key.startsWith("artist-tag-quick-copy.");
}

type StateResponse = {
  storage?: Record<string, string>;
};

export type SyncStatus = {
  enabled: boolean;
  state: "idle" | "connected" | "offline" | "disabled";
  lastSyncedAt: number | null;
  lastError: string | null;
};

const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let suppressCapture = false;
let inflightFlush: Promise<void> | null = null;
let lastPullAt = 0;
let rehydrator: ((changedKeys: string[]) => void) | null = null;

let status: SyncStatus = {
  enabled: false,
  state: "idle",
  lastSyncedAt: null,
  lastError: null,
};
const statusListeners = new Set<() => void>();

function updateStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

export function registerSyncRehydrator(fn: (changedKeys: string[]) => void) {
  rehydrator = fn;
}

export function getSyncServerUrl(): string {
  if (typeof window === "undefined" || !isTauriRuntime()) return "";
  try {
    const raw = window.localStorage.getItem(SYNC_URL_STORAGE_KEY);
    if (raw === null) return DEFAULT_TAURI_SYNC_URL;
    return raw.trim().replace(/\/+$/, "");
  } catch {
    return DEFAULT_TAURI_SYNC_URL;
  }
}

export function setSyncServerUrl(nextUrl: string) {
  if (typeof window === "undefined") return;
  const clean = nextUrl.trim().replace(/\/+$/, "");
  suppressCapture = true;
  try {
    window.localStorage.setItem(SYNC_URL_STORAGE_KEY, clean);
  } finally {
    suppressCapture = false;
  }
  if (!clean) {
    pending.clear();
    updateStatus({ enabled: false, state: "disabled", lastError: null });
  } else {
    installStorageHooks();
    updateStatus({ enabled: true, state: "idle", lastError: null });
  }
}

function isSyncActive(): boolean {
  if (isWebServerRuntime()) return true;
  if (isTauriRuntime()) return getSyncServerUrl().length > 0;
  return false;
}

function collectLocalAppStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !isAppStorageKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

async function fetchRemoteState(): Promise<StateResponse> {
  if (isWebServerRuntime()) {
    return apiJson<StateResponse>("/api/state");
  }
  const baseUrl = getSyncServerUrl();
  if (!baseUrl) throw new Error("동기화 서버 주소가 설정되지 않았습니다.");
  return invoke<StateResponse>("sync_remote_state_get", { baseUrl });
}

async function sendPatch(patch: Record<string, string | null>, keepalive = false): Promise<void> {
  if (isWebServerRuntime()) {
    const body = JSON.stringify({ storage: patch });
    const res = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive,
    });
    if (!res.ok) throw new Error(`서버 저장 오류 (${res.status})`);
    updateStatus({ enabled: true, state: "connected", lastSyncedAt: Date.now(), lastError: null });
    return;
  }
  const baseUrl = getSyncServerUrl();
  if (!baseUrl) return;
  await invoke("sync_remote_state_put", { baseUrl, storage: patch });
  updateStatus({ enabled: true, state: "connected", lastSyncedAt: Date.now(), lastError: null });
}

export async function flushWebStorageSync(keepalive = false) {
  if (!installed || !isSyncActive()) return;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) {
    if (inflightFlush) await inflightFlush;
    return;
  }
  const patch: Record<string, string | null> = {};
  for (const [key, value] of pending.entries()) {
    patch[key] = value;
  }
  pending.clear();
  const promise = sendPatch(patch, keepalive).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[sync] Failed to save state to server:", message);
    updateStatus({ state: "offline", lastError: message });
  });
  inflightFlush = promise;
  await promise;
  if (inflightFlush === promise) inflightFlush = null;
}

function scheduleFlush() {
  if (!isSyncActive()) return;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushWebStorageSync(false);
  }, 350);
}

function applyServerStorage(serverStorage: Record<string, string>, pruneMissing: boolean): string[] {
  const serverKeys = Object.keys(serverStorage).filter(isAppStorageKey);
  const changed: string[] = [];
  suppressCapture = true;
  try {
    if (pruneMissing) {
      const localKeys = Object.keys(collectLocalAppStorage());
      const serverKeySet = new Set(serverKeys);
      for (const key of localKeys) {
        if (!serverKeySet.has(key)) {
          window.localStorage.removeItem(key);
          changed.push(key);
        }
      }
    }
    for (const key of serverKeys) {
      const nextVal = serverStorage[key];
      if (window.localStorage.getItem(key) !== nextVal) {
        window.localStorage.setItem(key, nextVal);
        changed.push(key);
      }
    }
  } finally {
    suppressCapture = false;
  }
  return changed;
}

export async function pullRemoteState(options?: { force?: boolean }): Promise<{
  ok: boolean;
  changedKeys: string[];
  error?: string;
}> {
  if (!isSyncActive()) {
    return { ok: false, changedKeys: [], error: "동기화가 꺼져 있습니다." };
  }
  if (!options?.force) {
    if (pending.size > 0 || inflightFlush) return { ok: true, changedKeys: [] };
    if (Date.now() - lastPullAt < 3000) return { ok: true, changedKeys: [] };
  }
  lastPullAt = Date.now();
  try {
    const response = await fetchRemoteState();
    const serverStorage = response?.storage ?? {};
    const serverKeys = Object.keys(serverStorage).filter(isAppStorageKey);
    let changedKeys: string[] = [];
    if (serverKeys.length > 0) {
      changedKeys = applyServerStorage(serverStorage, true);
    }
    updateStatus({ enabled: true, state: "connected", lastSyncedAt: Date.now(), lastError: null });
    if (changedKeys.length > 0) {
      rehydrator?.(changedKeys);
    }
    return { ok: true, changedKeys };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus({ enabled: true, state: "offline", lastError: message });
    return { ok: false, changedKeys: [], error: message };
  }
}

export async function pushAllLocalState(): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!isSyncActive()) {
    return { ok: false, count: 0, error: "동기화가 꺼져 있습니다." };
  }
  const local = collectLocalAppStorage();
  const keys = Object.keys(local);
  try {
    await sendPatch(local, false);
    return { ok: true, count: keys.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus({ enabled: true, state: "offline", lastError: message });
    return { ok: false, count: 0, error: message };
  }
}

function installStorageHooks() {
  if (installed || typeof window === "undefined" || typeof Storage === "undefined") return;
  installed = true;

  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  Storage.prototype.setItem = function patchedSetItem(key: string, value: string) {
    originalSetItem.call(this, key, value);
    if (this === window.localStorage && !suppressCapture && isAppStorageKey(key)) {
      pending.set(key, String(value));
      scheduleFlush();
    }
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key: string) {
    originalRemoveItem.call(this, key);
    if (this === window.localStorage && !suppressCapture && isAppStorageKey(key)) {
      pending.set(key, null);
      scheduleFlush();
    }
  };

  Storage.prototype.clear = function patchedClear() {
    if (this === window.localStorage && !suppressCapture) {
      for (const key of Object.keys(collectLocalAppStorage())) {
        pending.set(key, null);
      }
      if (pending.size > 0) scheduleFlush();
    }
    originalClear.call(this);
  };

  window.addEventListener("pagehide", () => {
    void flushWebStorageSync(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushWebStorageSync(true);
    } else if (document.visibilityState === "visible") {
      void pullRemoteState();
    }
  });
}

/**
 * Loads server-persisted app state into localStorage before Zustand stores
 * initialize, so PC web and tablet APK/browsers share prompts, presets,
 * character libraries, and settings seamlessly.
 */
export async function hydrateWebStorage() {
  if (!isWebServerRuntime() && !isTauriRuntime()) return;
  if (!isSyncActive()) {
    updateStatus({ enabled: false, state: "disabled", lastError: null });
    return;
  }

  installStorageHooks();
  updateStatus({ enabled: true, state: "idle", lastError: null });

  try {
    const response = await fetchRemoteState();
    const serverStorage = response?.storage ?? {};
    const serverKeys = Object.keys(serverStorage).filter(isAppStorageKey);

    if (serverKeys.length > 0) {
      applyServerStorage(serverStorage, true);
    } else {
      const local = collectLocalAppStorage();
      if (Object.keys(local).length > 0) {
        await sendPatch(local);
      }
    }
    lastPullAt = Date.now();
    updateStatus({ enabled: true, state: "connected", lastSyncedAt: Date.now(), lastError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[sync] Server state unavailable; using local storage only.", message);
    updateStatus({ enabled: true, state: "offline", lastError: message });
  }
}
