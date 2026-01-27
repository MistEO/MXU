// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod webview2;

/// 检查目录是否可写（通过尝试创建并写入临时文件）
#[cfg(target_os = "windows")]
fn is_dir_writable(dir: &std::path::Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let test_file = dir.join(".write_test");
    match std::fs::write(&test_file, b"test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_file);
            true
        }
        Err(_) => false,
    }
}

/// 获取 WebView2 数据目录
/// 按优先级尝试多个位置，确保找到一个可写的目录
#[cfg(target_os = "windows")]
fn get_webview_data_dir() -> Option<std::path::PathBuf> {
    // 1. 首先尝试程序所在目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let webview_data_dir = exe_dir.join("webview_data");
            if is_dir_writable(&webview_data_dir) {
                return Some(webview_data_dir);
            }
        }
    }

    // 2. 尝试 ProgramData 目录（通常所有用户都有写入权限）
    if let Some(program_data) = std::env::var_os("ProgramData") {
        let fallback_dir = std::path::PathBuf::from(program_data)
            .join("MXU")
            .join("webview_data");
        if is_dir_writable(&fallback_dir) {
            return Some(fallback_dir);
        }
    }

    // 3. 尝试 AppData/Local 目录
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let fallback_dir = std::path::PathBuf::from(local_app_data)
            .join("MXU")
            .join("webview_data");
        if is_dir_writable(&fallback_dir) {
            return Some(fallback_dir);
        }
    }

    // 4. 最后尝试临时目录
    let temp_dir = std::env::temp_dir().join("MXU").join("webview_data");
    if is_dir_writable(&temp_dir) {
        return Some(temp_dir);
    }

    None
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        // 设置 WebView2 数据目录（必须在 WebView2 初始化之前）
        if let Some(webview_data_dir) = get_webview_data_dir() {
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data_dir);
        }

        if !webview2::ensure_webview2() {
            std::process::exit(1);
        }
    }

    mxu_lib::run()
}
