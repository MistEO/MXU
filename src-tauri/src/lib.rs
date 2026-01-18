mod maa_ffi;
mod maa_commands;

use maa_commands::MaaState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(MaaState::default())
        .invoke_handler(tauri::generate_handler![
            maa_commands::maa_init,
            maa_commands::maa_set_resource_dir,
            maa_commands::maa_get_version,
            maa_commands::maa_find_adb_devices,
            maa_commands::maa_find_win32_windows,
            maa_commands::maa_create_instance,
            maa_commands::maa_destroy_instance,
            maa_commands::maa_connect_controller,
            maa_commands::maa_get_connection_status,
            maa_commands::maa_load_resource,
            maa_commands::maa_is_resource_loaded,
            maa_commands::maa_run_task,
            maa_commands::maa_wait_task,
            maa_commands::maa_get_task_status,
            maa_commands::maa_stop_task,
            maa_commands::maa_is_running,
            maa_commands::maa_post_screencap,
            maa_commands::maa_screencap_wait,
            maa_commands::maa_get_cached_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
