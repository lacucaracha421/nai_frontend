use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE}, multipart::{Form, Part}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

const IMAGE_API_BASE: &str = "https://image.novelai.net";
const V5_FULL: &str = "nai-diffusion-5-full";
const TOKEN_SERVICE: &str = "local.nai.v5studio";
const TOKEN_ACCOUNT: &str = "novelai-persistent-api-token";

fn ensure_credential_store() -> Result<(), String> {
    // Store setup is deliberately lazy. On Android the Java Activity must first
    // initialize ndk-context; doing this in Tauri's Rust setup hook can race
    // Activity.onCreate and turns a recoverable store error into a native abort.
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

fn token_entry() -> Result<keyring_core::Entry, String> {
    ensure_credential_store()?;
    keyring_core::Entry::new(TOKEN_SERVICE, TOKEN_ACCOUNT)
        .map_err(|error| format!("Could not open the local credential store: {error}"))
}

pub fn save_persistent_token(token: &str) -> Result<(), String> {
    token_entry()?
        .set_password(token)
        .map_err(|error| format!("Could not save the NovelAI token locally: {error}"))
}

pub fn load_persistent_token() -> Result<Option<String>, String> {
    let entry = token_entry()?;
    match entry.get_password() {
        Ok(token) if !token.trim().is_empty() => Ok(Some(token)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

pub fn delete_persistent_token() -> Result<(), String> {
    let entry = token_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(_) => Ok(()),
    }
}


#[derive(Default)]
pub struct NovelAiState {
    token: Mutex<Option<String>>,
}
impl NovelAiState {
    pub fn set_token(&self, token: String) -> Result<(), String> {
        *self
            .token
            .lock()
            .map_err(|_| "NovelAI token lock failed".to_string())? = Some(token);
        Ok(())
    }
    pub fn clear_token(&self) -> Result<(), String> {
        *self
            .token
            .lock()
            .map_err(|_| "NovelAI token lock failed".to_string())? = None;
        Ok(())
    }
    pub fn token(&self) -> Result<String, String> {
        self.token
            .lock()
            .map_err(|_| "NovelAI token lock failed".to_string())?
            .clone()
            .ok_or_else(|| "NovelAI Persistent API Token이 연결되지 않았습니다.".to_string())
    }
}

#[derive(Debug)]
pub struct ImageCacheState {
    pub dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub path: String,
    pub index: i64,
    pub seed: Option<i64>,
    pub width: u32,
    pub height: u32,
}

pub fn prepare_image_cache(app: &tauri::App) -> Result<ImageCacheState, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve image cache directory: {error}"))?
        .join("nai-v5-images");
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|error| format!("Could not clear old session image cache: {error}"))?;
    }
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create session image cache: {error}"))?;
    Ok(ImageCacheState { dir })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("nai-v5-s11-frontend/0.4.2")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

pub async fn test_connection(token: &str) -> Result<String, String> {
    let response = client()?
        .get(format!("{IMAGE_API_BASE}/ai/generate-image/suggest-tags"))
        .query(&[("model", V5_FULL), ("prompt", "1girl"), ("lang", "en")])
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("NovelAI connection failed: {e}"))?;
    if response.status().is_success() {
        return Ok("NovelAI V5 연결 성공".to_string());
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "NovelAI V5 connection test failed ({status}): {}",
        compact_error(&body)
    ))
}

fn decode_base64_image(encoded: &str) -> Result<Vec<u8>, String> {
    let payload = encoded.split_once(',').map(|(_, data)| data).unwrap_or(encoded);
    BASE64
        .decode(payload)
        .map_err(|error| format!("NovelAI returned invalid base64 image data: {error}"))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}

fn cache_path(cache: &ImageCacheState, kind: &str, correlation_id: &str, index: i64) -> PathBuf {
    cache.dir.join(format!("{kind}-{correlation_id}-{index}.png"))
}

fn write_cached_image(
    cache: &ImageCacheState,
    kind: &str,
    correlation_id: &str,
    index: i64,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let path = cache_path(cache, kind, correlation_id, index);
    fs::write(&path, bytes).map_err(|error| format!("Could not write generated image cache: {error}"))?;
    Ok(path)
}

