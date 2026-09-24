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
        // Without a deadline a request stalled across Android suspend never settles.
        .connect_timeout(std::time::Duration::from_secs(15))
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

/// The site's dedicated upscaler model. It is shared by every V5 generation
/// regardless of whether the image came from V5 Full or V5 Curated.
const UPSCALE_MODEL: &str = "nai-diffusion-5-curated";

fn upscale_request_json() -> Value {
    json!({
        "image": "image",
        "model": UPSCALE_MODEL,
        "declared_blur_sigma": 0
    })
}

/// Multipart body used by the NovelAI web client: an `image` PNG part and a
/// `request` JSON part, both sent as browser Blobs (filename "blob").
fn upscale_form(source: Vec<u8>) -> Result<Form, String> {
    let image = Part::bytes(source)
        .file_name("blob")
        .mime_str("image/png")
        .map_err(|error| format!("Could not prepare upscale image payload: {error}"))?;
    let request = Part::bytes(upscale_request_json().to_string().into_bytes())
        .file_name("blob")
        .mime_str("application/json")
        .map_err(|error| format!("Could not prepare upscale request payload: {error}"))?;
    Ok(Form::new().part("image", image).part("request", request))
}

/// UTC timestamp in JavaScript `Date.prototype.toISOString()` form.
fn iso_timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let since_epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    iso_timestamp(since_epoch.as_secs() as i64, since_epoch.subsec_millis())
}

fn iso_timestamp(unix_seconds: i64, millis: u32) -> String {
    let days = unix_seconds.div_euclid(86_400);
    let seconds_of_day = unix_seconds.rem_euclid(86_400);
    // Howard Hinnant's civil-from-days algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

/// Random 6-character id, like the web client's `Math.random().toString(36)`.
fn random_correlation_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..6].to_string()
}

pub async fn upscale(
    token: &str,
    image_path: String,
    cache: &ImageCacheState,
) -> Result<Vec<GeneratedImage>, String> {
    upscale_at(IMAGE_API_BASE, token, &image_path, cache).await
}

async fn upscale_at(
    base_url: &str,
    token: &str,
    image_path: &str,
    cache: &ImageCacheState,
) -> Result<Vec<GeneratedImage>, String> {
    let source = cached_image_bytes(cache, image_path)?;
    let (width, height) = png_dimensions(&source)
        .ok_or_else(|| "Could not determine upscale source dimensions.".to_string())?;

    let source_pixels = u64::from(width) * u64::from(height);
    let upscale_pixel_limit = 1024_u64 * 1024_u64;
    if source_pixels > upscale_pixel_limit {
        return Err(format!(
            "전용 Upscale은 총 픽셀 면적이 1024×1024 이하인 원본에서 사용할 수 있사와요. (현재 {width}×{height})"
        ));
    }

    let correlation_id = random_correlation_id();
    let response = client()?
        .post(format!("{base_url}/ai/upscale"))
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .header("x-correlation-id", correlation_id.as_str())
        .header("x-initiated-at", iso_timestamp_now())
        .multipart(upscale_form(source)?)
        .send()
        .await
        .map_err(|e| format!("NovelAI upscale request failed [{correlation_id}]: {e}"))?;

    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read NovelAI upscale response [{correlation_id}]: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "NovelAI upscale API error ({status}) [request {correlation_id}]: {}",
            compact_error(&String::from_utf8_lossy(&bytes))
        ));
    }
    parse_upscale_archive(&bytes, &correlation_id, cache)
}


#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelAiUsage {
    pub percent: Option<f64>,
    pub is_negative: Option<bool>,
    pub time_until_next_percent: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelAiQuota {
    pub anlas: Option<i64>,
    pub subscription_anlas: Option<i64>,
    pub paid_anlas: Option<i64>,
    pub tier: Option<i64>,
    /// V5 usage limit ("battery"). `None` when the account response has no
    /// usable `usage` object.
    pub usage: Option<NovelAiUsage>,
}

fn value_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| value.as_i64().or_else(|| value.as_f64().map(|v| v.round() as i64)))
}

fn parse_usage(value: Option<&Value>) -> Option<NovelAiUsage> {
    let usage = value?.as_object()?;
    let parsed = NovelAiUsage {
        percent: usage.get("percent").and_then(Value::as_f64),
        is_negative: usage.get("isNegative").and_then(Value::as_bool),
        time_until_next_percent: value_i64(usage.get("timeUntilNextPercent")),
    };
    (parsed.percent.is_some() || parsed.is_negative.is_some()).then_some(parsed)
}

