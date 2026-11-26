use crate::{
    novelai::{self, GeneratedImage, ImageCacheState, NovelAiQuota, NovelAiState},
    save,
    tagdb::{self, LocalTagResult, TagDbState},
    translation::{self, TranslationConfig, TranslationKeyStatus, TranslationProvider},
};
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn set_novelai_token(state: State<'_, NovelAiState>, token: String) -> Result<(), String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("NovelAI API token cannot be empty.".to_string());
    }
    novelai::save_persistent_token(&token)?;
    state.set_token(token)
}

#[tauri::command]
pub fn restore_novelai_token(state: State<'_, NovelAiState>) -> Result<bool, String> {
    let Some(token) = novelai::load_persistent_token()? else {
        return Ok(false);
    };
    state.set_token(token)?;
    Ok(true)
}

#[tauri::command]
pub fn export_novelai_token() -> Result<Option<String>, String> {
    novelai::load_persistent_token()
}

#[tauri::command]
pub fn clear_novelai_token(state: State<'_, NovelAiState>) -> Result<(), String> {
    state.clear_token()?;
    novelai::delete_persistent_token()
}

#[tauri::command]
pub async fn test_novelai_connection(state: State<'_, NovelAiState>) -> Result<String, String> {
    let token = state.token()?;
    novelai::test_connection(&token).await
}

#[tauri::command]
pub async fn novelai_quota(state: State<'_, NovelAiState>) -> Result<NovelAiQuota, String> {
    let token = state.token()?;
    novelai::quota(&token).await
}

#[tauri::command]
pub async fn novelai_generate(
    state: State<'_, NovelAiState>,
    cache: State<'_, ImageCacheState>,
    request: Value,
    reference_images: Option<Vec<String>>,
) -> Result<Vec<GeneratedImage>, String> {
    let token = state.token()?;
    novelai::generate(&token, request, reference_images.unwrap_or_default(), &cache).await
}

#[tauri::command]
pub async fn novelai_upscale(
    state: State<'_, NovelAiState>,
    cache: State<'_, ImageCacheState>,
    image_path: String,
) -> Result<Vec<GeneratedImage>, String> {
    let token = state.token()?;
    novelai::upscale(&token, image_path, &cache).await
}

#[tauri::command]
pub fn set_translation_api_key(provider: String, api_key: String) -> Result<(), String> {
    let provider = TranslationProvider::parse(&provider)?;
    translation::save_api_key(&provider, &api_key)
}

#[tauri::command]
pub fn clear_translation_api_key(provider: String) -> Result<(), String> {
    let provider = TranslationProvider::parse(&provider)?;
    translation::clear_api_key(&provider)
}

#[tauri::command]
pub fn translation_key_status() -> Result<TranslationKeyStatus, String> {
    translation::key_status()
}

#[tauri::command]
pub async fn test_translation_provider(config: TranslationConfig) -> Result<String, String> {
    translation::test(&config).await
}

#[tauri::command]
pub async fn translate_selection(config: TranslationConfig, text: String) -> Result<String, String> {
    translation::translate(&config, &text).await
}

#[tauri::command]
pub fn search_local_tags(
    state: State<'_, TagDbState>,
    query: String,
    categories: Option<Vec<String>>,
    limit: Option<usize>,
) -> Result<Vec<LocalTagResult>, String> {
    tagdb::search(&state, &query, categories.as_deref(), limit.unwrap_or(36).clamp(1, 64))
}

#[tauri::command]
pub fn favorite_local_tags(
    state: State<'_, TagDbState>,
    keys: Vec<String>,
    categories: Option<Vec<String>>,
) -> Result<Vec<LocalTagResult>, String> {
    tagdb::favorites(&state, &keys, categories.as_deref())
}

/// Android IPC is JSON-only; decode the explicit base64 payload before saving.
#[tauri::command]
pub async fn save_image(app: AppHandle, image_base64: String, filename: String) -> Result<String, String> {
    let bytes = save::decode_image_base64(&image_base64)?;
    let directory = save::save_directory(&app)?;
    let path = save::write_image(&directory, &filename, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

fn normalize_sync_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("동기화 서버 주소가 비어 있습니다.".to_string());
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("동기화 서버 주소는 http:// 또는 https://로 시작해야 합니다.".to_string());
    }
    Ok(trimmed.to_string())
}

fn sync_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("HTTP 클라이언트 초기화 실패: {error}"))
}

#[tauri::command]
pub async fn sync_remote_state_get(base_url: String) -> Result<Value, String> {
    let base = normalize_sync_base_url(&base_url)?;
    let client = sync_http_client()?;
    let response = client
        .get(format!("{base}/api/state"))
        .send()
        .await
        .map_err(|error| format!("동기화 서버 연결 실패: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("동기화 서버 응답 오류 ({status})"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("동기화 데이터 파싱 실패: {error}"))
}

#[tauri::command]
pub async fn sync_remote_state_put(base_url: String, storage: Value) -> Result<(), String> {
    let base = normalize_sync_base_url(&base_url)?;
    let client = sync_http_client()?;
    let response = client
        .put(format!("{base}/api/state"))
        .json(&serde_json::json!({ "storage": storage }))
        .send()
        .await
        .map_err(|error| format!("동기화 저장 실패: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("동기화 저장 오류 ({status})"));
    }
    Ok(())
}
