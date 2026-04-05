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
                let webview_data_dir = exe_dir.join("cache").join("webview_data");
                // 确保目录存在
                let _ = std::fs::create_dir_all(&webview_data_dir);
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data_dir);

                // 检测已缓存的 WebView2 固定版本运行时
                // 验证目录包含关键文件以确保运行时完整可用
                if let Ok(webview2_runtime_dir) = webview2::get_webview2_runtime_dir() {
                    if webview2_runtime_dir.is_dir()
                        && webview2_runtime_dir.join("msedgewebview2.exe").exists()
                    {
                        std::env::set_var(
                            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
                            &webview2_runtime_dir,
                        );
                    }
                }
            }
        }

        // 已有本地运行时时跳过检测，否则检测系统安装或自动下载
        if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_none()
            && !webview2::ensure_webview2()
        {
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
                std::process::exit(0);
            }
        }
    }

    mxu_lib::run()
}