fn parse_quota(subscription: &Value) -> NovelAiQuota {
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
    NovelAiQuota {
        anlas,
        subscription_anlas: fixed,
        paid_anlas: purchased,
        tier: value_i64(subscription.get("tier")),
        usage: parse_usage(subscription.get("usage")),
    }
}

pub async fn quota(token: &str) -> Result<NovelAiQuota, String> {
    let subscription_response = client()?
        .get(format!("{IMAGE_API_BASE}/user/subscription"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        // The UI refreshes quota once at a time; a stalled read must settle.
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("Could not read NovelAI subscription status: {error}"))?;

    let subscription_status = subscription_response.status();
    let body = subscription_response
        .text()
        .await
        .map_err(|error| format!("Could not read NovelAI subscription status: {error}"))?;
    if !subscription_status.is_success() {
        return Err(format!(
            "NovelAI subscription API error ({subscription_status}): {}",
            compact_error(&body)
        ));
    }
    let subscription: Value = serde_json::from_str(&body)
        .map_err(|error| format!("NovelAI returned invalid subscription data: {error}"))?;
    Ok(parse_quota(&subscription))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    fn temp_cache(name: &str) -> ImageCacheState {
        let dir = std::env::temp_dir().join(format!("nai-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        ImageCacheState { dir }
    }

    struct CapturedRequest {
        head: String,
        body: Vec<u8>,
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|window| window == needle)
    }

    fn dechunk(mut raw: &[u8]) -> Vec<u8> {
        let mut body = Vec::new();
        loop {
            let line_end = find(raw, b"\r\n").unwrap();
            let size = usize::from_str_radix(std::str::from_utf8(&raw[..line_end]).unwrap().trim(), 16).unwrap();
            raw = &raw[line_end + 2..];
            if size == 0 {
                return body;
            }
            body.extend_from_slice(&raw[..size]);
            raw = &raw[size + 2..];
        }
    }

    /// One-shot local HTTP server: captures the request, replies with `response_body`.
    fn serve_once(status_line: &'static str, content_type: &'static str, response_body: Vec<u8>) -> (String, mpsc::Receiver<CapturedRequest>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buffer = [0_u8; 16 * 1024];
            let (head, body) = loop {
                let read = stream.read(&mut buffer).unwrap();
                raw.extend_from_slice(&buffer[..read]);
                if let Some(head_end) = find(&raw, b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&raw[..head_end]).into_owned();
                    let body = &raw[head_end + 4..];
                    if let Some(length) = header(&head, "content-length") {
                        let length = length.parse::<usize>().unwrap();
                        if body.len() >= length {
                            break (head, body[..length].to_vec());
                        }
                    } else if body.ends_with(b"0\r\n\r\n") {
                        break (head, dechunk(body));
                    }
                }
                assert!(read > 0, "client closed the connection early");
            };
            sender.send(CapturedRequest { head, body }).unwrap();
            let reply = format!(
                "{status_line}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                response_body.len()
            );
            stream.write_all(reply.as_bytes()).unwrap();
            stream.write_all(&response_body).unwrap();
        });
        (base, receiver)
    }

    fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
        head.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case(name).then(|| value.trim())
        })
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn upscale_sends_the_novelai_site_multipart_request_and_reads_the_zip() {
        let cache = temp_cache("upscale");
        let source = png_header(832, 1216);
        let source_path = cache.dir.join("generation-abc-0.png");
        fs::write(&source_path, &source).unwrap();
        let upscaled = png_header(1664, 2432);
        let (base, captured) = serve_once(
            "HTTP/1.1 200 OK",
            "application/zip",
            zip_with(&[("image_0.png", &upscaled)]),
        );

        let images = tauri::async_runtime::block_on(upscale_at(
            &base,
            " secret-token ",
            source_path.to_str().unwrap(),
            &cache,
        ))
        .unwrap();

        let request = captured.recv().unwrap();
        let mut lines = request.head.lines();
        assert_eq!(lines.next(), Some("POST /ai/upscale HTTP/1.1"));
        assert_eq!(header(&request.head, "authorization"), Some("Bearer secret-token"));
        let correlation = header(&request.head, "x-correlation-id").unwrap();
        assert_eq!(correlation.len(), 6);
        assert!(correlation.chars().all(|c| c.is_ascii_alphanumeric()));
        let initiated = header(&request.head, "x-initiated-at").unwrap();
        assert_eq!(initiated.len(), "2026-09-24T01:02:03.456Z".len());
        assert!(initiated.ends_with('Z') && initiated.as_bytes()[10] == b'T');
        let content_type = header(&request.head, "content-type").unwrap();
        let boundary = content_type
            .strip_prefix("multipart/form-data; boundary=")
            .expect("multipart content type");

        // Exact part layout: image (PNG blob) first, then request (JSON blob).
        let body = request.body;
        let delimiter = format!("--{boundary}\r\n");
        let parts = {
            let mut parts = Vec::new();
            let mut rest = &body[..];
            while let Some(start) = find(rest, delimiter.as_bytes()) {
                rest = &rest[start + delimiter.len()..];
                let end = find(rest, format!("\r\n--{boundary}").as_bytes()).unwrap();
                parts.push(rest[..end].to_vec());
                rest = &rest[end + 2..];
            }
            parts
        };
        assert_eq!(parts.len(), 2);
        let split = |part: &[u8]| {
            let at = find(part, b"\r\n\r\n").unwrap();
            (String::from_utf8_lossy(&part[..at]).into_owned(), part[at + 4..].to_vec())
        };
        let (image_head, image_body) = split(&parts[0]);
        assert_eq!(
            image_head,
            "Content-Disposition: form-data; name=\"image\"; filename=\"blob\"\r\nContent-Type: image/png"
        );
        assert_eq!(image_body, source);
        let (request_head, request_body) = split(&parts[1]);
        assert_eq!(
            request_head,
            "Content-Disposition: form-data; name=\"request\"; filename=\"blob\"\r\nContent-Type: application/json"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&request_body).unwrap(),
            json!({"image": "image", "model": "nai-diffusion-5-curated", "declared_blur_sigma": 0})
        );
        assert!(body.ends_with(format!("\r\n--{boundary}--\r\n").as_bytes()));

        assert_eq!(images.len(), 1);
        assert_eq!((images[0].width, images[0].height), (1664, 2432));
        assert_eq!(fs::read(&images[0].path).unwrap(), upscaled);
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn upscale_reports_the_novelai_error_body() {
        let cache = temp_cache("upscale-error");
        let source_path = cache.dir.join("generation-abc-0.png");
        fs::write(&source_path, png_header(832, 1216)).unwrap();
        let (base, _captured) = serve_once(
            "HTTP/1.1 400 Bad Request",
            "application/json",
            br#"{"statusCode":400,"message":"Validation error: model is required"}"#.to_vec(),
        );
        let error = tauri::async_runtime::block_on(upscale_at(
            &base,
            "token",
            source_path.to_str().unwrap(),
            &cache,
        ))
        .unwrap_err();
        assert!(error.contains("400"), "{error}");
        assert!(error.contains("Validation error: model is required"), "{error}");
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn formats_initiated_at_like_javascript_iso_strings() {
        assert_eq!(iso_timestamp(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(951_782_400, 7), "2000-02-29T00:00:00.007Z");
        assert_eq!(iso_timestamp(1_790_217_723, 456), "2026-09-24T02:42:03.456Z");
    }

    #[test]
    fn parses_v5_usage_and_tolerates_missing_fields() {
        let full = parse_quota(&json!({
            "tier": 3,
            "trainingStepsLeft": {"fixedTrainingStepsLeft": 9898, "purchasedTrainingSteps": 100},
            "usage": {"percent": 72, "isNegative": false, "timeUntilNextPercent": 7888}
        }));
        assert_eq!(full.anlas, Some(9998));
        assert_eq!(full.tier, Some(3));
        assert_eq!(
            full.usage,
            Some(NovelAiUsage {
                percent: Some(72.0),
                is_negative: Some(false),
                time_until_next_percent: Some(7888)
            })
        );

        let partial = parse_quota(&json!({"usage": {"isNegative": true}}));
        assert_eq!(partial.anlas, None);
        assert_eq!(
            partial.usage,
            Some(NovelAiUsage { percent: None, is_negative: Some(true), time_until_next_percent: None })
        );

        for usage in [json!(null), json!({}), json!("72%"), json!({"timeUntilNextPercent": 5})] {
            assert_eq!(parse_quota(&json!({"usage": usage})).usage, None);
        }
        assert_eq!(parse_quota(&json!({})).usage, None);
    }
}
