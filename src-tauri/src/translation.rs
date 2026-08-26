use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const TOKEN_SERVICE: &str = "local.nai.v5studio";
const OLLAMA_ACCOUNT: &str = "translation-ollama-api-key";
const OPENROUTER_ACCOUNT: &str = "translation-openrouter-api-key";
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

const TRANSLATION_SYSTEM_PROMPT: &str = r#"Translate the selected Korean text into English for a NovelAI image prompt.
Preserve the original writing style: natural-language prose stays natural-language, while tag-like fragments stay concise and tag-like.
Preserve existing English text, punctuation, line breaks, quotation marks, and NovelAI prompt syntax such as {}, [], (), weights, and prefixes whenever possible.
Do not add explanations, commentary, labels, or quotation marks around the answer.
Return only the translated text."#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranslationProvider {
    Ollama,
    Openrouter,
}
impl TranslationProvider {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "ollama" => Ok(Self::Ollama),
            "openrouter" => Ok(Self::Openrouter),
            _ => Err("지원하지 않는 번역 provider랍니다.".to_string()),
        }
    }

    fn account(&self) -> &'static str {
        match self {
            Self::Ollama => OLLAMA_ACCOUNT,
            Self::Openrouter => OPENROUTER_ACCOUNT,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationConfig {
    pub provider: TranslationProvider,
    pub model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TranslationKeyStatus {
    pub ollama: bool,
    pub openrouter: bool,
}
fn ensure_credential_store() -> Result<(), String> {
    if keyring_core::get_default_store().is_some() {
        return Ok(());
    }

    #[cfg(target_os = "android")]
    {
        let store = android_native_keyring_store::Store::new()
            .map_err(|error| format!("Could not initialize Android credential store: {error}"))?;
        keyring_core::set_default_store(store);
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let store = windows_native_keyring_store::Store::new()
            .map_err(|error| format!("Could not initialize Windows credential store: {error}"))?;
        keyring_core::set_default_store(store);
        return Ok(());
    }

    #[cfg(not(any(target_os = "android", target_os = "windows")))]
    {
        Err("Secure credential storage is not configured for this platform.".to_string())
    }
}
fn key_entry(provider: &TranslationProvider) -> Result<keyring_core::Entry, String> {
    ensure_credential_store()?;
    keyring_core::Entry::new(TOKEN_SERVICE, provider.account())
        .map_err(|error| format!("Could not open the local credential store: {error}"))
}

fn load_api_key(provider: &TranslationProvider) -> Result<Option<String>, String> {
    let entry = key_entry(provider)?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

pub fn save_api_key(provider: &TranslationProvider, api_key: &str) -> Result<(), String> {
    let value = api_key.trim();
    if value.is_empty() {
        return Err("API key가 비어 있사와요.".to_string());
    }
    key_entry(provider)?
        .set_password(value)
        .map_err(|error| format!("Could not save the translation API key locally: {error}"))
}

pub fn clear_api_key(provider: &TranslationProvider) -> Result<(), String> {
    match key_entry(provider)?.delete_credential() {
        Ok(()) | Err(_) => Ok(()),
    }
}
pub fn key_status() -> Result<TranslationKeyStatus, String> {
    Ok(TranslationKeyStatus {
        ollama: load_api_key(&TranslationProvider::Ollama)?.is_some(),
        openrouter: load_api_key(&TranslationProvider::Openrouter)?.is_some(),
    })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("nai-v5-translation/0.4.8")
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))
}

fn model(config: &TranslationConfig) -> Result<&str, String> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err("번역 모델을 먼저 입력하시와요.".to_string());
    }
    Ok(model)
}

fn compact_error(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let shortened = compact.chars().take(360).collect::<String>();
    if shortened.chars().count() < compact.chars().count() {
        format!("{shortened}…")
    } else {
        compact
    }
}
async fn response_json(response: reqwest::Response, provider: &str) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{provider} API error ({status}): {}", compact_error(&body)));
    }
    serde_json::from_str(&body)
        .map_err(|error| format!("{provider} returned invalid JSON: {error}"))
}

fn content_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    value.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| {
                part.as_str()
                    .map(str::to_string)
                    .or_else(|| part.get("text").and_then(Value::as_str).map(str::to_string))
            })
            .collect::<Vec<_>>()
            .join("")
    })
}

fn clean_translation(text: String) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("번역 모델이 빈 응답을 반환했사와요.".to_string());
    }
    Ok(trimmed.to_string())
}
fn ollama_chat_url(base_url: Option<&str>) -> String {
    let base = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_OLLAMA_URL)
        .trim_end_matches('/');
    if base.ends_with("/api/chat") {
        base.to_string()
    } else if base.ends_with("/api") {
        format!("{base}/chat")
    } else {
        format!("{base}/api/chat")
    }
}

async fn translate_ollama(config: &TranslationConfig, text: &str) -> Result<String, String> {
    let model = model(config)?;
    let payload = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": TRANSLATION_SYSTEM_PROMPT},
            {"role": "user", "content": text}
        ],
        "stream": false,
        "options": {"temperature": 0}
    });
    let mut request = client()?
        .post(ollama_chat_url(config.base_url.as_deref()))
        .header(CONTENT_TYPE, "application/json")
        .json(&payload);
    if let Some(api_key) = load_api_key(&TranslationProvider::Ollama)? {
        request = request.header(AUTHORIZATION, format!("Bearer {api_key}"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Ollama request failed: {error}"))?;
    let value = response_json(response, "Ollama").await?;
    let content = value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(content_text)
        .ok_or_else(|| "Ollama 응답에 번역 텍스트가 없사와요.".to_string())?;
    clean_translation(content)
}

async fn translate_openrouter(config: &TranslationConfig, text: &str) -> Result<String, String> {
    let model = model(config)?;
    let api_key = load_api_key(&TranslationProvider::Openrouter)?
        .ok_or_else(|| "OpenRouter API key를 먼저 저장하시와요.".to_string())?;
    let payload = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": TRANSLATION_SYSTEM_PROMPT},
            {"role": "user", "content": text}
        ],
        "stream": false
    });
    let response = client()?
        .post(OPENROUTER_URL)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("OpenRouter request failed: {error}"))?;
    let value = response_json(response, "OpenRouter").await?;
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(content_text)
        .ok_or_else(|| "OpenRouter 응답에 번역 텍스트가 없사와요.".to_string())?;
    clean_translation(content)
}

pub async fn translate(config: &TranslationConfig, text: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("번역할 텍스트를 선택하시와요.".to_string());
    }
    match config.provider {
        TranslationProvider::Ollama => translate_ollama(config, text).await,
        TranslationProvider::Openrouter => translate_openrouter(config, text).await,
    }
}

pub async fn test(config: &TranslationConfig) -> Result<String, String> {
    translate(config, "테스트").await
}
