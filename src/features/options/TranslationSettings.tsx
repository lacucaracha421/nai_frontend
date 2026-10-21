import { useEffect } from "react";
import { useTranslationStore } from "../../stores/translationStore";

export function TranslationSettings() {
  const provider = useTranslationStore((s) => s.provider);
  const ollamaBaseUrl = useTranslationStore((s) => s.ollamaBaseUrl);
  const ollamaModel = useTranslationStore((s) => s.ollamaModel);
  const openRouterModel = useTranslationStore((s) => s.openRouterModel);
  const neuralwattModel = useTranslationStore((s) => s.neuralwattModel);
  const ollamaKeyInput = useTranslationStore((s) => s.ollamaKeyInput);
  const openRouterKeyInput = useTranslationStore((s) => s.openRouterKeyInput);
  const neuralwattKeyInput = useTranslationStore((s) => s.neuralwattKeyInput);
  const keyStatus = useTranslationStore((s) => s.keyStatus);
  const status = useTranslationStore((s) => s.status);
  const message = useTranslationStore((s) => s.message);
  const setProvider = useTranslationStore((s) => s.setProvider);
  const setOllamaBaseUrl = useTranslationStore((s) => s.setOllamaBaseUrl);
  const setOllamaModel = useTranslationStore((s) => s.setOllamaModel);
  const setOpenRouterModel = useTranslationStore((s) => s.setOpenRouterModel);
  const setNeuralwattModel = useTranslationStore((s) => s.setNeuralwattModel);
  const setKeyInput = useTranslationStore((s) => s.setKeyInput);
  const refreshKeyStatus = useTranslationStore((s) => s.refreshKeyStatus);
  const saveKey = useTranslationStore((s) => s.saveKey);
  const clearKey = useTranslationStore((s) => s.clearKey);
  const test = useTranslationStore((s) => s.test);

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  const busy = status === "saving" || status === "testing";
  const model = provider === "ollama" ? ollamaModel : provider === "neuralwatt" ? neuralwattModel : openRouterModel;
  const keyInput = provider === "ollama" ? ollamaKeyInput : provider === "neuralwatt" ? neuralwattKeyInput : openRouterKeyInput;
  const setModel = provider === "ollama" ? setOllamaModel : provider === "neuralwatt" ? setNeuralwattModel : setOpenRouterModel;
  const keySaved = keyStatus[provider];

  return (
    <section className="translation-settings">
      <h3>Translation</h3>
      <p className="muted">Korean to English. Only the selected prompt text is translated.</p>

      <div className="segmented translation-provider">
        <button className={provider === "ollama" ? "active" : ""} onClick={() => setProvider("ollama")}>Ollama</button>
        <button className={provider === "openrouter" ? "active" : ""} onClick={() => setProvider("openrouter")}>OpenRouter</button>
        <button className={provider === "neuralwatt" ? "active" : ""} onClick={() => setProvider("neuralwatt")}>Neuralwatt</button>
      </div>

      <label className="translation-field">
        Model ID
        <input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={provider === "ollama" ? "gemma3 or a cloud model" : provider === "neuralwatt" ? "deepseek-v4-flash" : "provider/model"}
          list={provider === "neuralwatt" ? "neuralwatt-translation-models" : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {provider === "neuralwatt" && (
          <datalist id="neuralwatt-translation-models">
            <option value="deepseek-v4-flash" />
            <option value="deepseek-v4.1-flash" />
          </datalist>
        )}
      </label>

      {provider === "ollama" && (
        <label className="translation-field">
          Ollama Base URL
          <input
            value={ollamaBaseUrl}
            onChange={(event) => setOllamaBaseUrl(event.target.value)}
            placeholder="http://localhost:11434"
            autoComplete="off"
            spellCheck={false}
          />
          <small>Local Ollama needs no key. For direct Ollama Cloud use https://ollama.com and save an API key below.</small>
        </label>
      )}

      <label className="translation-field">
        API Key {provider === "ollama" ? "(optional)" : ""}
        <div className="token-row">
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(provider, event.target.value)}
            placeholder={keySaved ? "Saved - enter a new key to replace" : "API key"}
          />
          <button disabled={busy || !keyInput.trim()} onClick={() => void saveKey(provider)}>Save</button>
        </div>
      </label>

      <div className="translation-actions">
        <button disabled={busy || !model.trim()} onClick={() => void test()}>{status === "testing" ? "Testing..." : "Test"}</button>
        {keySaved && <button disabled={busy} onClick={() => void clearKey(provider)}>Clear key</button>}
        <span className={status === "error" ? "translation-status error" : "translation-status"}>
          {message || (keySaved ? "API key saved securely" : provider === "ollama" ? "No API key saved" : "API key required")}
        </span>
      </div>
    </section>
  );
}
