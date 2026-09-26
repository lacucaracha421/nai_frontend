use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const PROMBOT_URL: &str = "https://prombot.net/";
const PROMBOT_CHARACTERS_URLS: [&str; 2] = [
    "https://prombot.net/characters.csv.gz",
    "https://huggingface.co/Jio7/Prombot/resolve/main/characters.csv.gz",
];
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

/// Prombot's "Other series" bucket: characters with no series or with a
/// series that has only one character (mirrors prombot.net grouping).
const PROMBOT_MISC_GROUP: &str = "";
/// A Prombot series ☆ writes every member of that series into
/// `prombot:charFavorites`. Groups at least this large whose members are
/// (almost) all bookmarked are treated as series-level favorites.
const SERIES_FAVORITE_MIN_MEMBERS: usize = 5;
const SERIES_FAVORITE_MIN_COVERAGE_PERCENT: usize = 80;
/// A series ☆ appends the members that were not bookmarked yet in one go, in
/// Prombot's list order. A run this long of consecutive group members in that
/// order is a series ☆ even when coverage is now lower (members added to the
/// series later, or some unstarred afterwards).
const SERIES_FAVORITE_MIN_RUN: usize = 20;
/// How many of the largest kept groups the import reports for diagnosis.
const LARGEST_GROUPS_REPORTED: usize = 3;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesFavorite {
    /// Raw Prombot series key; empty for the "Other series" bucket.
    pub series: String,
    pub members: usize,
    pub favorited: usize,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteCatalog {
    /// False when Prombot's character list could not be loaded; nothing is
    /// filtered in that case.
    pub available: bool,
    /// Why the character list could not be loaded (when `available` is false).
    pub error: Option<String>,
    /// Distinct raw bookmarks read from Prombot.
    pub total: usize,
    /// Individually bookmarked characters, in Prombot order.
    pub characters: Vec<String>,
    /// Series for each kept character.
    pub series: HashMap<String, String>,
    /// Bookmarks that are not in Prombot's character list.
    pub unknown: Vec<String>,
    /// Series-level ☆ expansions that were excluded.
    pub series_favorites: Vec<SeriesFavorite>,
    /// The kept groups with the most bookmarks (diagnosis of a missed series ☆).
    pub largest_groups: Vec<SeriesFavorite>,
}

/// prombot.net splits `characters.csv` on commas without unquoting, so a
/// quoted CSV name is stored in `charFavorites` with its CSV quoting.
fn prombot_raw_name(name: &str) -> String {
    if name.contains(['"', ',', '\n']) {
        format!("\"{}\"", name.replace('"', "\"\""))
    } else {
        name.to_string()
    }
}

fn distinct(wanted: &[String]) -> Vec<&str> {
    let mut seen = HashSet::new();
    wanted
        .iter()
        .map(String::as_str)
        .filter(|name| seen.insert(*name))
        .collect()
}

fn classify_favorites(csv: &str, wanted: &[String]) -> FavoriteCatalog {
    #[derive(serde::Deserialize)]
    struct Row {
        character: String,
        series: String,
    }
    let mut rows = Vec::new();
    let mut names = HashSet::new();
    let mut reader = csv::Reader::from_reader(csv.as_bytes());
    for row in reader.deserialize::<Row>().flatten() {
        let character = row.character.trim().to_string();
        if !character.is_empty() && names.insert(character.clone()) {
            rows.push((character, row.series.trim().to_string()));
        }
    }

    let mut series_sizes = HashMap::<&str, usize>::new();
    for (_, series) in &rows {
        if !series.is_empty() {
            *series_sizes.entry(series.as_str()).or_default() += 1;
        }
    }
    // name (and Prombot's quoted spelling) -> (series, group, position in group)
    let mut by_name = HashMap::<String, (&str, &str, usize)>::new();
    let mut group_sizes = HashMap::<&str, usize>::new();
    for (character, series) in &rows {
        let group = if series_sizes.get(series.as_str()).copied().unwrap_or(0) >= 2 {
            series.as_str()
        } else {
            PROMBOT_MISC_GROUP
        };
        let size = group_sizes.entry(group).or_default();
        let position = *size;
        *size += 1;
        by_name.insert(character.clone(), (series.as_str(), group, position));
        by_name.insert(
            prombot_raw_name(character),
            (series.as_str(), group, position),
        );
    }

    let wanted = distinct(wanted);
    let mut favorited = HashMap::<&str, usize>::new();
    for name in &wanted {
        if let Some((_, group, _)) = by_name.get(*name) {
            *favorited.entry(group).or_default() += 1;
        }
    }

    // Longest run of consecutive bookmarks that are consecutive members of one
    // group (skipping members bookmarked before the run), as a series ☆ writes.
    let mut longest_run = HashMap::<&str, usize>::new();
    let mut earlier = HashSet::<(&str, usize)>::new();
    let mut earlier_upto = 0;
    let mut run: Option<(&str, usize, usize)> = None; // group, last position, length
    for (index, name) in wanted.iter().enumerate() {
        let Some(&(_, group, position)) = by_name.get(*name) else {
            run = None;
            continue;
        };
        let continues = run.is_some_and(|(run_group, last, _)| {
            run_group == group && {
                let mut next = last + 1;
                while earlier.contains(&(group, next)) {
                    next += 1;
                }
                next == position
            }
        });
        let length = match run {
            Some((_, _, length)) if continues => length + 1,
            _ => {
                // Members bookmarked before this run were skipped by Prombot's Set.
                for previous in &wanted[earlier_upto..index] {
                    if let Some(&(_, g, p)) = by_name.get(*previous) {
                        earlier.insert((g, p));
                    }
                }
                earlier_upto = index;
                1
            }
        };
        run = Some((group, position, length));
        let best = longest_run.entry(group).or_default();
        *best = (*best).max(length);
    }

    let mut series_favorites = Vec::new();
    let mut largest_groups = Vec::new();
    for (group, count) in &favorited {
        let members = group_sizes.get(group).copied().unwrap_or(0);
        let summary = SeriesFavorite {
            series: (*group).to_string(),
            members,
            favorited: *count,
        };
        let covered = members >= SERIES_FAVORITE_MIN_MEMBERS
            && count * 100 >= members * SERIES_FAVORITE_MIN_COVERAGE_PERCENT;
        let run = longest_run.get(group).copied().unwrap_or(0) >= SERIES_FAVORITE_MIN_RUN;
        if covered || run {
            series_favorites.push(summary);
        } else {
            largest_groups.push(summary);
        }
    }
    let by_count = |a: &SeriesFavorite, b: &SeriesFavorite| {
        b.favorited.cmp(&a.favorited).then(a.series.cmp(&b.series))
    };
    series_favorites.sort_by(by_count);
    largest_groups.sort_by(by_count);
    largest_groups.truncate(LARGEST_GROUPS_REPORTED);
    let excluded_groups = series_favorites
        .iter()
        .map(|favorite| favorite.series.clone())
        .collect::<HashSet<_>>();

    let mut catalog = FavoriteCatalog {
        available: true,
        total: wanted.len(),
        ..FavoriteCatalog::default()
    };
    for name in &wanted {
        match by_name.get(*name) {
            None => catalog.unknown.push((*name).to_string()),
            Some((_, group, _)) if excluded_groups.contains(*group) => {}
            Some((series, _, _)) => {
                if !series.is_empty() {
                    catalog
                        .series
                        .insert((*name).to_string(), (*series).to_string());
                }
                catalog.characters.push((*name).to_string());
            }
        }
    }
    catalog.series_favorites = series_favorites;
    catalog.largest_groups = largest_groups;
    catalog
}

async fn download_characters_csv_from(url: &str) -> Result<String, String> {
    let response = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url}: HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{url}: {error}"))?;
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return String::from_utf8(bytes.to_vec()).map_err(|error| format!("{url}: {error}"));
    }
    let mut decoder = flate2::read::GzDecoder::new(bytes.as_ref());
    let mut csv = String::new();
    decoder
        .read_to_string(&mut csv)
        .map_err(|error| format!("{url}: could not unpack: {error}"))?;
    Ok(csv)
}

