/// Use the same target platform as Tauri's native window configuration.
#[tauri::command]
pub fn window_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        _ => "other",
    }
}
