use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;

const IMAGE_API_BASE: &str = "https://image.novelai.net";

#[derive(Default)]
pub struct NovelAiState {
    token: Mutex<Option<String>>,
}

impl NovelAiState {
    pub fn set_token(&self, token: String) -> Result<(), String> {
        let mut guard = self.token.lock().map_err(|_| "NovelAI token lock failed".to_string())?;
        *guard = Some(token);
        Ok(())
    }

    pub fn clear_token(&self) -> Result<(), String> {
        let mut guard = self.token.lock().map_err(|_| "NovelAI token lock failed".to_string())?;
        *guard = None;
        Ok(())
    }

    pub fn token(&self) -> Result<String, String> {
        self.token
            .lock()
            .map_err(|_| "NovelAI token lock failed".to_string())?
            .clone()
            .ok_or_else(|| "NovelAI API token is not connected.".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub image: String,
    pub index: i64,
    pub seed: Option<i64>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("nai-frontend/0.2")
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))
}

pub async fn test_connection(token: &str) -> Result<String, String> {
    let response = client()?
        .get(format!("{IMAGE_API_BASE}/ai/generate-image/suggest-tags"))
        .query(&[
            ("model", "nai-diffusion-4-5-full"),
            ("prompt", "1girl"),
            ("lang", "en"),
        ])
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| format!("NovelAI connection failed: {error}"))?;

    if response.status().is_success() {
        return Ok("연결 성공 · 토큰은 이 실행 세션에만 보관 중이랍니다.".to_string());
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!("NovelAI connection test failed ({status}): {}", compact_error(&body)))
}

pub async fn generate(token: &str, request: Value) -> Result<Vec<GeneratedImage>, String> {
    let response = client()?
        .post(format!("{IMAGE_API_BASE}/ai/generate-image"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("NovelAI request failed: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read NovelAI response: {error}"))?;

    if !status.is_success() {
        return Err(format!("NovelAI API error ({status}): {}", compact_error(&body)));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|error| format!("NovelAI returned invalid JSON: {error}"))?;
    let images = value
        .get("images")
        .and_then(Value::as_array)
        .ok_or_else(|| "NovelAI JSON response did not include an images array.".to_string())?;

    images
        .iter()
        .enumerate()
        .map(|(fallback_index, image)| {
            let encoded = image
                .get("image")
                .and_then(Value::as_str)
                .ok_or_else(|| "NovelAI image entry did not include base64 image data.".to_string())?;
            Ok(GeneratedImage {
                image: encoded.to_string(),
                index: image
                    .get("index")
                    .and_then(Value::as_i64)
                    .unwrap_or(fallback_index as i64),
                seed: image.get("seed").and_then(Value::as_i64),
            })
        })
        .collect()
}

fn compact_error(body: &str) -> String {
    if body.trim().is_empty() {
        return "empty response".to_string();
    }
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        for key in ["message", "error", "detail"] {
            if let Some(text) = value.get(key).and_then(Value::as_str) {
                return text.to_string();
            }
        }
    }
    body.chars().take(700).collect()
}
