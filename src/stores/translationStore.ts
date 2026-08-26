import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  clearTranslationApiKey,
  getTranslationKeyStatus,
  setTranslationApiKey,
  testTranslationProvider,
  translateSelection,
  type TranslationConfig,
  type TranslationKeyStatus,
  type TranslationProvider,
} from "../adapters/translation/client";

type Status = "idle" | "saving" | "testing" | "ready" | "error";

type State = {
  provider: TranslationProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openRouterModel: string;
  ollamaKeyInput: string;
  openRouterKeyInput: string;
  keyStatus: TranslationKeyStatus;
  status: Status;
  message: string;
  translating: boolean;
  setProvider: (provider: TranslationProvider) => void;
  setOllamaBaseUrl: (value: string) => void;
  setOllamaModel: (value: string) => void;
  setOpenRouterModel: (value: string) => void;
  setKeyInput: (provider: TranslationProvider, value: string) => void;
  refreshKeyStatus: () => Promise<void>;
  saveKey: (provider: TranslationProvider) => Promise<void>;
  clearKey: (provider: TranslationProvider) => Promise<void>;
  test: () => Promise<void>;
  translate: (text: string) => Promise<string>;
};

function configFrom(state: Pick<State, "provider" | "ollamaBaseUrl" | "ollamaModel" | "openRouterModel">): TranslationConfig {
  if (state.provider === "ollama") {
    return {
      provider: "ollama",
      model: state.ollamaModel.trim(),
      baseUrl: state.ollamaBaseUrl.trim() || "http://localhost:11434",
    };
  }
  return {
    provider: "openrouter",
    model: state.openRouterModel.trim(),
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useTranslationStore = create<State>()(
  persist(
    (set, get) => ({
      provider: "ollama",
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "",
      openRouterModel: "",
      ollamaKeyInput: "",
      openRouterKeyInput: "",
      keyStatus: { ollama: false, openrouter: false },
      status: "idle",
      message: "",
      translating: false,
      setProvider: (provider) => set({ provider, message: "", status: "idle" }),
      setOllamaBaseUrl: (ollamaBaseUrl) => set({ ollamaBaseUrl }),
      setOllamaModel: (ollamaModel) => set({ ollamaModel }),
      setOpenRouterModel: (openRouterModel) => set({ openRouterModel }),
      setKeyInput: (provider, value) => set(provider === "ollama" ? { ollamaKeyInput: value } : { openRouterKeyInput: value }),

      refreshKeyStatus: async () => {
        try {
          const keyStatus = await getTranslationKeyStatus();
          set({ keyStatus });
        } catch {
          // Credential status is convenience UI. Translation requests report real errors.
        }
      },

      saveKey: async (provider) => {
        const input = provider === "ollama" ? get().ollamaKeyInput : get().openRouterKeyInput;
        if (!input.trim()) {
          set({ status: "error", message: "API key를 입력하시와요." });
          return;
        }
        set({ status: "saving", message: "" });
        try {
          await setTranslationApiKey(provider, input.trim());
          set(provider === "ollama"
            ? { ollamaKeyInput: "", status: "ready", message: "Ollama API key를 저장했사와요." }
            : { openRouterKeyInput: "", status: "ready", message: "OpenRouter API key를 저장했사와요." });
          await get().refreshKeyStatus();
        } catch (error) {
          set({ status: "error", message: errorText(error) });
        }
      },

      clearKey: async (provider) => {
        set({ status: "saving", message: "" });
        try {
          await clearTranslationApiKey(provider);
          await get().refreshKeyStatus();
          set({ status: "ready", message: "저장된 API key를 삭제했사와요." });
        } catch (error) {
          set({ status: "error", message: errorText(error) });
        }
      },

      test: async () => {
        set({ status: "testing", message: "" });
        try {
          const result = await testTranslationProvider(configFrom(get()));
          set({ status: "ready", message: `연결 성공 · ${result}` });
        } catch (error) {
          set({ status: "error", message: errorText(error) });
        }
      },

      translate: async (text) => {
        set({ translating: true, message: "" });
        try {
          const translated = await translateSelection(configFrom(get()), text);
          set({ translating: false });
          return translated;
        } catch (error) {
          const message = errorText(error);
          set({ translating: false, status: "error", message });
          throw new Error(message);
        }
      },
    }),
    {
      name: "nai-v5-translation-settings-v0.1",
      partialize: (state) => ({
        provider: state.provider,
        ollamaBaseUrl: state.ollamaBaseUrl,
        ollamaModel: state.ollamaModel,
        openRouterModel: state.openRouterModel,
      }),
    },
  ),
);
