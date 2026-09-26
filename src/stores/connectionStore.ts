import { create } from "zustand";
import {
  clearNovelAiToken,
  getNovelAiQuota,
  isTauriRuntime,
  restoreNovelAiToken,
  setNovelAiToken,
  testNovelAiConnection,
  type NovelAiQuota,
} from "../adapters/novelai/client";

type Status = "disconnected" | "testing" | "connected" | "error";
type QuotaStatus = "idle" | "loading" | "ready";

type State = {
  tokenInput: string;
  status: Status;
  message: string;
  quota: NovelAiQuota | null;
  quotaStatus: QuotaStatus;
  quotaReceivedAt: number | null;
  /** How the usage recovery value behaves across polls (see {@link trackUsage}). */
  usageTrack: UsageTrack;
  setTokenInput: (value: string) => void;
  restore: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshQuota: () => Promise<void>;
};

/**
 * NovelAI's `timeUntilNextPercent` has no documented meaning. Sampled on the S11
 * (2026-09-26) it stayed at 7888 poll after poll at 99 %, so it is the time one percent
 * takes, not a countdown. Track when the percentage was last seen rising (or leaving
 * 100 %): the next percent is then due a whole number of intervals after that moment.
 * That moment is kept on the device so the countdown survives an app restart; it is
 * written only when a regular quota poll sees the change (no extra requests or timers).
 * A value that shrinks in step with the clock is treated as a real countdown instead.
 */
export type UsageTrack = {
  percent: number | null;
  duration: number | null;
  countdown: boolean;
  risenAt: number | null;
  /** When `percent` and `duration` were read; rises are only timed between close polls. */
  at: number | null;
};
export const EMPTY_USAGE_TRACK: UsageTrack = { percent: null, duration: null, countdown: false, risenAt: null, at: null };
const USAGE_TRACK_KEY = "nai-v5-usage-track";
/** A rise seen after a longer gap (app closed) happened at an unknown time. */
const CLOSE_POLL_MS = 3 * 60_000;

export function loadUsageTrack(storage: Pick<Storage, "getItem"> | null = safeStorage()): UsageTrack {
  try {
    const saved = JSON.parse(storage?.getItem(USAGE_TRACK_KEY) ?? "null");
    if (saved && typeof saved.risenAt === "number" && typeof saved.percent === "number" && typeof saved.at === "number") {
      return { ...EMPTY_USAGE_TRACK, percent: saved.percent, risenAt: saved.risenAt, at: saved.at };
    }
  } catch {
    // A missing or damaged record only means the countdown starts unanchored.
  }
  return EMPTY_USAGE_TRACK;
}

function saveUsageTrack(track: UsageTrack, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  if (track.risenAt === null) return;
  try {
    storage?.setItem(USAGE_TRACK_KEY, JSON.stringify({ percent: track.percent, risenAt: track.risenAt, at: track.at }));
  } catch {
    // Convenience only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function trackUsage(previous: UsageTrack, quota: NovelAiQuota | null, at: number): UsageTrack {
  const usage = quota?.usage;
  const percent = typeof usage?.percent === "number" ? usage.percent : null;
  const duration = typeof usage?.timeUntilNextPercent === "number" ? usage.timeUntilNextPercent : null;
  const gap = previous.at === null ? null : at - previous.at;
  const close = gap !== null && gap >= 0 && gap <= CLOSE_POLL_MS;
  // A countdown shrinks by about the time that passed between two polls.
  const shrank = previous.duration !== null && duration !== null ? previous.duration - duration : 0;
  const counting = close && gap! >= 20_000 && shrank >= (gap! / 1000) * 0.5 && shrank <= (gap! / 1000) * 1.5;
  const risen = close && previous.percent !== null && percent !== null
    && (percent > previous.percent || (previous.percent >= 100 && percent < 100));
  return { percent, duration, countdown: previous.countdown || counting, risenAt: risen ? at : previous.risenAt, at };
}

let restoreStarted = false;

function remember(next: UsageTrack, previous: UsageTrack) {
  if (next.risenAt !== previous.risenAt) saveUsageTrack(next);
  return next;
}

export const useConnectionStore = create<State>((set, get) => ({
  tokenInput: "",
  status: "disconnected",
  message: "",
  quota: null,
  quotaStatus: "idle",
  quotaReceivedAt: null,
  usageTrack: loadUsageTrack(),
  setTokenInput: (tokenInput) => set({ tokenInput }),

  refreshQuota: async () => {
    if (!isTauriRuntime() || get().status !== "connected" || get().quotaStatus === "loading") return;
    set({ quotaStatus: "loading" });
    try {
      const quota = await getNovelAiQuota();
      if (get().status === "connected") {
        const at = Date.now();
        set({ quota, quotaStatus: "ready", quotaReceivedAt: at, usageTrack: remember(trackUsage(get().usageTrack, quota, at), get().usageTrack) });
      }
    } catch {
      // Quota display is convenience UI. A temporary status API failure must
      // never break image generation or turn the connection red.
      set({ quotaStatus: "idle" });
    }
  },

  restore: async () => {
    if (!isTauriRuntime() || restoreStarted) return;
    restoreStarted = true;
    try {
      const restored = await restoreNovelAiToken();
      if (restored) {
        set({ status: "connected", message: "", tokenInput: "" });
        await get().refreshQuota();
      }
    } catch (error) {
      set({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },

  connect: async () => {
    const token = get().tokenInput.trim();
    if (!token) {
      set({ status: "error", message: "Persistent API Token을 입력하시와요." });
      return;
    }

    set({ status: "testing", message: "", quota: null, quotaReceivedAt: null, quotaStatus: "idle", usageTrack: EMPTY_USAGE_TRACK });
    try {
      await setNovelAiToken(token);
      await testNovelAiConnection();
      set({ status: "connected", message: "", tokenInput: "" });
      await get().refreshQuota();
    } catch (error) {
      await clearNovelAiToken().catch(() => undefined);
      set({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        quota: null,
        quotaReceivedAt: null,
        usageTrack: EMPTY_USAGE_TRACK,
        quotaStatus: "idle",
      });
    }
  },

  disconnect: async () => {
    try {
      await clearNovelAiToken();
      set({
        status: "disconnected",
        message: "",
        tokenInput: "",
        quota: null,
        quotaReceivedAt: null,
        usageTrack: EMPTY_USAGE_TRACK,
        quotaStatus: "idle",
      });
    } catch (error) {
      set({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },
}));
