//! 下载相关命令
//!
//! 提供流式文件下载功能，支持进度回调和取消

use log::{error, info, warn};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tauri::Emitter;

use super::types::DownloadProgressEvent;
use super::update::move_to_old_folder;
use super::utils::build_user_agent;

/// 全局下载取消标志
static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
/// 当前下载的 session ID，用于区分不同的下载任务
static CURRENT_DOWNLOAD_SESSION: AtomicU64 = AtomicU64::new(0);

/// 流式下载文件，支持进度回调和取消
///
/// 使用 reqwest 进行流式下载，直接写入文件而不经过内存缓冲，
/// 解决 JavaScript 下载大文件时的性能问题
///
/// 返回值包含 session_id，前端用于匹配进度事件
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    save_path: String,
    total_size: Option<u64>,
    proxy_url: Option<String>,
) -> Result<u64, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    info!("download_file: {} -> {}", url, save_path);

    // 生成新的 session ID，使旧下载的进度事件无效
    let session_id = CURRENT_DOWNLOAD_SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    info!("download_file session_id: {}", session_id);

    // 重置取消标志
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);

    let save_path_obj = std::path::Path::new(&save_path);

    // 确保目录存在
    if let Some(parent) = save_path_obj.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }

    // 使用临时文件名下载
    let temp_path = format!("{}.downloading", save_path);

    // 构建 HTTP 客户端和请求
    let mut client_builder = reqwest::Client::builder()
        .user_agent(build_user_agent())
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10));

    // 配置代理（如果提供）
    if let Some(ref proxy) = proxy_url {
        if !proxy.is_empty() {
            info!("[下载] 使用代理: {}", proxy);
            info!("[下载] 目标: {}", url);
            let reqwest_proxy = reqwest::Proxy::all(proxy).map_err(|e| {
                error!("代理配置失败: {} (代理地址: {})", e, proxy);
                format!(
                    "代理配置失败: {}。请检查代理格式是否正确（支持 http:// 或 socks5://）",
                    e
                )
            })?;
            client_builder = client_builder.proxy(reqwest_proxy);
        } else {
            info!("[下载] 直连（无代理）: {}", url);
        }
    } else {
        info!("[下载] 直连（无代理）: {}", url);
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP 错误: {}", response.status()));
    }

    // 获取文件大小
    let content_length = response.content_length();
    let total = total_size.or(content_length).unwrap_or(0);

    // 创建临时文件
    let mut file = std::fs::File::create(&temp_path).map_err(|e| format!("无法创建文件: {}", e))?;

    // 流式下载
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_progress_time = std::time::Instant::now();
    let mut last_downloaded: u64 = 0;

    // 使用较大的缓冲区减少写入次数
    let mut buffer = Vec::with_capacity(256 * 1024); // 256KB 缓冲

    while let Some(chunk) = stream.next().await {
        // 检查取消标志或 session 是否已过期
        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst)
            || CURRENT_DOWNLOAD_SESSION.load(Ordering::SeqCst) != session_id
        {
            info!("download_file cancelled (session {})", session_id);
            drop(file);
            // 清理临时文件
            let _ = std::fs::remove_file(&temp_path);
            return Err("下载已取消".to_string());
        }

        let chunk = chunk.map_err(|e| format!("下载数据失败: {}", e))?;

        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        // 当缓冲区达到一定大小时写入磁盘
        if buffer.len() >= 256 * 1024 {
            file.write_all(&buffer)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            buffer.clear();
        }

        // 每 100ms 发送一次进度更新
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(last_progress_time);
        if elapsed.as_millis() >= 100 {
            let bytes_in_interval = downloaded - last_downloaded;
            let speed = (bytes_in_interval as f64 / elapsed.as_secs_f64()) as u64;
            let progress = if total > 0 {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };

            let _ = app.emit(
                "download-progress",
                DownloadProgressEvent {
                    session_id,
                    downloaded_size: downloaded,
                    total_size: total,
                    speed,
                    progress,
                },
            );

            last_progress_time = now;
            last_downloaded = downloaded;
        }
    }

    // 最后再检查一次取消标志
    if DOWNLOAD_CANCELLED.load(Ordering::SeqCst)
        || CURRENT_DOWNLOAD_SESSION.load(Ordering::SeqCst) != session_id
    {
        info!(
            "download_file cancelled before finalization (session {})",
            session_id
        );
        drop(file);
        let _ = std::fs::remove_file(&temp_path);
        return Err("下载已取消".to_string());
    }

    // 写入剩余缓冲区
    if !buffer.is_empty() {
        file.write_all(&buffer)
            .map_err(|e| format!("写入文件失败: {}", e))?;
    }

    // 确保数据写入磁盘
    file.sync_all()
        .map_err(|e| format!("同步文件失败: {}", e))?;
    drop(file);

    // 发送最终进度
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            session_id,
            downloaded_size: downloaded,
            total_size: if total > 0 { total } else { downloaded },
            speed: 0,
            progress: 100.0,
        },
    );

    // 将可能存在的旧文件移动到 old 文件夹
    if save_path_obj.exists() {
        let _ = move_to_old_folder(save_path_obj);
    }

    // 重命名临时文件
    std::fs::rename(&temp_path, &save_path).map_err(|e| format!("重命名文件失败: {}", e))?;

    info!(
        "download_file completed: {} bytes (session {})",
        downloaded, session_id
    );
    Ok(session_id)
}

/// 取消下载
#[tauri::command]
pub fn cancel_download(save_path: String) -> Result<(), String> {
    info!("cancel_download called for: {}", save_path);

    // 设置取消标志，让下载循环退出
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);

    // 同时尝试删除临时文件（如果已经创建）
    let temp_path = format!("{}.downloading", save_path);
    let path = std::path::Path::new(&temp_path);

    if path.exists() {
        if let Err(e) = std::fs::remove_file(path) {
            // 文件可能正在被写入，记录警告但不报错
            warn!("cancel_download: failed to remove {}: {}", temp_path, e);
        } else {
            info!("cancel_download: removed {}", temp_path);
        }
    }

    Ok(())
}
