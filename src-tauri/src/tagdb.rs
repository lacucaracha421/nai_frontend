use flate2::read::GzDecoder;
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
use tauri::{path::BaseDirectory, Manager};

const BUNDLED_VERSION: &str = include_str!("../resources/danbooru.version");
#[cfg(target_os = "android")]
const ANDROID_DB_GZ: &[u8] = include_bytes!("../resources/danbooru.sqlite.gz");
const RESOURCE_DB_GZ: &str = "resources/danbooru.sqlite.gz";
const DB_FILENAME: &str = "danbooru.sqlite";
const VERSION_FILENAME: &str = "danbooru.version";

#[derive(Debug)]
pub struct TagDbState {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalTagResult {
    pub raw: String,
    pub display: String,
    pub category: String,
    pub count: i64,
}

#[derive(Debug, Clone)]
struct Candidate {
    id: i64,
    raw: String,
    category: i64,
    count: i64,
    score: i32,
}

fn display_tag(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.peek().copied() {
                if matches!(next, '(' | ')' | '{' | '}' | '[' | ']') {
                    out.push(next);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(if ch == '_' { ' ' } else { ch });
    }
    out
}

fn normalize(value: &str) -> String {
    display_tag(value)
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn category_name(value: i64) -> &'static str {
    match value {
        0 => "general",
        1 => "artist",
        3 => "copyright",
        4 => "character",
        5 => "meta",
        _ => "unknown",
    }
}

fn category_ids(categories: Option<&[String]>) -> Vec<i64> {
    let mut ids = Vec::new();
    for category in categories.unwrap_or(&[]) {
        let id = match category.as_str() {
            "general" => Some(0),
            "artist" => Some(1),
            "copyright" => Some(3),
            "character" => Some(4),
            "meta" => Some(5),
            _ => None,
        };
        if let Some(id) = id {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    if ids.is_empty() {
        vec![0, 1, 3, 4, 5]
    } else {
        ids
    }
}

fn category_sql(ids: &[i64]) -> String {
    ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")
}

fn fts_query(query: &str) -> Option<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in query.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.push(ch);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if tokens.is_empty() {
        None
    } else {
        Some(
            tokens
                .into_iter()
                .map(|token| format!("\"{}\"*", token.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" AND "),
        )
    }
}

fn score_raw(raw: &str, query: &str, from_fts: bool) -> i32 {
    let name = normalize(raw);
    if name == query {
        return 1000;
    }
    if name.starts_with(query) {
        return 900;
    }
    let tokens = name
        .split(|ch: char| ch.is_whitespace() || matches!(ch, '(' | ')' | '-' | ':'))
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens.iter().any(|token| *token == query) {
        return 850;
    }
    if tokens.iter().any(|token| token.starts_with(query)) {
        return 800;
    }
    if from_fts {
        return 740;
    }
    if name.contains(query) {
        return 500;
    }
    0
}

fn add_candidate(map: &mut HashMap<i64, Candidate>, row: (i64, String, i64, i64), query: &str, from_fts: bool) {
    let (id, raw, category, count) = row;
    let score = score_raw(&raw, query, from_fts);
    if score <= 0 {
        return;
    }
    match map.get_mut(&id) {
        Some(existing) => existing.score = existing.score.max(score),
        None => {
            map.insert(
                id,
                Candidate {
                    id,
                    raw,
                    category,
                    count,
                    score,
                },
            );
        }
    }
}

fn open_readonly(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Could not open local Danbooru database: {error}"))
}

fn validate_database(path: &Path) -> Result<(), String> {
    let connection = open_readonly(path)?;
    let count: i64 = connection
        .query_row("SELECT count(*) FROM tags", [], |row| row.get(0))
        .map_err(|error| format!("Local Danbooru database validation failed: {error}"))?;
    if count < 1000 {
        return Err(format!("Local Danbooru database is unexpectedly small ({count} tags)."));
    }
    Ok(())
}

fn unpack_gzip<R: io::Read>(reader: R, target: &Path) -> Result<(), String> {
    let mut decoder = GzDecoder::new(reader);
    let mut output = File::create(target).map_err(|error| format!("Could not create tag database: {error}"))?;
    io::copy(&mut decoder, &mut output).map_err(|error| format!("Could not unpack tag database: {error}"))?;
    output.sync_all().map_err(|error| format!("Could not flush tag database: {error}"))?;
    Ok(())
}

pub fn prepare(app: &tauri::App) -> Result<TagDbState, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_data).map_err(|error| format!("Could not create app data directory: {error}"))?;

    let target = app_data.join(DB_FILENAME);
    let version_target = app_data.join(VERSION_FILENAME);
    let bundled_version = BUNDLED_VERSION.trim();
    let installed_version = fs::read_to_string(&version_target).unwrap_or_default();

    if target.exists() && installed_version.trim() == bundled_version && validate_database(&target).is_ok() {
        return Ok(TagDbState { path: target });
    }

    let temp = app_data.join("danbooru.sqlite.tmp");
    let _ = fs::remove_file(&temp);

    #[cfg(target_os = "android")]
    {
        // Tauri resources live inside the APK as Android assets and are not normal
        // filesystem paths. Embedding the compressed database in the native library
        // avoids AssetManager / URI differences across Android WebView/Tauri versions.
        let source = io::Cursor::new(ANDROID_DB_GZ);
        unpack_gzip(source, &temp)?;
    }

    #[cfg(not(target_os = "android"))]
    {
        let resolved = app
            .path()
            .resolve(RESOURCE_DB_GZ, BaseDirectory::Resource)
            .map_err(|error| format!("Could not resolve bundled tag database: {error}"))?;

        if resolved.exists() {
            let source = File::open(&resolved)
                .map_err(|error| format!("Could not open bundled tag database: {error}"))?;
            unpack_gzip(source, &temp)?;
        } else {
            // `cargo run` bypasses Tauri CLI resource copying, so use the source tree in dev.
            let dev_source = Path::new(env!("CARGO_MANIFEST_DIR")).join(RESOURCE_DB_GZ);
            let source = File::open(&dev_source)
                .map_err(|error| format!("Could not open bundled tag database at {}: {error}", dev_source.display()))?;
            unpack_gzip(source, &temp)?;
        }
    }

    validate_database(&temp)?;
    if target.exists() {
        fs::remove_file(&target).map_err(|error| format!("Could not replace old tag database: {error}"))?;
    }
    fs::rename(&temp, &target).map_err(|error| format!("Could not install tag database: {error}"))?;
    fs::write(&version_target, format!("{bundled_version}\n"))
        .map_err(|error| format!("Could not save tag database version: {error}"))?;

    Ok(TagDbState { path: target })
}

pub fn search(state: &TagDbState, query: &str, categories: Option<&[String]>, limit: usize) -> Result<Vec<LocalTagResult>, String> {
    let query = normalize(query);
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let ids = category_ids(categories);
    let allowed = category_sql(&ids);
    let connection = open_readonly(&state.path)?;
    let mut candidates: HashMap<i64, Candidate> = HashMap::new();
    let candidate_limit = (limit.max(24) * 8).min(512) as i64;

    // Fast canonical-name prefix lookup. The source names are already lowercase Danbooru format.
    let upper = format!("{query}\u{10ffff}");
    let sql = format!(
        "SELECT id,raw,category,count FROM tags WHERE category IN ({allowed}) AND raw>=?1 AND raw<?2 LIMIT ?3"
    );
    let mut stmt = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![query, upper, candidate_limit], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        add_candidate(&mut candidates, row.map_err(|error| error.to_string())?, &query, false);
    }

    // FTS handles token-prefix and Japanese/Korean/local aliases without materializing the database in JS.
    if let Some(match_query) = fts_query(&query) {
        let sql = format!(
            "SELECT t.id,t.raw,t.category,t.count FROM tag_fts f JOIN tags t ON t.id=f.rowid \
             WHERE tag_fts MATCH ?1 AND t.category IN ({allowed}) LIMIT ?2"
        );
        let mut stmt = connection.prepare(&sql).map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![match_query, candidate_limit], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            add_candidate(&mut candidates, row.map_err(|error| error.to_string())?, &query, true);
        }
    }

