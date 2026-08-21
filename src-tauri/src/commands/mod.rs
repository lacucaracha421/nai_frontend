use crate::novelai::{self, GeneratedImage, NovelAiState};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn set_novelai_token(state: State<'_, NovelAiState>, token: String) -> Result<(), String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("NovelAI API token cannot be empty.".to_string());
    }
    state.set_token(token)
}

#[tauri::command]
pub fn clear_novelai_token(state: State<'_, NovelAiState>) -> Result<(), String> {
    state.clear_token()
}

#[tauri::command]
pub async fn test_novelai_connection(state: State<'_, NovelAiState>) -> Result<String, String> {
    let token = state.token()?;
    novelai::test_connection(&token).await
}

#[tauri::command]
pub async fn novelai_generate(
    state: State<'_, NovelAiState>,
    request: Value,
) -> Result<Vec<GeneratedImage>, String> {
    let token = state.token()?;
    novelai::generate(&token, request).await
}
