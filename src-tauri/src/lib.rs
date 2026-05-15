// The Tauri 2 entrypoint. Kept minimal: no custom commands, no plugins.
// Add `.invoke_handler(tauri::generate_handler![...])` here when we need
// to expose Rust-side functionality to the renderer.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
