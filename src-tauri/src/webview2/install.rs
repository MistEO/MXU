//! WebView2 下载与本地解压
//!
//! 从微软官方 CDN 下载 **Fixed Version Runtime（固定版本运行时）**，
//! 解压到程序目录的 `webview2_runtime/` 下，通过环境变量
//! `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指定运行时路径，不影响系统。

use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;

use super::detection::{is_webview2_disabled, is_webview2_installed};
use super::dialog::CustomDialog;

/// WebView2 Fixed Version Runtime 版本号。
/// 更新版本时需同步更新 `GUID_X64` 和 `GUID_ARM64`。
/// GUID 可在 https://developer.microsoft.com/en-us/microsoft-edge/webview2/ 页面
/// 从 Fixed Version 的下载链接中获取，
/// 或前往 https://github.com/nicehash/NiceHashQuickMiner/releases 查看
const WEBVIEW2_VERSION: &str = "145.0.3800.65";
const GUID_X64: &str = "c411606c-d282-4304-8420-8ae6b1dd3e9a";
const GUID_ARM64: &str = "2d2cf37b-d24c-4c72-b5bc-e8061e7a7583";

/// 隐藏控制台窗口标志
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 获取当前架构对应的下载标签和 GUID
fn get_arch_info() -> Result<(&'static str, &'static str), String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok(("x64", GUID_X64)),
        "aarch64" => Ok(("arm64", GUID_ARM64)),
        other => Err(format!("不支持的架构: {}", other)),
    }
}

/// 获取 WebView2 固定版本运行时的目录路径（exe 同级目录）
pub fn get_webview2_runtime_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "无法获取程序目录".to_string())?;
    Ok(exe_dir.join("webview2_runtime"))
}

fn show_download_failed_dialog(error: &str) {
    let (arch_label, _) = get_arch_info().unwrap_or(("x64", ""));
    let cab_name = format!(
        "Microsoft.WebView2.FixedVersionRuntime.{}.{}.cab",
        WEBVIEW2_VERSION, arch_label
    );
    let message = format!(
        "系统 WebView2 不可用，下载独立 WebView2 运行时失败：\r\n\
         {}\r\n\r\n\
         【方法一】检查网络连接后重启程序重试\r\n\r\n\
         【方法二】手动下载 cab 文件并放到程序同目录\r\n\
         1. 前往 https://aka.ms/webview2installer\r\n\
            选择 \"Fixed Version\" 下载对应架构（{}）的 cab 文件\r\n\
         2. 将下载的 cab 文件（文件名类似 {}）\r\n\
            放到本程序 exe 所在目录下\r\n\
         3. 重启程序，将自动检测并解压使用\r\n\r\n\
         【方法三】手动安装系统 WebView2 运行时\r\n\
         前往 https://aka.ms/webview2installer\r\n\
         下载 Evergreen Bootstrapper，运行安装后重启电脑即可",
        error, arch_label, cab_name
    );
    CustomDialog::show_error("WebView2 下载失败", &message);
}