/// Prombot's own copy first (the list its series ☆ used), then the mirror.
async fn download_characters_csv() -> Result<String, String> {
    let mut errors = Vec::new();
    for url in PROMBOT_CHARACTERS_URLS {
        match download_characters_csv_from(url).await {
            Ok(csv) => return Ok(csv),
            Err(error) => errors.push(error),
        }
    }
    Err(errors.join(" / "))
}

/// Splits raw Prombot bookmarks into individual character favorites,
/// series-level ☆ expansions and names missing from Prombot's list.
pub async fn favorite_catalog(wanted: Vec<String>) -> Result<FavoriteCatalog, String> {
    if wanted.is_empty() {
        return Ok(FavoriteCatalog {
            available: true,
            ..FavoriteCatalog::default()
        });
    }
    match download_characters_csv().await {
        Ok(csv) => Ok(classify_favorites(&csv, &wanted)),
        // Offline: keep every bookmark rather than dropping the user's list.
        Err(error) => {
            let characters = distinct(&wanted)
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>();
            Ok(FavoriteCatalog {
                available: false,
                error: Some(error),
                total: characters.len(),
                characters,
                ..FavoriteCatalog::default()
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_favorites, favorites_from_url, handle_navigation, prombot_raw_name, PrombotState,
        SeriesFavorite,
    };

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
        let result = classify_favorites(csv, &wanted).series;
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
        let result = classify_favorites(csv, &wanted).series;
        assert_eq!(result.len(), 1);
        assert_eq!(
            result.get("hakurei_reimu").map(String::as_str),
            Some("touhou")
        );
    }

    fn catalog_csv() -> String {
        let mut csv = String::from("character,series,features,attire\n");
        for index in 0..333 {
            csv.push_str(&format!("touhou_{index},touhou,,\n"));
        }
        for index in 0..10 {
            csv.push_str(&format!("fate_{index},fate_(series),,\n"));
        }
        for name in ["miku", "rin", "len"] {
            csv.push_str(&format!("{name},vocaloid,,\n"));
        }
        for index in 0..40 {
            // Singleton series and series-less rows form Prombot's "Other series".
            csv.push_str(&format!("solo_{index},solo_series_{index},,\n"));
        }
        csv.push_str("nameless,,,\n");
        csv.push_str("\"tharja_(\"\"normal_girl\"\")_(fire_emblem)\",fire_emblem,,\n");
        csv.push_str("robin_(fire_emblem),fire_emblem,,\n");
        csv
    }

    #[test]
    fn a_series_star_does_not_inflate_the_character_bookmark_count() {
        // Reproduces NAI-005: ~46 individual bookmarks plus one series ☆ that
        // Prombot expanded to all 333 members showed up as 379 characters.
        let mut wanted = Vec::new();
        wanted.extend((0..7).map(|index| format!("fate_{index}")));
        wanted.extend(["miku", "rin", "len"].map(String::from));
        wanted.extend((0..333).map(|index| format!("touhou_{index}")));
        // Hand picks, not in Prombot's list order (an ordered run would read as a ☆).
        wanted.extend((0..30).rev().map(|index| format!("solo_{index}")));
        wanted.push("nameless".into());
        wanted.push("robin_(fire_emblem)".into());
        wanted.push(prombot_raw_name("tharja_(\"normal_girl\")_(fire_emblem)"));
        wanted.push("renamed_character".into());
        wanted.push("removed_character".into());
        wanted.push("miku".into());
        assert_eq!(wanted.len(), 379);

        let catalog = classify_favorites(&catalog_csv(), &wanted);
        assert!(catalog.available);
        assert_eq!(catalog.characters.len(), 43);
        assert_eq!(&catalog.characters[..3], ["fate_0", "fate_1", "fate_2"]);
        assert!(!catalog.characters.iter().any(|name| name.starts_with("touhou_")));
        assert_eq!(
            catalog.series_favorites,
            vec![SeriesFavorite {
                series: "touhou".into(),
                members: 333,
                favorited: 333
            }]
        );
        assert_eq!(catalog.unknown, vec!["renamed_character", "removed_character"]);
        assert_eq!(catalog.series.get("miku").map(String::as_str), Some("vocaloid"));
        assert_eq!(catalog.series.get("solo_3").map(String::as_str), Some("solo_series_3"));
        assert!(!catalog.series.contains_key("nameless"));
    }

    #[test]
    fn detects_a_series_star_even_after_a_few_members_were_unstarred() {
        let mut wanted = (0..300).map(|index| format!("touhou_{index}")).collect::<Vec<_>>();
        wanted.push("miku".into());
        let catalog = classify_favorites(&catalog_csv(), &wanted);
        assert_eq!(catalog.characters, vec!["miku"]);
        assert_eq!(catalog.series_favorites[0].favorited, 300);
    }

    #[test]
    fn the_other_series_star_is_a_series_favorite_too() {
        let mut wanted = (0..40).map(|index| format!("solo_{index}")).collect::<Vec<_>>();
        wanted.push("nameless".into());
        wanted.push("fate_1".into());
        let catalog = classify_favorites(&catalog_csv(), &wanted);
        assert_eq!(catalog.characters, vec!["fate_1"]);
        assert_eq!(catalog.series_favorites[0].series, "");
        assert_eq!(catalog.series_favorites[0].members, 41);
    }

    #[test]
    fn keeps_whole_small_series_and_partial_large_series_picked_by_hand() {
        let wanted = ["miku", "rin", "len", "fate_0", "fate_5", "fate_9", "robin_(fire_emblem)"]
            .map(String::from)
            .to_vec();
        let catalog = classify_favorites(&catalog_csv(), &wanted);
        assert_eq!(catalog.characters, wanted);
        assert!(catalog.series_favorites.is_empty());
        assert!(catalog.unknown.is_empty());
    }

    #[test]
    fn detects_a_series_star_by_its_run_when_coverage_is_low() {
        // The series grew (or members were unstarred) after the ☆, so only 45 %
        // is bookmarked, but Prombot appended the members in one ordered run.
        // touhou_5 was picked by hand first, so the ☆ skipped it.
        let mut wanted = vec!["touhou_5".to_string(), "miku".into()];
        wanted.extend(
            (0..150)
                .filter(|index| *index != 5)
                .map(|index| format!("touhou_{index}")),
        );
        wanted.push("fate_2".into());
        let catalog = classify_favorites(&catalog_csv(), &wanted);
        assert_eq!(catalog.characters, vec!["miku", "fate_2"]);
        assert_eq!(catalog.series_favorites[0].series, "touhou");
        assert_eq!(catalog.series_favorites[0].favorited, 150);
        assert_eq!(catalog.total, 152);
    }

    #[test]
    fn keeps_many_hand_picks_from_one_series_and_reports_them() {
        // Picked by hand in no particular order: no long ordered run.
        let mut wanted = (0..30)
            .map(|index| format!("touhou_{}", (index * 7) % 30))
            .collect::<Vec<_>>();
        wanted.push("miku".into());
        let catalog = classify_favorites(&catalog_csv(), &wanted);
        assert_eq!(catalog.characters.len(), 31);
        assert!(catalog.series_favorites.is_empty());
        assert_eq!(
            catalog.largest_groups[0],
            SeriesFavorite {
                series: "touhou".into(),
                members: 333,
                favorited: 30
            }
        );
    }

    #[test]
    fn matches_prombot_quoted_names() {
        let quoted = prombot_raw_name("tharja_(\"normal_girl\")_(fire_emblem)");
        assert_eq!(quoted, "\"tharja_(\"\"normal_girl\"\")_(fire_emblem)\"");
        let catalog = classify_favorites(&catalog_csv(), &[quoted.clone()]);
        assert_eq!(catalog.characters, vec![quoted.clone()]);
        assert_eq!(catalog.series.get(&quoted).map(String::as_str), Some("fire_emblem"));
    }
}
