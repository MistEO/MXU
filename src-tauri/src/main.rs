// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod webview2;

fn main() {
    #[cfg(target_os = "windows")]
    {
        // 设置 WebView2 数据目录为程序所在目录下的 webview_data 文件夹
        // 这样可以避免用户名包含特殊字符（如中文）导致 WebView2 无法创建数据目录的问题
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let webview_data_dir = exe_dir.join("webview_data");
                // 确保目录存在
                let _ = std::fs::create_dir_all(&webview_data_dir);
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data_dir);
            }
        }

        if !webview2::ensure_webview2() {
            std::process::exit(1);
        }
    }

    mxu_lib::run()
}