/// 递归复制目录内容
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("无法创建目录 [{}]: {}", dst.display(), e))?;

    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("无法读取目录 [{}]: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("无法读取目录条目: {}", e))?;
        let src_item = entry.path();
        let dst_item = dst.join(entry.file_name());

        if src_item.is_dir() {
            copy_dir_recursive(&src_item, &dst_item)?;
        } else {
            std::fs::copy(&src_item, &dst_item).map_err(|e| {
                format!(
                    "无法复制文件 [{}] -> [{}]: {}",
                    src_item.display(),
                    dst_item.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

/// 解压 cab 文件到 WebView2 运行时目录
fn extract_cab_to_runtime(cab_path: &std::path::Path, runtime_dir: &std::path::Path) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let extract_temp = temp_dir.join("mxu_webview2_extract");

    let _ = std::fs::remove_dir_all(&extract_temp);
    std::fs::create_dir_all(&extract_temp)
        .map_err(|e| format!("创建临时目录失败: {}", e))?;

    let status = std::process::Command::new("expand.exe")
        .arg(cab_path)
        .arg("-F:*")
        .arg(&extract_temp)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("运行 expand.exe 失败: {}", e))?;

    if !status.success() {
        let _ = std::fs::remove_dir_all(&extract_temp);
        return Err(format!(
            "解压失败，退出码: {}",
            status.code().unwrap_or(-1)
        ));
    }

    // cab 解压后文件可能在版本子目录中
    let mut source_dir = extract_temp.clone();
    if let Ok(entries) = std::fs::read_dir(&extract_temp) {
        for entry in entries.flatten() {
            if entry.path().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("Microsoft.WebView2")
            {
                source_dir = entry.path();
                break;
            }
        }
    }

    // 准备目标目录
    if runtime_dir.exists() {
        let _ = std::fs::remove_dir_all(runtime_dir);
    }
    std::fs::create_dir_all(runtime_dir)
        .map_err(|e| format!("创建运行时目录失败: {}", e))?;

    copy_dir_recursive(&source_dir, runtime_dir)?;

    let _ = std::fs::remove_dir_all(&extract_temp);
    Ok(())
}

/// 检测 exe 同目录下是否存在已下载的 cab 文件，供网络不佳的用户手动放置使用。
/// 优先使用架构匹配的 cab 文件；仅存在不匹配的则弹出警告并返回 None 继续下载。
fn try_extract_local_cab(runtime_dir: &std::path::Path) -> Option<Result<(), String>> {
    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;
    let (expected_arch, _) = get_arch_info().ok()?;

    // 收集所有 cab 文件，区分架构匹配与不匹配
    let mut matched: Option<std::path::PathBuf> = None;
    let mut mismatched_arch: Option<String> = None;

    if let Ok(entries) = std::fs::read_dir(exe_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("Microsoft.WebView2.FixedVersionRuntime.")
                && name_str.ends_with(".cab")
            {
                let cab_arch = name_str
                    .trim_end_matches(".cab")
                    .rsplit('.')
                    .next()
                    .unwrap_or("");
                if cab_arch.eq_ignore_ascii_case(expected_arch) {
                    matched = Some(entry.path());
                    break;
                } else {
                    mismatched_arch = Some(cab_arch.to_string());
                }
            }
        }
    }

    // 优先使用架构匹配的 cab
    if let Some(cab_path) = matched {
        let progress_dialog = CustomDialog::new_progress(
            "正在解压 WebView2",
            "检测到本地 WebView2 运行时 cab 文件，正在解压...",
        );

        let result = extract_cab_to_runtime(&cab_path, runtime_dir);

        if let Some(pw) = progress_dialog {
            pw.close();
        }

        if result.is_ok() {
            let _ = std::fs::remove_file(&cab_path);
        }
        return Some(result);
    }

    // 仅存在不匹配的 cab，弹窗提示
    if let Some(cab_arch) = mismatched_arch {
        CustomDialog::show_error(
            "WebView2 架构不匹配",
            &format!(
                "检测到本地 WebView2 运行时 cab 文件，但架构不匹配：\r\n\
                 文件架构: {}\r\n\
                 系统架构: {}\r\n\r\n\
                 将忽略该文件并尝试在线下载正确版本。",
                cab_arch, expected_arch
            ),
        );
    }

    None
}

/// 下载或解压 WebView2 Fixed Version Runtime 到本地
pub fn download_and_extract() -> Result<(), String> {
    let (arch_label, guid) = get_arch_info()?;
    let cab_name = format!(
        "Microsoft.WebView2.FixedVersionRuntime.{}.{}.cab",
        WEBVIEW2_VERSION, arch_label
    );
    let download_url = format!(
        "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/{}/{}",
        guid, cab_name
    );

    let runtime_dir = get_webview2_runtime_dir()?;

    // 优先检测 exe 同目录下是否存在已下载的 cab 文件
    if let Some(result) = try_extract_local_cab(&runtime_dir) {
        if result.is_ok() {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime_dir);
        }
        return result;
    }

    let progress_dialog = CustomDialog::new_progress(
        "正在下载 WebView2",
        "系统 WebView2 不可用，正在下载独立 WebView2...",
    );

    let temp_dir = std::env::temp_dir();
    let cab_path = temp_dir.join(&cab_name);

    // 下载 cab 文件（流式写入磁盘）
    let download_result = (|| -> Result<(), String> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let response = client
            .get(&download_url)
            .send()
            .map_err(|e| format!("网络请求失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("服务器返回错误: {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let mut reader = std::io::BufReader::with_capacity(256 * 1024, response);
        let mut file = std::fs::File::create(&cab_path)
            .map_err(|e| format!("创建下载文件失败: {}", e))?;
        let mut chunk = [0u8; 256 * 1024];
        let mut last_ui_update = std::time::Instant::now();

        loop {
            let bytes_read = reader
                .read(&mut chunk)
                .map_err(|e| format!("读取下载内容失败: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            std::io::Write::write_all(&mut file, &chunk[..bytes_read])
                .map_err(|e| format!("写入文件失败: {}", e))?;
            downloaded += bytes_read as u64;

            // 节流 UI 更新，避免 SendMessageW 跨线程同步调用阻塞下载
            if last_ui_update.elapsed() >= std::time::Duration::from_millis(200) {
                last_ui_update = std::time::Instant::now();
                if let Some(ref pw) = progress_dialog {
                    if total_size > 0 {
                        let percent = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
                        pw.set_progress(percent);
                        pw.set_status(&format!(
                            "正在下载独立 WebView2... {:.1} MB / {:.1} MB",
                            downloaded as f64 / 1024.0 / 1024.0,
                            total_size as f64 / 1024.0 / 1024.0
                        ));
                    } else {
                        pw.set_status(&format!(
                            "正在下载独立 WebView2... {:.1} MB",
                            downloaded as f64 / 1024.0 / 1024.0
                        ));
                    }
                }
            }
        }

        Ok(())
    })();

    let download_err = download_result.err();
    if let Some(ref e) = download_err {
        if let Some(pw) = progress_dialog {
            pw.close();
        }
        let _ = std::fs::remove_file(&cab_path);
        return Err(e.clone());
    }

    // 更新进度：解压中
    if let Some(ref pw) = progress_dialog {
        pw.set_progress(100);
        pw.set_status("正在解压...");
    }

    // 解压 cab 文件
    let extract_result = extract_cab_to_runtime(&cab_path, &runtime_dir);

    if let Some(pw) = progress_dialog {
        pw.close();
    }

    // 清理下载的 cab 文件
    let _ = std::fs::remove_file(&cab_path);

    extract_result?;

    // 设置环境变量供当前进程使用
    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime_dir);

    Ok(())
}

/// 确保 WebView2 可用：优先使用系统安装，不可用时自动下载独立运行时
pub fn ensure_webview2() -> bool {
    // 检测 WebView2 是否被禁用，弹窗提示后继续走独立运行时流程
    if let Some(reason) = is_webview2_disabled() {
        CustomDialog::show_error(
            "系统 WebView2 已被禁用",
            &format!(
                "检测到系统 WebView2 已被禁用：\r\n{}\r\n\r\n\
                 【什么是 WebView2？】\r\n\
                 WebView2 是微软提供的网页渲染组件，本程序依赖它来\r\n\
                 显示界面。如果 WebView2 被禁用，程序将无法正常运行。\r\n\r\n\
                 【如何解决？】\r\n\
                 方法一：如果使用了 Edge Blocker 等工具\r\n\
                 - 打开 Edge Blocker，点击\"Unblock\"解除禁用\r\n\
                 - 或删除注册表中的 IFEO 拦截项\r\n\r\n\
                 方法二：修改组策略（需要管理员权限）\r\n\
                 1. 按 Win + R，输入 gpedit.msc\r\n\
                 2. 导航到：计算机配置 > 管理模板 > Microsoft Edge WebView2\r\n\
                 3. 将相关策略设置为\"未配置\"或\"已启用\"\r\n\r\n\
                 方法三：加入我们的 QQ 群，获取帮助和支持\r\n\
                 - 群号可在我们的官网或文档底部找到\r\n\r\n\
                 点击确定后将尝试下载独立 WebView2 运行时以继续运行。\r\n\
                 若想恢复使用系统 WebView2，请手动删除 exe 目录下的 webview2_runtime 文件夹",
                reason
            ),
        );
    } else if is_webview2_installed() {
        // 系统 WebView2 可用且未被禁用，直接使用
        return true;
    }

    // 系统不可用或被禁用，下载独立 WebView2 运行时
    match download_and_extract() {
        Ok(()) => true,
        Err(e) => {
            show_download_failed_dialog(&e);
            false
        }
    }
}