async fn parse_images(
    response: reqwest::Response,
    correlation_id: &str,
    cache: &ImageCacheState,
    kind: &str,
    fallback_size: Option<(u32, u32)>,
) -> Result<Vec<GeneratedImage>, String> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "NovelAI API error ({status}) [request {correlation_id}]: {}",
            compact_error(&body)
        ));
    }

    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("NovelAI returned invalid JSON: {e}"))?;
    let images = value
        .get("images")
        .and_then(Value::as_array)
        .ok_or_else(|| "NovelAI JSON response did not include images.".to_string())?;

    images
        .iter()
        .enumerate()
        .map(|(i, image)| {
            let encoded = image
                .get("image")
                .and_then(Value::as_str)
                .ok_or_else(|| "NovelAI image entry has no base64 image.".to_string())?;
            let bytes = decode_base64_image(encoded)?;
            let index = image.get("index").and_then(Value::as_i64).unwrap_or(i as i64);
            let seed = image.get("seed").and_then(Value::as_i64);
            let (width, height) = png_dimensions(&bytes)
                .or(fallback_size)
                .ok_or_else(|| "Could not determine generated image dimensions.".to_string())?;
            let path = write_cached_image(cache, kind, correlation_id, index, &bytes)?;
            Ok(GeneratedImage {
                path: path.to_string_lossy().into_owned(),
                index,
                seed,
                width,
                height,
            })
        })
        .collect()
}

fn requested_dimensions(request: &Value) -> Option<(u32, u32)> {
    let parameters = request.get("parameters")?;
    let width = parameters.get("width")?.as_u64()?.try_into().ok()?;
    let height = parameters.get("height")?.as_u64()?.try_into().ok()?;
    Some((width, height))
}

fn cached_image_bytes(cache: &ImageCacheState, image_path: &str) -> Result<Vec<u8>, String> {
    let cache_dir = cache
        .dir
        .canonicalize()
        .map_err(|error| format!("Could not resolve image cache directory: {error}"))?;
    let requested = Path::new(image_path)
        .canonicalize()
        .map_err(|error| format!("Could not resolve cached image: {error}"))?;
    if !requested.starts_with(&cache_dir) {
        return Err("Upscale source must be an image from the current NAI session cache.".to_string());
    }
    fs::read(&requested).map_err(|error| format!("Could not read cached image: {error}"))
}

fn correlation_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    const CHARS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut out = [b'0'; 6];
    for slot in &mut out {
        *slot = CHARS[(n % CHARS.len() as u64) as usize];
        n = n.rotate_left(9) ^ 0x9E3779B97F4A7C15;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub async fn generate(
    token: &str,
    request: Value,
    cache: &ImageCacheState,
) -> Result<Vec<GeneratedImage>, String> {
    let correlation_id = correlation_id();
    let fallback_size = requested_dimensions(&request);
    let response = client()?
        .post(format!("{IMAGE_API_BASE}/ai/generate-image"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .header("x-correlation-id", correlation_id.as_str())
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("NovelAI request failed [{correlation_id}]: {e}"))?;
    parse_images(response, &correlation_id, cache, "generation", fallback_size).await
}

fn parse_upscale_archive(
    bytes: &[u8],
    correlation_id: &str,
    cache: &ImageCacheState,
) -> Result<Vec<GeneratedImage>, String> {
    // Be permissive if the service ever returns a direct PNG.
    if let Some((width, height)) = png_dimensions(bytes) {
        let path = write_cached_image(cache, "upscale", correlation_id, 0, bytes)?;
        return Ok(vec![GeneratedImage {
            path: path.to_string_lossy().into_owned(),
            index: 0,
            seed: None,
            width,
            height,
        }]);
    }

    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| format!("NovelAI upscale response was not a valid ZIP archive: {error}"))?;

    let mut images = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read NovelAI upscale ZIP entry: {error}"))?;
        if entry.is_dir() {
            continue;
        }

        let mut image = Vec::new();
        entry
            .read_to_end(&mut image)
            .map_err(|error| format!("Could not extract NovelAI upscale image: {error}"))?;

        let Some((width, height)) = png_dimensions(&image) else {
            continue;
        };

        let image_index = images.len() as i64;
        let path = write_cached_image(cache, "upscale", correlation_id, image_index, &image)?;
        images.push(GeneratedImage {
            path: path.to_string_lossy().into_owned(),
            index: image_index,
            seed: None,
            width,
            height,
        });
    }

    if images.is_empty() {
        return Err("NovelAI upscale ZIP contained no PNG image.".to_string());
    }
    Ok(images)
}

