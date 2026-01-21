mod maa_commands;
mod maa_ffi;

use maa_commands::MaaState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind, TimezoneStrategy};

/// 获取 exe 所在目录下的 debug/logs 子目录
fn get_logs_dir() -> PathBuf {
    let exe_path = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or(std::path::Path::new("."));
    exe_dir.join("debug")
}

/// 递归清理目录内容，逐个删除文件和空目录，返回 (成功数, 失败数)
fn cleanup_dir_contents(dir: &std::path::Path) -> (usize, usize) {
    let mut deleted = 0;
    let mut failed = 0;

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // 递归清理子目录
                let (d, f) = cleanup_dir_contents(&path);
                deleted += d;
                failed += f;
                // 尝试删除空目录
                if std::fs::remove_dir(&path).is_ok() {
                    deleted += 1;
                }
            } else {
                // 删除文件
                match std::fs::remove_file(&path) {
                    Ok(()) => deleted += 1,
                    Err(_) => failed += 1,
                }
            }
        }
    }

    // 尝试删除根目录本身
    let _ = std::fs::remove_dir(dir);

    (deleted, failed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 日志目录：exe 目录/debug/logs（与前端日志同目录）
    let logs_dir = get_logs_dir();

    // 确保日志目录存在
    let _ = std::fs::create_dir_all(&logs_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    // 输出到控制台
                    Target::new(TargetKind::Stdout),
                    // 输出到 exe/debug/logs 目录（与前端日志同目录，文件名用 mxu-tauri 区分）
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

            // 启动时异步清理 cache/old 目录（更新残留的旧文件），不阻塞应用启动
            if let Ok(exe_dir) = maa_commands::get_exe_dir() {
                let old_dir = std::path::Path::new(&exe_dir).join("cache").join("old");
                if old_dir.exists() {
                    std::thread::spawn(move || {
                        let (deleted, failed) = cleanup_dir_contents(&old_dir);
                        if deleted > 0 || failed > 0 {
                            if failed == 0 {
                                log::info!("Cleaned up cache/old: {} items deleted", deleted);
                            } else {
                                log::warn!("Cleaned up cache/old: {} deleted, {} failed", deleted, failed);
                            }
                        }
                    });
                }
            }

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
            maa_commands::maa_check_version,
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
            // 更新安装命令
            maa_commands::extract_zip,
            maa_commands::check_changes_json,
            maa_commands::apply_incremental_update,
            maa_commands::apply_full_update,
            maa_commands::cleanup_extract_dir,
            // 下载命令
            maa_commands::download_file,
            maa_commands::cancel_download,
            // 权限检查命令
            maa_commands::is_elevated,
            maa_commands::restart_as_admin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
