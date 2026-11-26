use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use nai_frontend_lib::{
    character_catalog,
    novelai::{self, GeneratedImage, ImageCacheState},
    tagdb::{self, TagDbState},
    translation::{self, TranslationConfig, TranslationKeyStatus, TranslationProvider},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tower_http::services::{ServeDir, ServeFile};

const MAX_API_BODY_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    novelai_token: Option<String>,
    #[serde(default)]
    translation_keys: BTreeMap<String, String>,
}

struct SecretsStore {
    path: PathBuf,
    data: Mutex<SecretsFile>,
}

impl SecretsStore {
    fn open(path: PathBuf) -> Result<Self, String> {
        let data = if path.is_file() {
            let text = fs::read_to_string(&path)
                .map_err(|error| format!("Could not read secrets file: {error}"))?;
            serde_json::from_str::<SecretsFile>(&text)
                .map_err(|error| format!("Could not parse secrets file: {error}"))?
        } else {
            SecretsFile::default()
        };
        Ok(Self {
            path,
            data: Mutex::new(data),
        })
    }

    fn save_locked(&self, data: &SecretsFile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(data)
            .map_err(|error| format!("Could not serialize secrets: {error}"))?;
        write_atomic(&self.path, json.as_bytes(), true)
    }

    fn novelai_token(&self) -> Result<Option<String>, String> {
        let guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        Ok(guard.novelai_token.clone().filter(|t| !t.trim().is_empty()))
    }

    fn require_novelai_token(&self) -> Result<String, String> {
        self.novelai_token()?
            .ok_or_else(|| "NovelAI Persistent API Token이 연결되지 않았습니다.".to_string())
    }

    fn set_novelai_token(&self, token: String) -> Result<(), String> {
        let trimmed = token.trim().to_string();
        if trimmed.is_empty() {
            return Err("NovelAI API token cannot be empty.".to_string());
        }
        let mut guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        guard.novelai_token = Some(trimmed);
        self.save_locked(&guard)
    }

    fn clear_novelai_token(&self) -> Result<(), String> {
        let mut guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        guard.novelai_token = None;
        self.save_locked(&guard)
    }

    fn translation_key(&self, provider: &TranslationProvider) -> Result<Option<String>, String> {
        let guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        Ok(guard
            .translation_keys
            .get(provider.key_name())
            .cloned()
            .filter(|v| !v.trim().is_empty()))
    }

    fn set_translation_key(&self, provider: &TranslationProvider, key: &str) -> Result<(), String> {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            return Err("API key가 비어 있사와요.".to_string());
        }
        let mut guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        guard
            .translation_keys
            .insert(provider.key_name().to_string(), trimmed.to_string());
        self.save_locked(&guard)
    }

    fn clear_translation_key(&self, provider: &TranslationProvider) -> Result<(), String> {
        let mut guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        guard.translation_keys.remove(provider.key_name());
        self.save_locked(&guard)
    }

    fn translation_key_status(&self) -> Result<TranslationKeyStatus, String> {
        let guard = self.data.lock().map_err(|_| "Secrets lock failed".to_string())?;
        let has = |name: &str| {
            guard
                .translation_keys
                .get(name)
                .is_some_and(|v| !v.trim().is_empty())
        };
        Ok(TranslationKeyStatus {
            ollama: has("ollama"),
            openrouter: has("openrouter"),
            neuralwatt: has("neuralwatt"),
            gemini: has("gemini"),
        })
    }
}

struct SyncStateStore {
    path: PathBuf,
    storage: Mutex<BTreeMap<String, String>>,
}

impl SyncStateStore {
    fn open(path: PathBuf) -> Result<Self, String> {
        let storage = if path.is_file() {
            let text = fs::read_to_string(&path)
                .map_err(|error| format!("Could not read state file: {error}"))?;
            serde_json::from_str::<BTreeMap<String, String>>(&text)
                .map_err(|error| format!("Could not parse state file: {error}"))?
        } else {
            BTreeMap::new()
        };
        Ok(Self {
            path,
            storage: Mutex::new(storage),
        })
    }

    fn snapshot(&self) -> Result<BTreeMap<String, String>, String> {
        let guard = self.storage.lock().map_err(|_| "State lock failed".to_string())?;
        Ok(guard.clone())
    }

