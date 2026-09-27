//! Offline character catalog. Original catalog and thumbnail attribution: Jio7/Prombot.
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, io::Read, sync::OnceLock};
use tauri::Manager;

const CATALOG: &[u8] = include_bytes!("../resources/prombot-characters.csv.gz");
const EXTRA: &str = include_str!("../resources/characters-extra.json");
static ROWS: OnceLock<Result<Vec<CatalogCharacter>, String>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCharacter {
    pub raw: String,
    pub display: String,
    pub series: String,
    pub features: Vec<String>,
    pub attire: Vec<String>,
    pub is_new: bool,
    pub posts: u64,
}
#[derive(Deserialize)]
struct Row {
    character: String,
    series: String,
    #[serde(default)]
    features: String,
    #[serde(default)]
    attire: String,
    #[serde(default)]
    posts: u64,
}
#[derive(Deserialize)]
struct Extra {
    characters: Vec<Row>,
}

fn parse(csv_data: &str, extra: &str) -> Result<Vec<CatalogCharacter>, String> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    let csv_rows = csv::Reader::from_reader(csv_data.as_bytes())
        .deserialize::<Row>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let extra_rows: Extra = serde_json::from_str(extra).map_err(|e| e.to_string())?;
    for (rows, is_new) in [(csv_rows, false), (extra_rows.characters, true)] {
        for row in rows {
            let raw = row.character.trim().to_string();
            if raw.is_empty() || !seen.insert(raw.clone()) {
                continue;
            }
            output.push(CatalogCharacter {
                display: raw.replace('_', " "),
                raw,
                series: row.series.trim().to_string(),
                features: row
                    .features
                    .split_whitespace()
                    .map(|s| s.replace('_', " "))
                    .collect(),
                attire: row
                    .attire
                    .split_whitespace()
                    .map(|s| s.replace('_', " "))
                    .collect(),
                is_new,
                posts: row.posts,
            });
        }
    }
    Ok(output)
}
fn catalog() -> Result<&'static Vec<CatalogCharacter>, String> {
    ROWS.get_or_init(|| {
        let mut csv = String::new();
        flate2::read::GzDecoder::new(CATALOG)
            .read_to_string(&mut csv)
            .map_err(|e| e.to_string())?;
        parse(&csv, EXTRA)
    })
    .as_ref()
    .map_err(Clone::clone)
}
#[tauri::command]
pub fn character_catalog() -> Result<Vec<CatalogCharacter>, String> {
    catalog().cloned()
}

fn thumbnail_url(raw: &str) -> Result<tauri::Url, String> {
    let name = raw.replace(':', "_");
    let first = name.chars().next().ok_or("Empty character")?.to_string();
    let mut url =
        tauri::Url::parse("https://huggingface.co/Jio7/Prombot/resolve/main/character-images/")
            .map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Invalid image base")?
        .pop_if_empty()
        .push(&first)
        .push(&format!("{name}.webp"));
    Ok(url)
}
fn valid_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

/// The catalog is the allowlist; callers cannot supply a URL or filesystem path.
/// Null means no image exists. Errors are transient and may be retried.
#[tauri::command]
pub async fn character_thumbnail(
    app: tauri::AppHandle,
    raw: String,
) -> Result<Option<String>, String> {
    let rows = catalog()?;
    let index = rows
        .iter()
        .position(|row| row.raw == raw)
        .ok_or("Unknown character")?;
    if rows[index].is_new {
        return Ok(None);
    }
    // Snapshot-specific indices keep filenames short, portable and traversal-free.
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("character-thumbnails-v1");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{index}.webp"));
    let missing = dir.join(format!("{index}.missing"));
    let data_url = |bytes: &[u8]| {
        format!(
            "data:image/webp;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    };
    if let Ok(bytes) = std::fs::read(&path) {
        if valid_webp(&bytes) {
            return Ok(Some(data_url(&bytes)));
        }
    }
    if missing.exists() {
        return Ok(None);
    }
    let mut response = reqwest::Client::new()
        .get(thumbnail_url(&raw)?)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        std::fs::write(missing, b"").map_err(|e| e.to_string())?;
        return Ok(None);
    }
    response.error_for_status_ref().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("Thumbnail too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !valid_webp(&bytes) {
        return Err("Invalid WebP thumbnail".into());
    }
    let temporary = dir.join(format!("{index}-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
    Ok(Some(data_url(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_counts_and_extra() {
        let rows = catalog().unwrap();
        assert_eq!(rows.len(), 19316);
        assert_eq!(rows.iter().filter(|r| r.is_new).count(), 123);
        assert!(rows
            .iter()
            .filter(|r| r.is_new)
            .all(|r| r.features.is_empty() && r.attire.is_empty()));
    }
    #[test]
    fn quoted_csv_and_extra_are_lossless() {
        let rows = parse("character,series,features,attire\n\"tharja_(\"\"normal_girl\"\")\",fire_emblem,long_hair blue_eyes,\"bow\nred_dress\"\n", r#"{"characters":[{"character":"new","series":"","posts":7}]}"#).unwrap();
        assert_eq!(rows[0].raw, "tharja_(\"normal_girl\")");
        assert_eq!(rows[0].features, ["long hair", "blue eyes"]);
        assert_eq!(rows[0].attire, ["bow", "red dress"]);
        assert!(rows[1].is_new);
        assert_eq!(rows[1].posts, 7);
        assert_eq!(rows[1].series, "");
    }
    #[test]
    fn thumbnail_names_and_escaping() {
        for (raw, suffix) in [
            ("2b_(nier:automata)", "2/2b_(nier_automata).webp"),
            ("37_(reverse:1999)", "3/37_(reverse_1999).webp"),
            ("a/b?#", "a/a%2Fb%3F%23.webp"),
            ("a_(\"x\")", "a/a_(%22x%22).webp"),
        ] {
            assert!(thumbnail_url(raw).unwrap().as_str().ends_with(suffix));
        }
        assert!(!valid_webp(b"<html>not an image</html>"));
    }
}
