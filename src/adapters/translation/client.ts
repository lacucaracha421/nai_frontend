import { invoke } from "@tauri-apps/api/core";
import { apiJson, isTauriRuntime, isWebServerRuntime } from "../webApi";

export type TranslationProvider = "ollama" | "openrouter" | "neuralwatt" | "gemini";

export type TranslationConfig = {
  provider: TranslationProvider;
  model: string;
  baseUrl?: string;
};

export type TranslationKeyStatus = {
  ollama: boolean;
  openrouter: boolean;
  neuralwatt: boolean;
  gemini: boolean;
};

export async function setTranslationApiKey(provider: TranslationProvider, apiKey: string) {
  if (isTauriRuntime()) {
    await invoke("set_translation_api_key", { provider, apiKey });
    return;
  }
  if (isWebServerRuntime()) {
    await apiJson("/api/translation/key", { method: "POST", body: JSON.stringify({ provider, apiKey }) });
    return;
  }
  throw new Error("API key storage is only available in the Tauri app or web server.");
}

export async function clearTranslationApiKey(provider: TranslationProvider) {
  if (isTauriRuntime()) {
    await invoke("clear_translation_api_key", { provider });
    return;
  }
  if (isWebServerRuntime()) {
    await apiJson(`/api/translation/key/${encodeURIComponent(provider)}`, { method: "DELETE" });
  }
}

export async function getTranslationKeyStatus() {
  if (isTauriRuntime()) return invoke<TranslationKeyStatus>("translation_key_status");
  if (isWebServerRuntime()) return apiJson<TranslationKeyStatus>("/api/translation/keys");
  return { ollama: false, openrouter: false, neuralwatt: false, gemini: false };
}

export async function testTranslationProvider(config: TranslationConfig) {
  if (isTauriRuntime()) return invoke<string>("test_translation_provider", { config });
  if (isWebServerRuntime()) {
    const res = await apiJson<{ message: string }>("/api/translation/test", {
      method: "POST",
      body: JSON.stringify({ config }),
    });
    return res.message;
  }
  throw new Error("Translation API calls require the Tauri app or web server.");
}

export async function translateSelection(config: TranslationConfig, text: string) {
  if (isTauriRuntime()) return invoke<string>("translate_selection", { config, text });
  if (isWebServerRuntime()) {
    const res = await apiJson<{ text: string }>("/api/translation/translate", {
      method: "POST",
      body: JSON.stringify({ config, text }),
    });
    return res.text;
  }
  throw new Error("Translation API calls require the Tauri app or web server.");
}
