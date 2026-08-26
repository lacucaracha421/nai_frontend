import { invoke } from "@tauri-apps/api/core";

export type TranslationProvider = "ollama" | "openrouter";

export type TranslationConfig = {
  provider: TranslationProvider;
  model: string;
  baseUrl?: string;
};

export type TranslationKeyStatus = {
  ollama: boolean;
  openrouter: boolean;
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function setTranslationApiKey(provider: TranslationProvider, apiKey: string) {
  if (!isTauriRuntime()) throw new Error("API key storage is only available in the Tauri app.");
  await invoke("set_translation_api_key", { provider, apiKey });
}

export async function clearTranslationApiKey(provider: TranslationProvider) {
  if (isTauriRuntime()) await invoke("clear_translation_api_key", { provider });
}

export async function getTranslationKeyStatus() {
  if (!isTauriRuntime()) return { ollama: false, openrouter: false };
  return invoke<TranslationKeyStatus>("translation_key_status");
}

export async function testTranslationProvider(config: TranslationConfig) {
  if (!isTauriRuntime()) throw new Error("Translation API calls require the Tauri app.");
  return invoke<string>("test_translation_provider", { config });
}

export async function translateSelection(config: TranslationConfig, text: string) {
  if (!isTauriRuntime()) throw new Error("Translation API calls require the Tauri app.");
  return invoke<string>("translate_selection", { config, text });
}