    fn apply_patch(&self, patch: BTreeMap<String, Option<String>>) -> Result<(), String> {
        let mut guard = self.storage.lock().map_err(|_| "State lock failed".to_string())?;
        for (key, value) in patch {
            if !is_allowed_storage_key(&key) {
                continue;
            }
            match value {
                Some(text) => {
                    guard.insert(key, text);
                }
                None => {
                    guard.remove(&key);
                }
            }
        }
        let json = serde_json::to_string(&*guard)
            .map_err(|error| format!("Could not serialize state: {error}"))?;
        write_atomic(&self.path, json.as_bytes(), false)
    }
}

fn is_allowed_storage_key(key: &str) -> bool {
    key.starts_with("nai-v5-")
        || key == "artist-tag-quick-copy.v4"
        || key == "artist-quick-copy.v1"
        || key.starts_with("artist-tag-quick-copy.")
}

fn write_atomic(path: &Path, bytes: &[u8], restricted: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create directory {}: {error}", parent.display()))?;
    }
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, bytes).map_err(|error| format!("Could not write {}: {error}", tmp.display()))?;
    #[cfg(unix)]
    if restricted {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = restricted;
    fs::rename(&tmp, path)
        .map_err(|error| format!("Could not replace {}: {error}", path.display()))?;
    Ok(())
}

struct ServerState {
    data_dir: PathBuf,
    secrets: SecretsStore,
    sync_state: SyncStateStore,
    tag_db: TagDbState,
    image_cache: ImageCacheState,
    reference_cache_dir: PathBuf,
}

fn api_error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn bad_request(message: String) -> Response {
    api_error(StatusCode::BAD_REQUEST, message)
}

fn rewrite_image_paths(images: Vec<GeneratedImage>) -> Vec<GeneratedImage> {
    images
        .into_iter()
        .map(|mut image| {
            if let Some(name) = Path::new(&image.path).file_name().and_then(|n| n.to_str()) {
                image.path = format!("/api/images/{name}");
            }
            image
        })
        .collect()
}

async fn health() -> impl IntoResponse {
    Json(json!({ "ok": true, "mode": "web" }))
}

