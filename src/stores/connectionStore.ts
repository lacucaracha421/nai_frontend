import { create } from "zustand";
import { clearNovelAiToken, isTauriRuntime, setNovelAiToken, testNovelAiConnection } from "../adapters/novelai/client";

type ConnectionStatus = "disconnected" | "testing" | "connected" | "error";

type ConnectionState = {
  tokenInput: string;
  status: ConnectionStatus;
  message: string;
  desktopRuntime: boolean;
  setTokenInput: (value: string) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  tokenInput: "",
  status: "disconnected",
  message: isTauriRuntime()
    ? "토큰은 현재 실행 세션의 Rust 메모리에만 보관됩니다."
    : "브라우저 미리보기 모드 · 실제 연결은 Tauri 실행이 필요합니다.",
  desktopRuntime: isTauriRuntime(),
  setTokenInput: (tokenInput) => set({ tokenInput }),
  connect: async () => {
    const token = get().tokenInput.trim();
    if (!token) {
      set({ status: "error", message: "Persistent API Token을 입력해주시와요." });
      return;
    }
    set({ status: "testing", message: "NovelAI 연결을 확인하는 중이랍니다…" });
    try {
      await setNovelAiToken(token);
      const result = await testNovelAiConnection();
      set({ status: "connected", message: result, tokenInput: "" });
    } catch (error) {
      await clearNovelAiToken().catch(() => undefined);
      set({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },
  disconnect: async () => {
    await clearNovelAiToken().catch(() => undefined);
    set({ status: "disconnected", message: "NovelAI 연결을 해제했답니다.", tokenInput: "" });
  },
}));
