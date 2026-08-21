mod commands;
mod danbooru;
mod novelai;
mod storage;

use novelai::NovelAiState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NovelAiState::default())
        .invoke_handler(tauri::generate_handler![
            commands::set_novelai_token,
            commands::clear_novelai_token,
            commands::test_novelai_connection,
            commands::novelai_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NAI Frontend");
}