async fn get_state(State(state): State<Arc<ServerState>>) -> Response {
    match state.sync_state.snapshot() {
        Ok(storage) => Json(json!({ "storage": storage })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

#[derive(Deserialize)]
struct StatePatchBody {
    storage: BTreeMap<String, Option<String>>,
}

async fn put_state(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<StatePatchBody>,
) -> Response {
    match state.sync_state.apply_patch(body.storage) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

#[derive(Deserialize)]
struct SetTokenBody {
    token: String,
}

async fn set_novelai_token(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<SetTokenBody>,
) -> Response {
    match state.secrets.set_novelai_token(body.token) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => bad_request(error),
    }
}

async fn novelai_token_status(State(state): State<Arc<ServerState>>) -> Response {
    match state.secrets.novelai_token() {
        Ok(token) => Json(json!({ "connected": token.is_some() })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn export_novelai_token(State(state): State<Arc<ServerState>>) -> Response {
    match state.secrets.novelai_token() {
        Ok(token) => Json(json!({ "token": token })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn clear_novelai_token(State(state): State<Arc<ServerState>>) -> Response {
    match state.secrets.clear_novelai_token() {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn test_novelai_connection(State(state): State<Arc<ServerState>>) -> Response {
    let token = match state.secrets.require_novelai_token() {
        Ok(token) => token,
        Err(error) => return api_error(StatusCode::UNAUTHORIZED, error),
    };
    match novelai::test_connection(&token).await {
        Ok(message) => Json(json!({ "message": message })).into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

async fn novelai_quota(State(state): State<Arc<ServerState>>) -> Response {
    let token = match state.secrets.require_novelai_token() {
        Ok(token) => token,
        Err(error) => return api_error(StatusCode::UNAUTHORIZED, error),
    };
    match novelai::quota(&token).await {
        Ok(quota) => Json(quota).into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateBody {
    request: Value,
    #[serde(default)]
    reference_images: Vec<String>,
}

fn resolve_reference_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 64
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid reference image id.".to_string());
    }
    Ok(dir.join(format!("{id}.png")))
}

async fn upload_reference(State(state): State<Arc<ServerState>>, body: Bytes) -> Response {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if body.len() < 24 || &body[..8] != PNG_SIGNATURE {
        return bad_request("Reference image must be a valid PNG.".to_string());
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let path = match resolve_reference_path(&state.reference_cache_dir, &id) {
        Ok(path) => path,
        Err(error) => return bad_request(error),
    };
    if let Err(error) = fs::write(&path, &body) {
        return api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Could not cache reference image: {error}"),
        );
    }
    Json(json!({
        "id": id,
        "previewUrl": format!("/api/references/{id}")
    }))
    .into_response()
}

async fn serve_reference(
    State(state): State<Arc<ServerState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let path = match resolve_reference_path(&state.reference_cache_dir, &id) {
        Ok(path) if path.is_file() => path,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    match fs::read(&path) {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "private, max-age=3600"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn novelai_generate(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<GenerateBody>,
) -> Response {
    let token = match state.secrets.require_novelai_token() {
        Ok(token) => token,
        Err(error) => return api_error(StatusCode::UNAUTHORIZED, error),
    };
    let mut resolved_refs = Vec::with_capacity(body.reference_images.len());
    for entry in body.reference_images {
        if let Some(id) = entry.strip_prefix("ref:") {
            let path = match resolve_reference_path(&state.reference_cache_dir, id) {
                Ok(path) => path,
                Err(error) => return bad_request(error),
            };
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(_) => {
                    return bad_request(
                        "캐시된 레퍼런스 이미지를 찾지 못했습니다. 레퍼런스를 다시 추가해 주세요."
                            .to_string(),
                    );
                }
            };
            resolved_refs.push(BASE64.encode(bytes));
        } else {
            resolved_refs.push(entry);
        }
    }
    match novelai::generate(&token, body.request, resolved_refs, &state.image_cache).await {
        Ok(images) => Json(rewrite_image_paths(images)).into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpscaleBody {
    image_path: String,
}

async fn novelai_upscale(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<UpscaleBody>,
) -> Response {
    let token = match state.secrets.require_novelai_token() {
        Ok(token) => token,
        Err(error) => return api_error(StatusCode::UNAUTHORIZED, error),
    };
    let filename = body
        .image_path
        .strip_prefix("/api/images/")
        .unwrap_or(&body.image_path);
    let resolved = match novelai::resolve_cached_image_filename(&state.image_cache, filename) {
        Ok(path) => path,
        Err(error) => return bad_request(error),
    };
    match novelai::upscale(&token, resolved.to_string_lossy().into_owned(), &state.image_cache).await
    {
        Ok(images) => Json(rewrite_image_paths(images)).into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

async fn serve_cached_image(
    State(state): State<Arc<ServerState>>,
    AxumPath(filename): AxumPath<String>,
) -> Response {
    let path = match novelai::resolve_cached_image_filename(&state.image_cache, &filename) {
        Ok(path) => path,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    match fs::read(&path) {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "private, max-age=3600"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetTranslationKeyBody {
    provider: String,
    api_key: String,
}

async fn set_translation_key(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<SetTranslationKeyBody>,
) -> Response {
    let provider = match TranslationProvider::parse(&body.provider) {
        Ok(p) => p,
        Err(error) => return bad_request(error),
    };
    match state.secrets.set_translation_key(&provider, &body.api_key) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => bad_request(error),
    }
}

async fn clear_translation_key(
    State(state): State<Arc<ServerState>>,
    AxumPath(provider): AxumPath<String>,
) -> Response {
    let provider = match TranslationProvider::parse(&provider) {
        Ok(p) => p,
        Err(error) => return bad_request(error),
    };
    match state.secrets.clear_translation_key(&provider) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn translation_key_status(State(state): State<Arc<ServerState>>) -> Response {
    match state.secrets.translation_key_status() {
        Ok(status) => Json(status).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

#[derive(Deserialize)]
struct TestTranslationBody {
    config: TranslationConfig,
}

async fn test_translation(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<TestTranslationBody>,
) -> Response {
    let api_key = match state.secrets.translation_key(&body.config.provider) {
        Ok(key) => key,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    match translation::test_with_key(&body.config, api_key.as_deref()).await {
        Ok(message) => Json(json!({ "message": message })).into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

#[derive(Deserialize)]
struct TranslateBody {
    config: TranslationConfig,
    text: String,
}

async fn translate_selection(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<TranslateBody>,
) -> Response {
    let api_key = match state.secrets.translation_key(&body.config.provider) {
        Ok(key) => key,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    match translation::translate_with_key(&body.config, api_key.as_deref(), &body.text).await {
        Ok(text) => Json(json!({ "text": text })).into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

#[derive(Deserialize)]
struct TagSearchQuery {
    q: String,
    categories: Option<String>,
    limit: Option<usize>,
}

async fn search_tags(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<TagSearchQuery>,
) -> Response {
    let categories: Option<Vec<String>> = query.categories.map(|raw| {
        raw.split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    });
    let limit = query.limit.unwrap_or(36).clamp(1, 96);
    match tagdb::search(&state.tag_db, &query.q, categories.as_deref(), limit) {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

#[derive(Deserialize)]
struct FavoriteTagsBody {
    keys: Vec<String>,
    categories: Option<Vec<String>>,
}

async fn favorite_tags(
    State(state): State<Arc<ServerState>>,
    Json(body): Json<FavoriteTagsBody>,
) -> Response {
    match tagdb::favorites(&state.tag_db, &body.keys, body.categories.as_deref()) {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn get_character_catalog() -> Response {
    match character_catalog::catalog_rows() {
        Ok(rows) => (
            StatusCode::OK,
            [(header::CACHE_CONTROL, "public, max-age=86400")],
            Json(rows),
        )
            .into_response(),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

#[derive(Deserialize)]
struct CharacterThumbnailQuery {
    raw: String,
}

async fn get_character_thumbnail(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<CharacterThumbnailQuery>,
) -> Response {
    match character_catalog::character_thumbnail_bytes(&state.data_dir, &query.raw).await {
        Ok(Some(bytes)) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "image/webp"),
                (header::CACHE_CONTROL, "public, max-age=604800"),
            ],
            bytes,
        )
            .into_response(),
        Ok(None) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, error),
    }
}

struct ServerConfig {
    host: String,
    port: u16,
    data_dir: PathBuf,
    dist_dir: PathBuf,
    resources_dir: PathBuf,
}

fn parse_config() -> Result<ServerConfig, String> {
    let mut host = env::var("NAI_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let mut port: u16 = env::var("NAI_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3080);
    let mut data_dir = env::var("NAI_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("nai-web-data"));
    let mut dist_dir = env::var("NAI_DIST_DIR").ok().map(PathBuf::from);
    let mut resources_dir = env::var("NAI_RESOURCES_DIR").ok().map(PathBuf::from);

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => host = args.next().ok_or("--host requires a value")?,
            "--port" => {
                port = args
                    .next()
                    .ok_or("--port requires a value")?
                    .parse()
                    .map_err(|_| "Invalid --port number")?;
            }
            "--data-dir" => data_dir = PathBuf::from(args.next().ok_or("--data-dir requires a value")?),
            "--dist-dir" => dist_dir = Some(PathBuf::from(args.next().ok_or("--dist-dir requires a value")?)),
            "--resources-dir" => {
                resources_dir = Some(PathBuf::from(args.next().ok_or("--resources-dir requires a value")?));
            }
            "--help" | "-h" => {
                println!("NAI V5 Studio Web Server");
                println!("Options:");
                println!("  --host <addr>           Bind address (default: 0.0.0.0, env: NAI_HOST)");
                println!("  --port <port>           Bind port (default: 3080, env: NAI_PORT)");
                println!("  --data-dir <path>       Persistent data dir (default: ./nai-web-data, env: NAI_DATA_DIR)");
                println!("  --dist-dir <path>       Built frontend dir (default: ./dist, env: NAI_DIST_DIR)");
                println!("  --resources-dir <path>  Danbooru resources dir (env: NAI_RESOURCES_DIR)");
                std::process::exit(0);
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }

    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));

    let dist_dir = dist_dir.unwrap_or_else(|| {
        let cwd_dist = PathBuf::from("dist");
        if cwd_dist.is_dir() {
            return cwd_dist;
        }
        if let Some(dir) = &exe_dir {
            let adjacent = dir.join("dist");
            if adjacent.is_dir() {
                return adjacent;
            }
        }
        cwd_dist
    });

    let resources_dir = resources_dir.unwrap_or_else(|| {
        let candidates = [
            PathBuf::from("src-tauri/resources"),
            PathBuf::from("resources"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"),
        ];
        for candidate in candidates {
            if candidate.join("danbooru.sqlite.gz").is_file() {
                return candidate;
            }
        }
        if let Some(dir) = &exe_dir {
            let adjacent = dir.join("resources");
            if adjacent.join("danbooru.sqlite.gz").is_file() {
                return adjacent;
            }
        }
        PathBuf::from("src-tauri/resources")
    });

    Ok(ServerConfig {
        host,
        port,
        data_dir,
        dist_dir,
        resources_dir,
    })
}

fn build_router(state: Arc<ServerState>, dist_dir: &Path) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/state", get(get_state).put(put_state))
        .route("/novelai/token", post(set_novelai_token).delete(clear_novelai_token))
        .route("/novelai/token/status", get(novelai_token_status))
        .route("/novelai/token/export", get(export_novelai_token))
        .route("/novelai/test", post(test_novelai_connection))
        .route("/novelai/quota", get(novelai_quota))
        .route("/novelai/generate", post(novelai_generate))
        .route("/novelai/upscale", post(novelai_upscale))
        .route("/references", post(upload_reference))
        .route("/references/{id}", get(serve_reference))
        .route("/images/{filename}", get(serve_cached_image))
        .route("/translation/key", post(set_translation_key))
        .route("/translation/key/{provider}", delete(clear_translation_key))
        .route("/translation/keys", get(translation_key_status))
        .route("/translation/test", post(test_translation))
        .route("/translation/translate", post(translate_selection))
        .route("/tags/search", get(search_tags))
        .route("/tags/favorites", post(favorite_tags))
        .route("/character-catalog", get(get_character_catalog))
        .route("/character-thumbnail", get(get_character_thumbnail))
        .layer(DefaultBodyLimit::max(MAX_API_BODY_BYTES))
        .with_state(state);

    let index_file = dist_dir.join("index.html");
    let static_service = ServeDir::new(dist_dir).fallback(ServeFile::new(index_file));

    Router::new()
        .nest("/api", api)
        .fallback_service(static_service)
}

#[tokio::main]
async fn main() {
    let config = match parse_config() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("Configuration error: {error}");
            std::process::exit(1);
        }
    };

    if let Err(error) = fs::create_dir_all(&config.data_dir) {
        eprintln!("Could not create data dir {}: {error}", config.data_dir.display());
        std::process::exit(1);
    }

    let tag_db_gz = config.resources_dir.join("danbooru.sqlite.gz");
    let tag_db = match tagdb::prepare_in(&config.data_dir, &tag_db_gz) {
        Ok(db) => db,
        Err(error) => {
            eprintln!("Failed to prepare Danbooru tag database: {error}");
            std::process::exit(1);
        }
    };

    let image_cache = match novelai::prepare_image_cache_in(config.data_dir.join("image-cache")) {
        Ok(cache) => cache,
        Err(error) => {
            eprintln!("Failed to prepare image cache: {error}");
            std::process::exit(1);
        }
    };

    let secrets = match SecretsStore::open(config.data_dir.join("secrets.json")) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("Failed to open secrets store: {error}");
            std::process::exit(1);
        }
    };

    let sync_state = match SyncStateStore::open(config.data_dir.join("state.json")) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("Failed to open state store: {error}");
            std::process::exit(1);
        }
    };

    let reference_cache_dir = config.data_dir.join("reference-cache");
    if reference_cache_dir.exists() {
        let _ = fs::remove_dir_all(&reference_cache_dir);
    }
    if let Err(error) = fs::create_dir_all(&reference_cache_dir) {
        eprintln!(
            "Failed to prepare reference cache dir {}: {error}",
            reference_cache_dir.display()
        );
        std::process::exit(1);
    }

    let state = Arc::new(ServerState {
        data_dir: config.data_dir.clone(),
        secrets,
        sync_state,
        tag_db,
        image_cache,
        reference_cache_dir,
    });

    let app = build_router(state, &config.dist_dir);
    let addr: SocketAddr = match format!("{}:{}", config.host, config.port).parse() {
        Ok(addr) => addr,
        Err(error) => {
            eprintln!("Invalid bind address {}:{}: {error}", config.host, config.port);
            std::process::exit(1);
        }
    };

    println!("NAI V5 Studio Web Server listening on http://{addr}");
    println!("  data dir:      {}", config.data_dir.display());
    println!("  dist dir:      {}", config.dist_dir.display());
    println!("  resources dir: {}", config.resources_dir.display());

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Failed to bind {addr}: {error}");
            std::process::exit(1);
        }
    };

    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("Server error: {error}");
        std::process::exit(1);
    }
}
