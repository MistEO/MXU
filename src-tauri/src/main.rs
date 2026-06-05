// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod webview2;

#[cfg(target_os = "windows")]
fn exe_dir() -> Option<std::path::PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.to_path_buf()))
}

#[cfg(target_os = "windows")]
fn bootstrap_log(message: &str) {
    use std::io::Write;

    let Some(exe_dir) = exe_dir() else {
        return;
    };
    let debug_dir = exe_dir.join("debug");
    let _ = std::fs::create_dir_all(&debug_dir);
    let log_path = debug_dir.join("bootstrap.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(file, "{}", message);
    }
}

#[cfg(target_os = "windows")]
fn webview_boot_marker_path() -> Option<std::path::PathBuf> {
    exe_dir().map(|dir| dir.join("cache").join("webview_boot_pending"))
}

#[cfg(target_os = "windows")]
fn mark_webview_boot_pending() {
    let Some(marker) = webview_boot_marker_path() else {
        return;
    };
    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(marker, b"pending");
}

#[cfg(target_os = "windows")]
fn repair_webview_data_after_previous_failure() {
    let Some(marker) = webview_boot_marker_path() else {
        return;
    };
    if !marker.exists() {
        return;
    }

    bootstrap_log("previous WebView boot did not reach Tauri setup; rotating webview_data");
    let _ = std::fs::remove_file(&marker);

    let Some(exe_dir) = exe_dir() else {
        return;
    };
    let webview_data_dir = exe_dir.join("cache").join("webview_data");
    if !webview_data_dir.exists() {
        return;
    }

    let backup_name = format!(
        "webview_data.bak-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );
    let backup_dir = exe_dir.join("cache").join(backup_name);
    match std::fs::rename(&webview_data_dir, &backup_dir) {
        Ok(()) => bootstrap_log("rotated webview_data successfully"),
        Err(e) => bootstrap_log(&format!("failed to rotate webview_data: {}", e)),
    }
}

#[cfg(target_os = "windows")]
fn is_fixed_webview2_runtime_usable(runtime_dir: &std::path::Path) -> bool {
    runtime_dir.is_dir()
        && runtime_dir.join("msedgewebview2.exe").is_file()
        && runtime_dir.join("EBWebView").is_dir()
}

fn main() {
    #[cfg(target_os = "windows")]
    bootstrap_log("mxu bootstrap start");

    if mxu_lib::commands::system::has_help_flag() {
        #[cfg(target_os = "windows")]
        bootstrap_log("help flag detected; exiting");
        mxu_lib::commands::system::print_cli_help_text();
        std::process::exit(0);
    }

    #[cfg(target_os = "windows")]
    {
        repair_webview_data_after_previous_failure();

        // 设置 WebView2 数据目录为程序所在目录下的 webview_data 文件夹
        // 这样可以避免用户名包含特殊字符（如中文）导致 WebView2 无法创建数据目录的问题
        if let Some(exe_dir) = exe_dir() {
            let webview_data_dir = exe_dir.join("cache").join("webview_data");
            // 确保目录存在
            match std::fs::create_dir_all(&webview_data_dir) {
                Ok(()) => bootstrap_log("webview_data directory ready"),
                Err(e) => bootstrap_log(&format!("failed to create webview_data: {}", e)),
            }
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data_dir);

            // 检测已缓存的 WebView2 固定版本运行时
            // 验证目录包含关键文件以确保运行时完整可用，否则回退到系统 WebView2/重新下载
            if let Ok(webview2_runtime_dir) = webview2::get_webview2_runtime_dir() {
                if is_fixed_webview2_runtime_usable(&webview2_runtime_dir) {
                    std::env::set_var(
                        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
                        &webview2_runtime_dir,
                    );
                    bootstrap_log("using fixed WebView2 runtime");
                } else if webview2_runtime_dir.exists() {
                    bootstrap_log(
                        "fixed WebView2 runtime is incomplete; falling back to system/runtime install",
                    );
                }
            }
        }

        // 已有本地运行时时跳过检测，否则检测系统安装或自动下载
        if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_none()
            && !webview2::ensure_webview2()
        {
            bootstrap_log("WebView2 is unavailable; exiting before Tauri run");
            std::process::exit(1);
        }

        // 启动时自动请求管理员权限：如果当前不是管理员，则自提权重启并退出当前进程
        // 说明：用户在 UAC 对话框中取消时，ShellExecuteEx 会返回 Err，此时继续以普通权限启动。
        // 调试模式下不请求管理员权限，方便开发调试
        if !cfg!(debug_assertions) && !mxu_lib::commands::system::is_elevated() {
            let exe_path = match std::env::current_exe() {
                Ok(p) => p,
                Err(_) => {
                    // 获取路径失败就按普通权限继续
                    bootstrap_log("failed to get current exe before elevation; entering run");
                    mark_webview_boot_pending();
                    mxu_lib::run();
                    return;
                }
            };

            use winsafe::co::{SEE_MASK, SW};
            use winsafe::{ShellExecuteEx, SHELLEXECUTEINFO};

            let result = ShellExecuteEx(&SHELLEXECUTEINFO {
                file: &exe_path.to_string_lossy(),
                verb: Option::from("runas"),
                show: SW::SHOWNORMAL,
                mask: SEE_MASK::NOASYNC | SEE_MASK::FLAG_NO_UI,
                ..Default::default()
            });

            if result.is_ok() {
                // 新的管理员进程已启动，退出当前普通权限进程
                bootstrap_log("elevated process started; exiting non-elevated bootstrap");
                std::process::exit(0);
            }
            bootstrap_log("elevation failed or was cancelled; continuing normally");
        }
    }

    #[cfg(target_os = "windows")]
    {
        bootstrap_log("entering mxu_lib::run");
        mark_webview_boot_pending();
    }

    mxu_lib::run()
}
