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
 * NovelAI's `timeUntilNextPercent` has no documented meaning. On the S11 it stayed at the
 * same value poll after poll, so it behaves like the time one percent takes, not a
 * countdown. Track two facts across polls: whether the value ever counts down (then it
 * is a real countdown), and when the percentage last rose (then the next percent is due
 * one interval after that).
 */
export type UsageTrack = { percent: number | null; duration: number | null; countdown: boolean; risenAt: number | null };
export const EMPTY_USAGE_TRACK: UsageTrack = { percent: null, duration: null, countdown: false, risenAt: null };

export function trackUsage(previous: UsageTrack, quota: NovelAiQuota | null, at: number): UsageTrack {
  const usage = quota?.usage;
  const percent = typeof usage?.percent === "number" ? usage.percent : null;
  const duration = typeof usage?.timeUntilNextPercent === "number" ? usage.timeUntilNextPercent : null;
  // Polls are ≥ 1 s apart; a value that shrank by more than a few seconds is counting down.
  const countdown = previous.countdown || (previous.duration !== null && duration !== null && duration < previous.duration - 5);
  const risen = previous.percent !== null && percent !== null && percent > previous.percent;
  return { percent, duration, countdown, risenAt: risen ? at : previous.risenAt };
}

let restoreStarted = false;

export const useConnectionStore = create<State>((set, get) => ({
  tokenInput: "",
  status: "disconnected",
  message: "",
  quota: null,
  quotaStatus: "idle",
  quotaReceivedAt: null,
  usageTrack: EMPTY_USAGE_TRACK,
  setTokenInput: (tokenInput) => set({ tokenInput }),

  refreshQuota: async () => {
    if (!isTauriRuntime() || get().status !== "connected" || get().quotaStatus === "loading") return;
    set({ quotaStatus: "loading" });
    try {
      const quota = await getNovelAiQuota();
      if (get().status === "connected") {
        const at = Date.now();
        set({ quota, quotaStatus: "ready", quotaReceivedAt: at, usageTrack: trackUsage(get().usageTrack, quota, at) });
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