    // Preserve the old substring behavior as a bounded fallback. This runs in native SQLite,
    // not over hundreds of thousands of JavaScript objects.
    if candidates.len() < limit && query.chars().count() >= 3 {
        let sql = format!(
            "SELECT id,raw,category,count FROM tags WHERE category IN ({allowed}) AND raw LIKE '%' || ?1 || '%' LIMIT ?2"
        );
        let mut stmt = connection.prepare(&sql).map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![query, candidate_limit], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            add_candidate(&mut candidates, row.map_err(|error| error.to_string())?, &query, false);
        }
    }

    let mut values = candidates.into_values().collect::<Vec<_>>();
    values.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.count.cmp(&a.count)).then_with(|| a.id.cmp(&b.id)));
    Ok(values
        .into_iter()
        .take(limit)
        .map(|candidate| LocalTagResult {
            raw: candidate.raw.clone(),
            display: display_tag(&candidate.raw),
            category: category_name(candidate.category).to_string(),
            count: candidate.count,
        })
        .collect())
}

pub fn favorites(state: &TagDbState, keys: &[String], categories: Option<&[String]>) -> Result<Vec<LocalTagResult>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let ids = category_ids(categories);
    let allowed = category_sql(&ids);
    let connection = open_readonly(&state.path)?;
    let sql = format!("SELECT raw,category,count FROM tags WHERE raw=?1 AND category IN ({allowed}) LIMIT 1");
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    for key in keys {
        let row = statement.query_row(params![key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        });
        if let Ok((raw, category, count)) = row {
            out.push(LocalTagResult {
                display: display_tag(&raw),
                raw,
                category: category_name(category).to_string(),
                count,
            });
        }
    }
    Ok(out)
}
