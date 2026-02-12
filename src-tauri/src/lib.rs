pub mod commands;
mod maa_ffi;
mod mxu_actions;
mod tray;

use commands::MaaState;
use maa_ffi::MaaLibraryError;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{Target, TargetKind, TimezoneStrategy};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 日志目录：exe 目录/debug/logs（与前端日志同目录）
    let logs_dir = commands::utils::get_logs_dir();

    // 确保日志目录存在
    let _ = std::fs::create_dir_all(&logs_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart".into()]),
        ))
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
            if let Ok(data_dir) = commands::get_data_dir() {
                let old_dir = std::path::Path::new(&data_dir).join("cache").join("old");
                if old_dir.exists() {
                    std::thread::spawn(move || {
                        let (deleted, failed) = commands::cleanup_dir_contents(&old_dir);
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
            if let Ok(maafw_dir) = commands::get_maafw_dir() {
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

            // 初始化系统托盘
            if let Err(e) = tray::init_tray(app.handle()) {
                log::error!("Failed to initialize system tray: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Maa 核心命令
            commands::maa_core::maa_init,
            commands::maa_core::maa_set_resource_dir,
            commands::maa_core::maa_get_version,
            commands::maa_core::maa_check_version,
            commands::maa_core::maa_find_adb_devices,
            commands::maa_core::maa_find_win32_windows,
            commands::maa_core::maa_create_instance,
            commands::maa_core::maa_destroy_instance,
            commands::maa_core::maa_connect_controller,
            commands::maa_core::maa_get_connection_status,
            commands::maa_core::maa_load_resource,
            commands::maa_core::maa_is_resource_loaded,
            commands::maa_core::maa_destroy_resource,
            commands::maa_core::maa_run_task,
            commands::maa_core::maa_get_task_status,
            commands::maa_core::maa_stop_task,
            commands::maa_core::maa_override_pipeline,
            commands::maa_core::maa_is_running,
            commands::maa_core::maa_post_screencap,
            commands::maa_core::maa_get_cached_image,
            // Agent 命令
            commands::maa_agent::maa_start_tasks,
            commands::maa_agent::maa_stop_agent,
            // 文件操作命令
            commands::file_ops::read_local_file,
            commands::file_ops::read_local_file_base64,
            commands::file_ops::local_file_exists,
            commands::file_ops::get_exe_dir,
            commands::file_ops::get_data_dir,
            commands::file_ops::get_cwd,
            commands::file_ops::check_exe_path,
            commands::file_ops::set_executable,
            commands::file_ops::export_logs,
            // 状态查询命令
            commands::state::maa_get_instance_state,
            commands::state::maa_get_all_states,
            commands::state::maa_get_cached_adb_devices,
            commands::state::maa_get_cached_win32_windows,
            // 更新安装命令
            commands::update::extract_zip,
            commands::update::check_changes_json,
            commands::update::apply_incremental_update,
            commands::update::apply_full_update,
            commands::update::cleanup_extract_dir,
            commands::update::fallback_update,
            commands::update::move_file_to_old,
            // 下载命令
            commands::download::download_file,
            commands::download::cancel_download,
            // 系统相关命令
            commands::system::is_elevated,
            commands::system::is_autostart,
            commands::system::restart_as_admin,
            commands::system::maa_set_save_draw,
            commands::system::open_file,
            commands::system::run_and_wait,
            commands::system::run_action,
            commands::system::retry_load_maa_library,
            commands::system::check_vcredist_missing,
            commands::system::get_arch,
            commands::system::get_system_info,
            commands::system::create_log_overlay_window,
            commands::system::get_connected_window_handle,
            commands::system::get_window_rect_by_handle,
            commands::system::set_overlay_above_target,
            commands::system::set_overlay_always_on_top,
            commands::system::close_log_overlay,
            // 托盘相关命令
            commands::tray::set_minimize_to_tray,
            commands::tray::get_minimize_to_tray,
            commands::tray::update_tray_icon,
            commands::tray::update_tray_tooltip,
        ])
        .on_window_event(|window, event| {
            match event {
                // 窗口关闭请求：检查是否最小化到托盘
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // 悬浮窗关闭时：获取当前尺寸，通知前端同步状态
                    if window.label() == "log-overlay" {
                        let size = window.inner_size().ok();
                        let pos = window.outer_position().ok();
                        let payload = serde_json::json!({
                            "width": size.as_ref().map(|s| s.width).unwrap_or(360),
                            "height": size.as_ref().map(|s| s.height).unwrap_or(260),
                            "x": pos.as_ref().map(|p| p.x).unwrap_or(100),
                            "y": pos.as_ref().map(|p| p.y).unwrap_or(100),
                        });
                        let _ = window.app_handle().emit("log-overlay-closed", payload);
                    }
                    // 主窗口关闭/最小化到托盘时，同步关闭悬浮窗
                    if window.label() == "main" {
                        if let Some(overlay) = window.app_handle().get_webview_window("log-overlay") {
                            let _ = overlay.destroy();
                        }
                    }
                    if tray::handle_close_requested(window.app_handle()) {
                        api.prevent_close();
                    }
                }
                // 主窗口销毁时清理所有 agent 子进程和悬浮窗
                tauri::WindowEvent::Destroyed => {
                    if window.label() == "main" {
                        // 关闭悬浮窗
                        if let Some(overlay) = window.app_handle().get_webview_window("log-overlay") {
                            let _ = overlay.destroy();
                        }
                    }
                    if let Some(state) = window.try_state::<Arc<MaaState>>() {
                        state.cleanup_all_agent_children();
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
