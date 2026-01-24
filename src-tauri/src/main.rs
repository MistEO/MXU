// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod webview2_check {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONWARNING, MB_OK, MB_YESNO,
    };
    use windows::core::PCWSTR;

    /// 将 Rust 字符串转换为 Windows 宽字符串 (null-terminated)
    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    /// 检测 WebView2 是否已安装（注册表 + DLL 双重检测）
    pub fn is_webview2_installed() -> bool {
        // TODO: 测试完成后删除这行
        return false; // 强制返回 false 用于测试

        // 方法1: 检查注册表
        // WebView2 Runtime 在 64 位系统上的注册表路径
        let registry_paths = [
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ];

        let mut registry_found = false;
        for path in &registry_paths {
            let path_wide = to_wide(path);
            let mut hkey: HKEY = HKEY::default();
            let result = unsafe {
                RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    PCWSTR::from_raw(path_wide.as_ptr()),
                    0,
                    KEY_READ,
                    &mut hkey,
                )
            };
            if result.is_ok() {
                unsafe { let _ = RegCloseKey(hkey); }
                registry_found = true;
                break;
            }
        }

        if !registry_found {
            return false;
        }

        // 方法2: 尝试加载 WebView2Loader.dll 确认运行时可用
        // 检查系统目录中是否存在 WebView2Loader.dll
        if let Ok(system_dir) = std::env::var("SystemRoot") {
            let dll_paths = [
                PathBuf::from(&system_dir).join("System32").join("WebView2Loader.dll"),
                PathBuf::from(&system_dir).join("SysWOW64").join("WebView2Loader.dll"),
            ];
            for dll_path in &dll_paths {
                if dll_path.exists() {
                    return true;
                }
            }
        }

        // 如果注册表存在但 DLL 不在系统目录，仍然认为已安装
        // （WebView2 可能在用户目录或其他位置）
        registry_found
    }

    /// 显示询问对话框，询问用户是否自动下载安装 WebView2
    /// 返回 true 表示用户选择"是"
    pub fn show_install_prompt() -> bool {
        let title = to_wide("缺少 WebView2 运行时");
        let message = to_wide(concat!(
            "检测到您的系统未安装 Microsoft Edge WebView2 运行时，",
            "这是运行本程序所必需的组件。\n\n",
            "是否自动下载并安装？\n\n",
            "• 点击「是」：自动下载安装\n",
            "• 点击「否」：稍后手动安装"
        ));

        let result = unsafe {
            MessageBoxW(
                HWND::default(),
                PCWSTR::from_raw(message.as_ptr()),
                PCWSTR::from_raw(title.as_ptr()),
                MB_YESNO | MB_ICONWARNING,
            )
        };

        result == IDYES
    }

    /// 复制文本到剪贴板
    fn copy_to_clipboard(text: &str) -> bool {
        clipboard_win::set_clipboard_string(text).is_ok()
    }

    /// 显示手动安装引导对话框（带错误信息）
    pub fn show_manual_install_dialog_with_error(error: Option<&str>) {
        let download_url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
        
        // 先把链接复制到剪贴板
        let copied = copy_to_clipboard(download_url);
        
        let title = to_wide("请手动安装 WebView2");
        let clipboard_hint = if copied {
            "（下载链接已复制到剪贴板，可直接粘贴到浏览器）"
        } else {
            ""
        };
        
        let message_str = if let Some(err) = error {
            format!(
                "自动安装失败：\n{}\n\n\
                请在浏览器中访问以下链接下载安装：\n\
                {}\n\
                {}\n\n\
                安装完成后，请重新启动本程序。",
                err, download_url, clipboard_hint
            )
        } else {
            format!(
                "您选择了手动安装。\n\n\
                请在浏览器中访问以下链接下载安装：\n\
                {}\n\
                {}\n\n\
                安装完成后，请重新启动本程序。",
                download_url, clipboard_hint
            )
        };
        let message = to_wide(&message_str);

        unsafe {
            MessageBoxW(
                HWND::default(),
                PCWSTR::from_raw(message.as_ptr()),
                PCWSTR::from_raw(title.as_ptr()),
                MB_OK | MB_ICONERROR,
            );
        }
    }

    /// 显示安装成功提示
    fn show_success_dialog() {
        let title = to_wide("安装成功");
        let message = to_wide("WebView2 运行时安装成功！程序将继续启动。");

        unsafe {
            MessageBoxW(
                HWND::default(),
                PCWSTR::from_raw(message.as_ptr()),
                PCWSTR::from_raw(title.as_ptr()),
                MB_OK | MB_ICONWARNING,
            );
        }
    }

    /// 显示下载中提示
    fn show_downloading_dialog() {
        let title = to_wide("正在下载");
        let message = to_wide(concat!(
            "即将开始下载 WebView2 运行时。\n\n",
            "下载过程可能需要 1-2 分钟，请耐心等待。\n",
            "下载完成后会自动安装。\n\n",
            "点击「确定」开始下载..."
        ));

        unsafe {
            MessageBoxW(
                HWND::default(),
                PCWSTR::from_raw(message.as_ptr()),
                PCWSTR::from_raw(title.as_ptr()),
                MB_OK | MB_ICONINFORMATION,
            );
        }
    }

    /// 下载并安装 WebView2 Bootstrapper
    /// 返回 Ok(()) 表示安装成功
    pub fn download_and_install() -> Result<(), String> {
        // 先显示下载提示
        show_downloading_dialog();

        // Microsoft 官方 WebView2 Bootstrapper 下载链接
        let download_url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
        
        // 获取临时目录
        let temp_dir = std::env::temp_dir();
        let installer_path = temp_dir.join("MicrosoftEdgeWebview2Setup.exe");

        // 下载 Bootstrapper（使用阻塞请求，因为此时还没有 async runtime）
        let response = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 增加超时到 5 分钟
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?
            .get(download_url)
            .send()
            .map_err(|e| format!("网络请求失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("服务器返回错误，HTTP 状态码: {}", response.status()));
        }

        let bytes = response.bytes()
            .map_err(|e| format!("读取下载内容失败: {}", e))?;

        // 保存到临时文件
        std::fs::write(&installer_path, &bytes)
            .map_err(|e| format!("保存安装程序失败: {}", e))?;

        // 运行安装程序（静默安装）
        let status = std::process::Command::new(&installer_path)
            .args(["/silent", "/install"])
            .status()
            .map_err(|e| format!("运行安装程序失败: {}", e))?;

        // 清理临时文件
        let _ = std::fs::remove_file(&installer_path);

        // 检查退出码
        // 0 = 成功安装
        // -2147219416 (0x80073CF8) = 已经安装，视为成功
        let exit_code = status.code().unwrap_or(-1);
        if status.success() || exit_code == -2147219416 {
            show_success_dialog();
            Ok(())
        } else {
            Err(format!("安装程序退出码: {} (0x{:X})", exit_code, exit_code as u32))
        }
    }

    /// 执行完整的 WebView2 检测和安装流程
    /// 返回 true 表示可以继续启动应用，false 表示应该退出
    pub fn ensure_webview2() -> bool {
        if is_webview2_installed() {
            return true;
        }

        // WebView2 未安装，询问用户是否自动安装
        if show_install_prompt() {
            // 用户选择自动安装
            match download_and_install() {
                Ok(()) => {
                    // 安装成功，继续启动
                    true
                }
                Err(e) => {
                    // 安装失败，显示手动安装引导（带错误信息）
                    show_manual_install_dialog_with_error(Some(&e));
                    false
                }
            }
        } else {
            // 用户选择手动安装
            show_manual_install_dialog_with_error(None);
            false
        }
    }
}

fn main() {
    // Windows 平台：启动前检测 WebView2
    #[cfg(target_os = "windows")]
    {
        if !webview2_check::ensure_webview2() {
            // 用户选择手动安装或安装失败，退出程序
            std::process::exit(1);
        }
    }

    mxu_lib::run()
}
