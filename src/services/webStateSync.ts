import { apiJson, isWebServerRuntime } from "../adapters/webApi";

const QUICKCOPY_KEYS = new Set(["artist-tag-quick-copy.v4", "artist-quick-copy.v1"]);

export function isAppStorageKey(key: string) {
  return key.startsWith("nai-v5-") || QUICKCOPY_KEYS.has(key) || key.startsWith("artist-tag-quick-copy.");
}

type StateResponse = {
  storage?: Record<string, string>;
};

const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let suppressCapture = false;
let inflightFlush: Promise<void> | null = null;

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

function sendPatch(patch: Record<string, string | null>, keepalive = false) {
  const body = JSON.stringify({ storage: patch });
  return fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive,
  }).then(() => undefined).catch((error) => {
    console.warn("[web-sync] Failed to save state to server:", error);
  });
}

export async function flushWebStorageSync(keepalive = false) {
  if (!installed) return;
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
  const promise = sendPatch(patch, keepalive);
  inflightFlush = promise;
  await promise;
  if (inflightFlush === promise) inflightFlush = null;
}

function scheduleFlush() {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushWebStorageSync(false);
  }, 350);
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
    }
  });
}

/**
 * Loads server-persisted app state into localStorage before Zustand stores
 * initialize, so PC and tablet browsers share prompts, favorites, character
 * libraries, and settings seamlessly.
 */
export async function hydrateWebStorage() {
  if (!isWebServerRuntime()) return;
  try {
    const response = await apiJson<StateResponse>("/api/state");
    const serverStorage = response?.storage ?? {};
    const serverKeys = Object.keys(serverStorage).filter(isAppStorageKey);

    if (serverKeys.length > 0) {
      suppressCapture = true;
      try {
        const localKeys = Object.keys(collectLocalAppStorage());
        const serverKeySet = new Set(serverKeys);
        for (const key of localKeys) {
          if (!serverKeySet.has(key)) {
            window.localStorage.removeItem(key);
          }
        }
        for (const key of serverKeys) {
          window.localStorage.setItem(key, serverStorage[key]);
        }
      } finally {
        suppressCapture = false;
      }
    } else {
      const local = collectLocalAppStorage();
      if (Object.keys(local).length > 0) {
        await sendPatch(local);
      }
    }

    installStorageHooks();
  } catch (error) {
    console.warn("[web-sync] Server state unavailable; using browser localStorage only.", error);
  }
}
