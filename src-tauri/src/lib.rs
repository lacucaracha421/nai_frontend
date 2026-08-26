mod commands;
mod novelai;
mod tagdb;
mod translation;

use novelai::NovelAiState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(NovelAiState::default())
        .setup(|app| {
            let tag_db = tagdb::prepare(app).map_err(std::io::Error::other)?;
            let image_cache = novelai::prepare_image_cache(app).map_err(std::io::Error::other)?;
            app.manage(tag_db);
            app.manage(image_cache);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_novelai_token,
            commands::restore_novelai_token,
            commands::export_novelai_token,
            commands::clear_novelai_token,
            commands::test_novelai_connection,
            commands::novelai_quota,
            commands::novelai_generate,
            commands::novelai_upscale,
            commands::set_translation_api_key,
            commands::clear_translation_api_key,
            commands::translation_key_status,
            commands::test_translation_provider,
            commands::translate_selection,
            commands::search_local_tags,
            commands::favorite_local_tags
        ])
        .run(tauri::generate_context!())
        .expect("error while running NAI V5 Studio");
}

/// Initialize Android's ndk-context for the native credential store.
///
/// Tauri 2.11 no longer initializes ndk-context for application crates.
/// MainActivity calls this JNI method from onCreate before the frontend can
/// request token restoration.
#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_local_nai_v5studio_MainActivity_initNdkContext(
    env: jni::JNIEnv,
    _this: jni::objects::JObject,
    context: jni::objects::JObject,
) {
    use jni::objects::GlobalRef;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    // Keep the Android Context alive for as long as the Rust process lives.
    static CONTEXT_REF: OnceLock<Option<GlobalRef>> = OnceLock::new();

    CONTEXT_REF.get_or_init(|| match env.new_global_ref(&context) {
        Ok(global_ref) => {
            let vm = match env.get_java_vm() {
                Ok(vm) => vm,
                Err(error) => {
                    eprintln!("Could not obtain Android JavaVM for credential store: {error}");
                    return None;
                }
            };

            let vm_ptr = vm.get_java_vm_pointer() as *mut c_void;
            unsafe {
                ndk_context::initialize_android_context(
                    vm_ptr,
                    global_ref.as_obj().as_raw() as _,
                );
            }
            Some(global_ref)
        }
        Err(error) => {
            eprintln!("Could not retain Android application context: {error}");
            None
        }
    });
}
