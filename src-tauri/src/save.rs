//! One-tap image save into a fixed, gallery-visible folder.
//!
//! Desktop: `<Pictures>/NAI V5 Studio`. Android: the shared
//! `Pictures/NAI V5 Studio` folder, which the system gallery indexes.

use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};

pub const SAVE_FOLDER_NAME: &str = "NAI V5 Studio";
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_NAME_ATTEMPTS: u32 = 1000;

/// Formats Save accepts; detected from the bytes, never trusted from the name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Webp,
}

impl ImageFormat {
    pub fn detect(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(PNG_SIGNATURE) {
            Some(Self::Png)
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(Self::Webp)
        } else {
            None
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
}

#[cfg(not(target_os = "android"))]
pub fn save_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let pictures = app
        .path()
        .picture_dir()
        .map_err(|error| format!("Could not resolve the Pictures folder: {error}"))?;
    Ok(pictures.join(SAVE_FOLDER_NAME))
}

#[cfg(target_os = "android")]
pub fn save_directory(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Tauri's picture_dir() is app-private on Android; the gallery only sees
    // the shared Pictures directory.
    let pictures = android_public_pictures_dir()
        .unwrap_or_else(|_| PathBuf::from("/storage/emulated/0/Pictures"));
    Ok(pictures.join(SAVE_FOLDER_NAME))
}

#[cfg(target_os = "android")]
fn android_public_pictures_dir() -> Result<PathBuf, String> {
    use jni::objects::{JString, JValue};

    let context = ndk_context::android_context();
    let vm =
        unsafe { jni::JavaVM::from_raw(context.vm().cast()) }.map_err(|error| error.to_string())?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| error.to_string())?;
    let directory = env
        .get_static_field(
            "android/os/Environment",
            "DIRECTORY_PICTURES",
            "Ljava/lang/String;",
        )
        .and_then(|value| value.l())
        .map_err(|error| error.to_string())?;
    let file = env
        .call_static_method(
            "android/os/Environment",
            "getExternalStoragePublicDirectory",
            "(Ljava/lang/String;)Ljava/io/File;",
            &[JValue::Object(&directory)],
        )
        .and_then(|value| value.l())
        .map_err(|error| error.to_string())?;
    let path = env
        .call_method(&file, "getAbsolutePath", "()Ljava/lang/String;", &[])
        .and_then(|value| value.l())
        .map_err(|error| error.to_string())?;
    let path: String = env
        .get_string(&JString::from(path))
        .map_err(|error| error.to_string())?
        .into();
    Ok(PathBuf::from(path))
}

pub fn decode_image_base64(value: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.decode(value).map_err(|_| "저장할 이미지 전송 데이터가 올바르지 않습니다.".to_string())
}

/// Keeps only a safe base name and forces the extension of `format`.
pub fn sanitize_filename(name: &str, format: ImageFormat) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let stem =
        strip_image_extension(&cleaned).trim_matches(|c: char| c == '.' || c.is_whitespace());
    let stem: String = stem.chars().take(150).collect();
    let extension = format.extension();
    if stem.is_empty() {
        format!("NovelAI.{extension}")
    } else {
        format!("{stem}.{extension}")
    }
}

fn strip_image_extension(name: &str) -> &str {
    for extension in [".png", ".webp"] {
        let split = name.len().saturating_sub(extension.len());
        if name.is_char_boundary(split) && name[split..].eq_ignore_ascii_case(extension) {
            return &name[..split];
        }
    }
    name
}

fn candidate_name(filename: &str, attempt: u32) -> String {
    if attempt == 0 {
        return filename.to_string();
    }
    match filename.rsplit_once('.') {
        Some((stem, extension)) => format!("{stem}_{}.{extension}", attempt + 1),
        None => format!("{filename}_{}", attempt + 1),
    }
}

