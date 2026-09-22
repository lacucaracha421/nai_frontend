use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const PROMBOT_URL: &str = "https://prombot.net/";
const PROMBOT_CHARACTERS_URL: &str =
    "https://huggingface.co/Jio7/Prombot/resolve/main/characters.csv.gz";
const FAVORITES_SCHEME: &str = "nai-prombot";
const FAVORITES_HOST: &str = "favorites";

const PROMBOT_BRIDGE_SCRIPT: &str = r#"
(() => {
  if (window.top !== window || location.origin !== 'https://prombot.net') return;
  const token = '__NAI_PROMBOT_BRIDGE_TOKEN__';
  let last = null;
  const publish = () => {
    try {
      const raw = localStorage.getItem('prombot:charFavorites') || '[]';
      if (raw === last) return;
      last = raw;
      location.href = 'nai-prombot://favorites?token=' + token + '&payload=' + encodeURIComponent(raw);
    } catch (_) {}
  };
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && key === 'prombot:charFavorites') publish();
  };
  const originalRemoveItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function(key) {
    originalRemoveItem.call(this, key);
    if (this === localStorage && key === 'prombot:charFavorites') publish();
  };
  const originalClear = Storage.prototype.clear;
  Storage.prototype.clear = function() {
    originalClear.call(this);
    if (this === localStorage) publish();
  };
  addEventListener('pageshow', publish);
  addEventListener('visibilitychange', publish);
  setInterval(publish, 1000);
  setTimeout(publish, 100);
})();
"#;

#[derive(Default)]
pub struct PrombotState {
    favorites: Mutex<Option<Vec<String>>>,
}

impl PrombotState {
    fn replace(&self, values: Vec<String>) {
        if let Ok(mut favorites) = self.favorites.lock() {
            *favorites = Some(values);
        }
    }

    pub fn snapshot(&self) -> Result<Vec<String>, String> {
        self.favorites
            .lock()
            .map_err(|_| "Prombot bookmark state is unavailable.".to_string())?
            .clone()
            .ok_or_else(|| "Prombot을 열고 북마크가 로드된 뒤 다시 가져오시와요.".to_string())
    }
}

fn favorites_from_url(url: &tauri::Url) -> Option<Vec<String>> {
    if url.scheme() != FAVORITES_SCHEME
        || url.host_str() != Some(FAVORITES_HOST)
        || !matches!(url.path(), "" | "/")
        || url.as_str().len() > 4 * 1024 * 1024
    {
        return None;
    }
    let payload = url
        .query_pairs()
        .find_map(|(key, value)| (key == "payload").then(|| value.into_owned()))?;
    let parsed = serde_json::from_str::<Vec<String>>(&payload).ok()?;
    let mut seen = HashSet::new();
    Some(
        parsed
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty() && value.len() <= 256 && seen.insert(value.clone()))
            .take(5000)
            .collect(),
    )
}

fn handle_navigation(state: &PrombotState, url: &tauri::Url, token: &str) -> bool {
    if url.scheme() == FAVORITES_SCHEME {
        // Only the script installed in the top-level Prombot document receives
        // this window's token; third-party subframes cannot forge a snapshot.
        if url
            .query_pairs()
            .any(|(key, value)| key == "token" && value == token)
        {
            if let Some(favorites) = favorites_from_url(url) {
                state.replace(favorites);
            }
        }
        return false;
    }
    // Keep this WebView on the one remote origin. In particular, never let it
    // navigate to a local Tauri URL and gain the local custom-command context.
    url.origin().ascii_serialization() == "https://prombot.net"
}

pub fn open(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("prombot") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    *app.state::<PrombotState>()
        .favorites
        .lock()
        .map_err(|_| "Prombot bookmark state is unavailable.".to_string())? = None;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main webview is unavailable.".to_string())?;
    let url = PROMBOT_URL
        .parse()
        .map_err(|error| format!("Invalid Prombot URL: {error}"))?;
    let bridge_app = app.clone();
    let token = uuid::Uuid::new_v4().to_string();
    let bridge_script = PROMBOT_BRIDGE_SCRIPT.replace("__NAI_PROMBOT_BRIDGE_TOKEN__", &token);
    let builder = WebviewWindowBuilder::new(&main, "prombot", WebviewUrl::External(url))
        .title("Prombot")
        .initialization_script(bridge_script)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_navigation(move |url| {
            handle_navigation(&bridge_app.state::<PrombotState>(), url, &token)
        });

    #[cfg(target_os = "android")]
    let builder = builder.activity_name("PrombotActivity");

    builder
        .build()
        .map(|_| ())
        .map_err(|error| format!("Could not open Prombot WebView: {error}"))
}

pub fn favorites(state: State<'_, PrombotState>) -> Result<Vec<String>, String> {
    state.snapshot()
}

