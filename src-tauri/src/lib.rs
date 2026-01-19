mod maa_commands;
mod maa_ffi;

use maa_commands::MaaState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind, TimezoneStrategy};

/// 获取 exe 所在目录下的 logs 子目录
fn get_logs_dir() -> PathBuf {
    let exe_path = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or(std::path::Path::new("."));
    exe_dir.join("logs")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 日志目录：exe 目录/logs（与前端日志同目录）
    let logs_dir = get_logs_dir();

    // 确保日志目录存在
    let _ = std::fs::create_dir_all(&logs_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    // 输出到控制台
                    Target::new(TargetKind::Stdout),
                    // 输出到 exe/logs 目录（与前端日志同目录，文件名用 mxu-tauri 区分）
                    Target::new(TargetKind::Folder {
                        path: logs_dir,
                        file_name: Some("mxu-tauri".into()),
                    }),
                ])
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .level(log::LevelFilter::Debug)
                .build(),
        )
        .setup(|app| {
            // 创建 MaaState 并注册为 Tauri 管理状态
            let maa_state = Arc::new(MaaState::default());
            app.manage(maa_state);
            
            // 存储 AppHandle 供 MaaFramework 回调使用（发送事件到前端）
            maa_ffi::set_app_handle(app.handle().clone());

            // 启动时自动加载 MaaFramework DLL
            if let Ok(maafw_dir) = maa_commands::get_maafw_dir() {
                if maafw_dir.exists() {
                    match maa_ffi::init_maa_library(&maafw_dir) {
                        Ok(()) => log::info!("MaaFramework loaded from {:?}", maafw_dir),
                        Err(e) => log::error!("Failed to load MaaFramework: {}", e),
                    }
                } else {
                    log::warn!("MaaFramework directory not found: {:?}", maafw_dir);
                }
            }

            Ok(())
        })
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
            maa_commands::maa_destroy_resource,
            maa_commands::maa_run_task,
            maa_commands::maa_get_task_status,
            maa_commands::maa_stop_task,
            maa_commands::maa_override_pipeline,
            maa_commands::maa_is_running,
            maa_commands::maa_post_screencap,
            maa_commands::maa_get_cached_image,
            maa_commands::maa_start_tasks,
            maa_commands::maa_stop_agent,
            maa_commands::read_local_file,
            maa_commands::read_local_file_base64,
            maa_commands::local_file_exists,
            maa_commands::get_exe_dir,
            // 状态查询命令
            maa_commands::maa_get_instance_state,
            maa_commands::maa_get_all_states,
            maa_commands::maa_get_cached_adb_devices,
            maa_commands::maa_get_cached_win32_windows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