pub async fn upscale(
    token: &str,
    image_path: String,
    cache: &ImageCacheState,
) -> Result<Vec<GeneratedImage>, String> {
    let source = cached_image_bytes(cache, &image_path)?;
    let (width, height) = png_dimensions(&source)
        .ok_or_else(|| "Could not determine upscale source dimensions.".to_string())?;

    let source_pixels = u64::from(width) * u64::from(height);
    let upscale_pixel_limit = 1024_u64 * 1024_u64;
    if source_pixels > upscale_pixel_limit {
        return Err(format!(
            "전용 Upscale은 총 픽셀 면적이 1024×1024 이하인 원본에서 사용할 수 있사와요. (현재 {width}×{height})"
        ));
    }

    // Dedicated NovelAI Upscale has been inconsistent across clients / docs.
    // To improve compatibility, try a few server-compatible payload variants:
    // 1) JSON without model
    // 2) multipart/form-data without model
    // 3) JSON with model=upscale / waifu2x
    // 4) multipart/form-data with model=upscale / waifu2x
    let correlation_id = correlation_id();

    enum UpscaleBody {
        Json(Value),
        Multipart(Form),
    }

    let base_json = json!({
        "image": BASE64.encode(&source),
        "width": width,
        "height": height,
        "scale": 2
    });

    let make_form = |model: Option<&str>| -> Result<Form, String> {
        let image_part = Part::bytes(source.clone())
            .file_name("source.png")
            .mime_str("image/png")
            .map_err(|error| format!("Could not prepare upscale image payload: {error}"))?;
        let mut form = Form::new()
            .part("image", image_part)
            .text("width", width.to_string())
            .text("height", height.to_string())
            .text("scale", "2");
        if let Some(model) = model {
            form = form.text("model", model.to_string());
        }
        Ok(form)
    };

    let mut attempts: Vec<(&str, UpscaleBody)> = vec![
        ("json-no-model", UpscaleBody::Json(base_json.clone())),
        ("multipart-no-model", UpscaleBody::Multipart(make_form(None)?)),
    ];

    for candidate in ["upscale", "waifu2x", "image-upscale", "anime"] {
        let mut json_payload = base_json.clone();
        if let Some(obj) = json_payload.as_object_mut() {
            obj.insert("model".to_string(), Value::String(candidate.to_string()));
        }
        attempts.push(("json-with-model", UpscaleBody::Json(json_payload)));
        attempts.push(("multipart-with-model", UpscaleBody::Multipart(make_form(Some(candidate))?)));
    }

    let mut last_error = String::new();

    for (attempt_kind, body) in attempts {
        let builder = client()?
            .post(format!("{IMAGE_API_BASE}/ai/upscale"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(ACCEPT, "application/zip")
            .header("x-correlation-id", correlation_id.as_str());

        let response = match body {
            UpscaleBody::Json(payload) => builder
                .header(CONTENT_TYPE, "application/json")
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("NovelAI upscale failed [{correlation_id}] ({attempt_kind}): {e}"))?,
            UpscaleBody::Multipart(form) => builder
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("NovelAI upscale failed [{correlation_id}] ({attempt_kind}): {e}"))?,
        };

        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Could not read NovelAI upscale response [{correlation_id}] ({attempt_kind}): {error}"))?;

        if status.is_success() {
            return parse_upscale_archive(&bytes, &correlation_id, cache);
        }

        let body = String::from_utf8_lossy(&bytes);
        last_error = format!(
            "NovelAI upscale API error ({status}) [request {correlation_id}, {attempt_kind}]: {}",
            compact_error(&body)
        );

        let lowered = body.to_ascii_lowercase();
        let retryable_model_error = status.as_u16() == 400
            && (lowered.contains("model doesn't exist")
                || lowered.contains("model does not exist")
                || lowered.contains("invalid model")
                || lowered.contains("unknown model")
                || lowered.contains("\"model\""));

        if !retryable_model_error {
            return Err(last_error);
        }
    }

    Err(last_error)
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelAiQuota {
    pub anlas: Option<i64>,
    pub subscription_anlas: Option<i64>,
    pub paid_anlas: Option<i64>,
    pub tier: Option<i64>,
}

fn value_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| value.as_i64().or_else(|| value.as_f64().map(|v| v.round() as i64)))
}

pub async fn quota(token: &str) -> Result<NovelAiQuota, String> {
    let auth = format!("Bearer {token}");

    let subscription_response = client()?
        .get(format!("{IMAGE_API_BASE}/user/subscription"))
        .header(AUTHORIZATION, auth.clone())
        .send()
        .await
        .map_err(|error| format!("Could not read NovelAI subscription status: {error}"))?;

    let subscription_status = subscription_response.status();
    let subscription: Value = subscription_response
        .json()
        .await
        .map_err(|error| format!("NovelAI returned invalid subscription data: {error}"))?;

    if !subscription_status.is_success() {
        return Err(format!(
            "NovelAI subscription API error ({subscription_status}): {}",
            compact_error(&subscription.to_string())
        ));
    }

    let fixed = value_i64(
        subscription
            .get("trainingStepsLeft")
            .and_then(|value| value.get("fixedTrainingStepsLeft")),
    );
    let purchased = value_i64(
        subscription
            .get("trainingStepsLeft")
            .and_then(|value| value.get("purchasedTrainingSteps")),
    );
    let anlas = match (fixed, purchased) {
        (Some(a), Some(b)) => Some(a.saturating_add(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };


    Ok(NovelAiQuota {
        anlas,
        subscription_anlas: fixed,
        paid_anlas: purchased,
        tier: value_i64(subscription.get("tier")),
    })
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