fn series_for_favorites(csv: &str, wanted: &[String]) -> HashMap<String, String> {
    let wanted = wanted.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut result = HashMap::new();
    #[derive(serde::Deserialize)]
    struct Row {
        character: String,
        series: String,
    }
    let mut reader = csv::Reader::from_reader(csv.as_bytes());
    for row in reader.deserialize::<Row>().flatten() {
        let character = row.character.trim();
        let series = row.series.trim();
        if wanted.contains(character) && !series.is_empty() {
            result.insert(character.to_string(), series.to_string());
        }
    }
    result
}

pub async fn favorite_series(wanted: Vec<String>) -> Result<HashMap<String, String>, String> {
    if wanted.is_empty() {
        return Ok(HashMap::new());
    }
    let response = reqwest::Client::new()
        .get(PROMBOT_CHARACTERS_URL)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("Could not download Prombot character data: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Prombot character data returned HTTP {}.",
            response.status()
        ));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    let mut decoder = flate2::read::GzDecoder::new(bytes.as_ref());
    let mut csv = String::new();
    decoder
        .read_to_string(&mut csv)
        .map_err(|error| format!("Could not unpack Prombot character data: {error}"))?;
    Ok(series_for_favorites(&csv, &wanted))
}

#[cfg(test)]
mod tests {
    use super::{favorites_from_url, handle_navigation, series_for_favorites, PrombotState};

    #[test]
    fn navigation_stays_on_prombot_and_invalid_signals_do_not_clear_favorites() {
        let state = PrombotState::default();
        state.replace(vec!["miku".into()]);
        for url in [
            "https://evil.test/",
            "https://prombot.net.evil.test/",
            "http://prombot.net/",
            "https://prombot.net:444/",
            "tauri://localhost/",
            "https://tauri.localhost/",
            "nai-prombot://favorites?payload=null",
            "nai-prombot://favorites?payload=[]&token=forged",
        ] {
            assert!(!handle_navigation(
                &state,
                &tauri::Url::parse(url).unwrap(),
                "trusted-token"
            ));
        }
        assert_eq!(state.snapshot().unwrap(), vec!["miku"]);
        assert!(handle_navigation(
            &state,
            &tauri::Url::parse("https://prombot.net/characters").unwrap(),
            "trusted-token"
        ));
        assert!(!handle_navigation(
            &state,
            &tauri::Url::parse("nai-prombot://favorites?payload=[]&token=trusted-token").unwrap(),
            "trusted-token"
        ));
        assert!(state.snapshot().unwrap().is_empty());
    }

    #[test]
    fn distinguishes_unread_favorites_from_an_importable_empty_snapshot() {
        let state = PrombotState::default();
        assert!(state.snapshot().is_err());
        state.replace(vec![]);
        assert_eq!(state.snapshot().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn accepts_only_favorite_arrays_and_normalizes_duplicates() {
        let mut url = tauri::Url::parse("nai-prombot://favorites").unwrap();
        url.query_pairs_mut()
            .append_pair("payload", r#"[" miku ","miku","","reimu"]"#);
        assert_eq!(favorites_from_url(&url).unwrap(), vec!["miku", "reimu"]);
        for payload in [r#"{"token":"secret"}"#, r#"["miku",42]"#, "null"] {
            url.set_query(None);
            url.query_pairs_mut().append_pair("payload", payload);
            assert!(favorites_from_url(&url).is_none());
        }
        assert!(
            favorites_from_url(&tauri::Url::parse("https://prombot.net/?payload=[]").unwrap())
                .is_none()
        );
    }

    #[test]
    fn parses_quoted_csv_names_series_and_multiline_features() {
        let csv = concat!(
            "character,series,features,attire\r\n",
            "\"tharja_(\"\"normal_girl\"\")_(fire_emblem)\",fire_emblem,\"line one\nline two\",\r\n",
            "hime_(himesama_goumon),\"hime-sama_\"\"goumon\"\"_no_jikan_desu\",,\r\n",
            "other,,features,attire\r\n",
        );
        let wanted = vec![
            "tharja_(\"normal_girl\")_(fire_emblem)".into(),
            "hime_(himesama_goumon)".into(),
            "other".into(),
        ];
        let result = series_for_favorites(csv, &wanted);
        assert_eq!(result.len(), 2);
        assert_eq!(
            result.get(&wanted[0]).map(String::as_str),
            Some("fire_emblem")
        );
        assert_eq!(
            result.get(&wanted[1]).map(String::as_str),
            Some("hime-sama_\"goumon\"_no_jikan_desu")
        );
    }

    #[test]
    fn parses_series_only_for_requested_favorites() {
        let csv = "character,series,features,attire\nhatsune_miku,vocaloid,long_hair,\nhakurei_reimu,touhou,long_hair,bow\n";
        let wanted = vec!["hakurei_reimu".to_string()];
        let result = series_for_favorites(csv, &wanted);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result.get("hakurei_reimu").map(String::as_str),
            Some("touhou")
        );
    }
}
