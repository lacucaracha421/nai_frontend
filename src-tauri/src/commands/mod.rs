use crate::{
    novelai::{self, GeneratedImage, ImageCacheState, NovelAiQuota, NovelAiState},
    prombot::{self, FavoriteCatalog, PrombotState},
    save,
    tagdb::{self, LocalTagResult, TagDbState},
    translation::{self, TranslationConfig, TranslationKeyStatus, TranslationProvider},
};
use serde_json::Value;
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, State,
};

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
) -> Result<Vec<GeneratedImage>, String> {
    let token = state.token()?;
    novelai::generate(&token, request, &cache).await
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

#[tauri::command]
pub async fn open_prombot_webview(app: AppHandle) -> Result<(), String> {
    prombot::open(app)
}

#[tauri::command]
pub fn prombot_favorites(state: State<'_, PrombotState>) -> Result<Vec<String>, String> {
    prombot::favorites(state)
}

#[tauri::command]
pub async fn prombot_favorite_catalog(keys: Vec<String>) -> Result<FavoriteCatalog, String> {
    prombot::favorite_catalog(keys).await
}

/// Saves PNG or WebP bytes (raw IPC body) into the app's save folder. The file
/// name is sent URI-encoded in the `x-filename` header; its extension follows
/// the detected format.
#[tauri::command]
pub async fn save_image(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Save expects raw image bytes.".to_string());
    };
    let filename = request
        .headers()
        .get("x-filename")
        .and_then(|value| value.to_str().ok())
        .map(save::decode_uri_component)
        .unwrap_or_default();
    let directory = save::save_directory(&app)?;
    let path = save::write_image(&directory, &filename, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}
