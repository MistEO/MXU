pub mod maa_commands;
mod maa_ffi;

use maa_commands::MaaState;
use maa_ffi::MaaLibraryError;
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

            // Windows 下移除系统标题栏（使用自定义标题栏）
            // macOS/Linux 保留完整的原生标题栏
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // 启动时异步清理 cache/old 目录（更新残留的旧文件），不阻塞应用启动
            if let Ok(exe_dir) = maa_commands::get_exe_dir() {
                let old_dir = std::path::Path::new(&exe_dir).join("cache").join("old");
                if old_dir.exists() {
                    std::thread::spawn(move || {
                        let (deleted, failed) = maa_commands::cleanup_dir_contents(&old_dir);
                        if deleted > 0 || failed > 0 {
                            if failed == 0 {
                                log::info!("Cleaned up cache/old: {} items deleted", deleted);
                            } else {
                                log::warn!(
                                    "Cleaned up cache/old: {} deleted, {} failed",
                                    deleted,
                                    failed
                                );
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
                        Err(e) => {
                            log::error!("Failed to load MaaFramework: {}", e);
                            // 检查是否是 DLL 存在但加载失败的情况（可能是运行库缺失）
                            if let MaaLibraryError::LoadFailed { dlls_exist: true, error, .. } = &e {
                                log::warn!(
                                    "DLLs exist but failed to load, possibly missing VC++ runtime: {}",
                                    error
                                );
                                // 设置标记，前端加载完成后会查询此标记
                                maa_ffi::set_vcredist_missing(true);
                            }
                        }
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
            maa_commands::get_cwd,
            maa_commands::check_exe_path,
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
            maa_commands::fallback_update,
            maa_commands::move_file_to_old,
            // 下载命令
            maa_commands::download_file,
            maa_commands::cancel_download,
            // 权限检查命令
            maa_commands::is_elevated,
            maa_commands::restart_as_admin,
            // 全局选项命令
            maa_commands::maa_set_save_draw,
            // 文件操作命令
            maa_commands::open_file,
            maa_commands::run_and_wait,
            maa_commands::retry_load_maa_library,
            maa_commands::check_vcredist_missing,
            maa_commands::get_arch,
            maa_commands::get_system_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
