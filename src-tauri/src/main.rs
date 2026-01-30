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

        // 启动时自动请求管理员权限：如果当前不是管理员，则自提权重启并退出当前进程
        // 说明：用户取消 UAC 时 ShellExecuteW 会失败，此时继续以普通权限启动。
        // 调试模式下不请求管理员权限，方便开发调试
        if !cfg!(debug_assertions) && !mxu_lib::commands::system::is_elevated() {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            use windows::core::PCWSTR;
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::Shell::ShellExecuteW;
            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

            let exe_path = match std::env::current_exe() {
                Ok(p) => p,
                Err(_) => {
                    // 获取路径失败就按普通权限继续
                    mxu_lib::run();
                    return;
                }
            };

            fn to_wide(s: &str) -> Vec<u16> {
                OsStr::new(s).encode_wide().chain(Some(0)).collect()
            }

            let operation = to_wide("runas");
            let file = to_wide(&exe_path.to_string_lossy());

            unsafe {
                let result = ShellExecuteW(
                    HWND::default(),
                    PCWSTR::from_raw(operation.as_ptr()),
                    PCWSTR::from_raw(file.as_ptr()),
                    PCWSTR::null(),
                    PCWSTR::null(),
                    SW_SHOWNORMAL,
                );

                if result.0 as usize > 32 {
                    // 新的管理员进程已启动，退出当前普通权限进程
                    std::process::exit(0);
                }
            }
        }
    }

    mxu_lib::run()
}
