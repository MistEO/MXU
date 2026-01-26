//! WebView2 下载与安装
//!
//! 使用 **Evergreen Bootstrapper（常青引导程序）**：约 2MB 的小型安装包，
//! 运行时会按本机架构（x86/x64/ARM64）从微软服务器下载并安装 WebView2 运行时，
//! 安装后纳入 Evergreen 自动更新。需联网完成安装。
//! 标识: `evergreen-bootstrapper-description`

use std::io::Read;

use super::dialog::CustomDialog;
use super::detection::is_webview2_installed;

/// Evergreen Bootstrapper 下载地址（fwlink 永久链接）。
const DOWNLOAD_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// 手动下载说明页（含 Bootstrapper 与 Standalone x86/x64/ARM64）。
const MANUAL_DOWNLOAD_URL: &str = "https://aka.ms/webview2installer";

fn show_install_failed_dialog(error: &str) {
    let message = format!(
        "自动安装失败：{}\r\n\r\n\
         请手动下载安装：\r\n\
         {}\r\n\r\n\
         安装完成后重启程序。",
        error, MANUAL_DOWNLOAD_URL
    );
    CustomDialog::show_error("WebView2 安装失败", &message);
}

pub fn download_and_install() -> Result<(), String> {
    let progress_dialog =
        CustomDialog::new_progress("正在安装 WebView2", "正在下载 WebView2 运行时...");

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("MicrosoftEdgeWebview2Setup.exe");

    let download_result = (|| -> Result<Vec<u8>, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let response = client
            .get(DOWNLOAD_URL)
            .send()
            .map_err(|e| format!("网络请求失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("服务器返回错误: {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let mut buffer = Vec::new();
        let mut reader = response;
        let mut chunk = [0u8; 8192];

        loop {
            let bytes_read = reader
                .read(&mut chunk)
                .map_err(|e| format!("读取下载内容失败: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            buffer.extend_from_slice(&chunk[..bytes_read]);
            downloaded += bytes_read as u64;

            if let Some(ref pw) = progress_dialog {
                if total_size > 0 {
                    let percent = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
                    pw.set_progress(percent);
                    pw.set_status(&format!(
                        "正在下载... {:.1} MB / {:.1} MB",
                        downloaded as f64 / 1024.0 / 1024.0,
                        total_size as f64 / 1024.0 / 1024.0
                    ));
                } else {
                    pw.set_status(&format!(
                        "正在下载... {:.1} MB",
                        downloaded as f64 / 1024.0 / 1024.0
                    ));
                }
            }
        }

        if let Some(ref pw) = progress_dialog {
            pw.set_progress(100);
            pw.set_status("正在安装...");
        }

        Ok(buffer)
    })();

    if let Some(pw) = progress_dialog {
        pw.close();
    }

    let buffer = download_result?;

    std::fs::write(&installer_path, &buffer)
        .map_err(|e| format!("保存安装程序失败: {}", e))?;

    let status = std::process::Command::new(&installer_path)
        .args(["/silent", "/install"])
        .status()
        .map_err(|e| format!("运行安装程序失败: {}", e))?;

    let _ = std::fs::remove_file(&installer_path);

    let exit_code = status.code().unwrap_or(-1);
    if status.success() || exit_code == -2147219416 {
        Ok(())
    } else {
        Err(format!(
            "安装程序退出码: {} (0x{:X})",
            exit_code,
            exit_code as u32
        ))
    }
}

pub fn ensure_webview2() -> bool {
    if is_webview2_installed() {
        return true;
    }

    match download_and_install() {
        Ok(()) => true,
        Err(e) => {
            show_install_failed_dialog(&e);
            false
        }
    }
}
