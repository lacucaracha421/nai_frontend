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
  setTokenInput: (value: string) => void;
  restore: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshQuota: () => Promise<void>;
};

let restoreStarted = false;

export const useConnectionStore = create<State>((set, get) => ({
  tokenInput: "",
  status: "disconnected",
  message: "",
  quota: null,
  quotaStatus: "idle",
  setTokenInput: (tokenInput) => set({ tokenInput }),

  refreshQuota: async () => {
    if (!isTauriRuntime() || get().status !== "connected") return;
    set({ quotaStatus: "loading" });
    try {
      const quota = await getNovelAiQuota();
      set({ quota, quotaStatus: "ready" });
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

    set({ status: "testing", message: "", quota: null, quotaStatus: "idle" });
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
        quotaStatus: "idle",
      });
    } catch (error) {
      set({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },
}));