/// Writes PNG or WebP `bytes` unchanged as a new file whose extension matches
/// the detected format; an existing name gets a numeric suffix (`name_2.webp`,
/// `name_3.webp`, ...). Never overwrites.
pub fn write_image(directory: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let Some(format) = ImageFormat::detect(bytes) else {
        return Err("저장할 데이터가 PNG 또는 WebP 이미지가 아닙니다.".to_string());
    };
    fs::create_dir_all(directory).map_err(|error| {
        format!(
            "저장 폴더를 만들지 못했습니다 ({}): {error}",
            directory.display()
        )
    })?;
    let filename = sanitize_filename(filename, format);
    for attempt in 0..MAX_NAME_ATTEMPTS {
        let path = directory.join(candidate_name(&filename, attempt));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(format!(
                        "이미지를 저장하지 못했습니다 ({}): {error}",
                        path.display()
                    ));
                }
                return Ok(path);
            }
            // Android can report files owned by another install as
            // permission-denied instead of already-existing.
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) if error.kind() == ErrorKind::PermissionDenied && path.exists() => continue,
            Err(error) => {
                return Err(format!(
                    "이미지를 저장하지 못했습니다 ({}): {error}",
                    path.display()
                ))
            }
        }
    }
    Err("같은 이름의 파일이 너무 많아 저장하지 못했습니다.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(extra: &[u8]) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(extra);
        bytes
    }

    #[test]
    fn saves_bytes_unchanged_and_suffixes_duplicates() {
        let directory = std::env::temp_dir()
            .join(format!("nai-save-test-{}", uuid::Uuid::new_v4()))
            .join(SAVE_FOLDER_NAME);
        let first = write_image(&directory, "NovelAI_1_seed5.png", &png(b"one")).unwrap();
        let second = write_image(&directory, "NovelAI_1_seed5.png", &png(b"two")).unwrap();
        let third = write_image(&directory, "NovelAI_1_seed5.png", &png(b"three")).unwrap();
        assert_eq!(first.file_name().unwrap(), "NovelAI_1_seed5.png");
        assert_eq!(second.file_name().unwrap(), "NovelAI_1_seed5_2.png");
        assert_eq!(third.file_name().unwrap(), "NovelAI_1_seed5_3.png");
        assert_eq!(fs::read(&first).unwrap(), png(b"one"));
        assert_eq!(fs::read(&third).unwrap(), png(b"three"));
        fs::remove_dir_all(directory.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_unknown_bytes() {
        let directory =
            std::env::temp_dir().join(format!("nai-save-test-{}", uuid::Uuid::new_v4()));
        assert!(write_image(&directory, "x.png", b"not a png").is_err());
        assert!(write_image(&directory, "x.webp", b"RIFF\0\0\0\0WAVE").is_err());
        assert!(!directory.exists());
    }

    fn webp(extra: &[u8]) -> Vec<u8> {
        let mut bytes = b"RIFF\0\0\0\0WEBP".to_vec();
        bytes.extend_from_slice(extra);
        bytes
    }

    #[test]
    fn saves_webp_with_matching_extension_and_suffixes() {
        let directory = std::env::temp_dir()
            .join(format!("nai-save-test-{}", uuid::Uuid::new_v4()))
            .join(SAVE_FOLDER_NAME);
        let first = write_image(&directory, "NovelAI_1_seed5_finish.webp", &webp(b"a")).unwrap();
        let second = write_image(&directory, "NovelAI_1_seed5_finish.webp", &webp(b"b")).unwrap();
        // The extension follows the bytes, not the requested name.
        let renamed = write_image(&directory, "NovelAI_2.png", &webp(b"c")).unwrap();
        let png_named_webp = write_image(&directory, "NovelAI_3.webp", &png(b"d")).unwrap();
        assert_eq!(first.file_name().unwrap(), "NovelAI_1_seed5_finish.webp");
        assert_eq!(second.file_name().unwrap(), "NovelAI_1_seed5_finish_2.webp");
        assert_eq!(renamed.file_name().unwrap(), "NovelAI_2.webp");
        assert_eq!(png_named_webp.file_name().unwrap(), "NovelAI_3.png");
        assert_eq!(fs::read(&second).unwrap(), webp(b"b"));
        fs::remove_dir_all(directory.parent().unwrap()).unwrap();
    }

    #[test]
    fn detects_formats_from_bytes() {
        assert_eq!(ImageFormat::detect(&png(b"")), Some(ImageFormat::Png));
        assert_eq!(ImageFormat::detect(&webp(b"")), Some(ImageFormat::Webp));
        assert_eq!(ImageFormat::detect(b"RIFF"), None);
        assert_eq!(ImageFormat::detect(b"GIF89a"), None);
    }

    #[test]
    fn keeps_file_names_inside_the_save_folder() {
        let png = ImageFormat::Png;
        let webp = ImageFormat::Webp;
        assert_eq!(sanitize_filename("../../etc/passwd", png), "passwd.png");
        assert_eq!(sanitize_filename("C:\\x\\a:b?.png", png), "a_b_.png");
        assert_eq!(sanitize_filename(" .. ", png), "NovelAI.png");
        assert_eq!(sanitize_filename(" .. ", webp), "NovelAI.webp");
        assert_eq!(
            sanitize_filename("NovelAI_x_grain.png", png),
            "NovelAI_x_grain.png"
        );
        assert_eq!(sanitize_filename("NovelAI_x.WEBP", webp), "NovelAI_x.webp");
        assert_eq!(sanitize_filename("NovelAI_x.png", webp), "NovelAI_x.webp");
        assert_eq!(
            sanitize_filename("../a/b.webp.exe", webp),
            "b.webp.exe.webp"
        );
    }

    #[test]
    fn saves_android_json_payloads_without_changing_image_bytes() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let directory = std::env::temp_dir().join(format!("nai-save-ipc-{}", uuid::Uuid::new_v4()));
        for bytes in [png(b"\0\xffmetadata"), webp(b"\0\xffXMP ")] {
            let payload = serde_json::json!({ "imageBase64": STANDARD.encode(&bytes), "filename": "한글_finish.png" });
            let decoded = decode_image_base64(payload["imageBase64"].as_str().unwrap()).unwrap();
            let path = write_image(&directory, payload["filename"].as_str().unwrap(), &decoded).unwrap();
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert_eq!(path.extension().unwrap(), ImageFormat::detect(&bytes).unwrap().extension());
        }
        assert!(decode_image_base64("data:image/png;base64,AAAA").is_err());
        assert!(decode_image_base64("not base64!").is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
