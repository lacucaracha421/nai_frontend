use crate::{
    novelai::{self, GeneratedImage, ImageCacheState, NovelAiQuota, NovelAiState},
    tagdb::{self, LocalTagResult, TagDbState},
};
use serde_json::Value;
use tauri::State;

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
