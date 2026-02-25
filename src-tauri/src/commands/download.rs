//! 下载相关命令
//!
//! 提供流式文件下载功能，支持进度回调和取消

use log::{error, info, warn};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tauri::Emitter;

use super::types::GitHubRelease;
use reqwest::header::{ACCEPT, USER_AGENT, AUTHORIZATION};

use super::types::{DownloadProgressEvent, DownloadResult};
use super::update::move_to_old_folder;
use super::utils::build_user_agent;

/// 全局下载取消标志
static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
/// 当前下载的 session ID，用于区分不同的下载任务
static CURRENT_DOWNLOAD_SESSION: AtomicU64 = AtomicU64::new(0);

/// 根据版本号获取 GitHub Release URL
///
/// 使用 GitHub API 获取指定版本的 Release 信息，支持使用 GitHub PAT 和代理
/// 解析 GitHub API 返回的 JSON 数据，找到与 target_version 匹配的 release，并返回 URL
#[tauri::command]
pub async fn get_github_release_by_version(
    owner: String,
    repo: String,
    target_version: String,
    github_pat: Option<String>,
    proxy_url: Option<String>,
) -> Result<Option<GitHubRelease>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases",
        owner, repo
    );

    // 构造请求头
    let mut client_builder = reqwest::Client::builder()
        .user_agent("mxu")
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(3));

    // 添加代理配置（如果提供）
    if let Some(ref proxy) = proxy_url {
        if !proxy.is_empty() {
            info!("[检查更新] 使用代理: {}", proxy);
            info!("[检查更新] 目标: {}", url);
            let reqwest_proxy = reqwest::Proxy::all(proxy).map_err(|e| {
                error!("代理配置失败: {} (代理地址: {})", e, proxy);
                format!(
                    "代理配置失败: {}。请检查代理格式是否正确（支持 http:// 或 socks5://）",
                    e
                )
            })?;
            client_builder = client_builder.proxy(reqwest_proxy);
        }
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut request = client
        .get(&url)
        .header(ACCEPT, "application/vnd.github.v3+json")
        .header(USER_AGENT, "mxu");

    // 添加 PAT 认证（如果提供）
    if let Some(pat) = github_pat {
        if !pat.trim().is_empty() {
            request = request.header(
                AUTHORIZATION,
                format!("token {}", pat.trim()),
            );
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API 错误: {}", response.status()));
    }

    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let normalize = |v: &str| v.trim_start_matches(|c| c == 'v' || c == 'V').to_lowercase();
    let target_normalized = normalize(&target_version);

    for release in releases {
        if normalize(&release.tag_name) == target_normalized {
            info!("找到匹配的 Release: {} (tag: {})", release.name, release.tag_name);
            return Ok(Some(release));
        }
    }
    warn!("未找到匹配的 Release: target_version={}", target_version);
    Ok(None)
}

/// 流式下载文件，支持进度回调和取消
///
/// 使用 reqwest 进行流式下载，直接写入文件而不经过内存缓冲，
/// 解决 JavaScript 下载大文件时的性能问题
///
/// 返回 DownloadResult，包含 session_id 和实际保存路径
/// 如果检测到重定向后的 URL 或 Content-Disposition 包含正确的文件名，
/// 会使用该文件名保存（替换原始 save_path 的文件名部分）
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    save_path: String,
    total_size: Option<u64>,
    proxy_url: Option<String>,
) -> Result<DownloadResult, String> {
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

    // 构建 HTTP 客户端和请求
    let mut client_builder = reqwest::Client::builder()
        .user_agent(build_user_agent())
        .timeout(std::time::Duration::from_secs(600)) // 10 分钟超时，足够下载大文件但防止无限挂起
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

    // 尝试从 Content-Disposition header 或最终 URL 提取文件名
    let detected_filename = extract_filename_from_response(&response);
    if let Some(ref name) = detected_filename {
        info!("[下载] 检测到文件名: {}", name);
    }

    // 确定实际保存路径
    let actual_save_path = if let Some(ref filename) = detected_filename {
        // 使用检测到的文件名，保持原目录
        if let Some(parent) = save_path_obj.parent() {
            parent.join(filename).to_string_lossy().to_string()
        } else {
            filename.clone()
        }
    } else {
        save_path.clone()
    };

    let actual_save_path_obj = std::path::Path::new(&actual_save_path);

    // 使用临时文件名下载
    let temp_path = format!("{}.downloading", actual_save_path);

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
    if actual_save_path_obj.exists() {
        let _ = move_to_old_folder(actual_save_path_obj);
    }

    // 重命名临时文件
    std::fs::rename(&temp_path, &actual_save_path).map_err(|e| format!("重命名文件失败: {}", e))?;

    info!(
        "download_file completed: {} bytes -> {} (session {})",
        downloaded, actual_save_path, session_id
    );

    Ok(DownloadResult {
        session_id,
        actual_save_path,
        detected_filename,
    })
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

/// 从 HTTP 响应中提取文件名
///
/// 优先级：
/// 1. Content-Disposition header 中的 filename
/// 2. 最终 URL（重定向后）的路径部分
fn extract_filename_from_response(response: &reqwest::Response) -> Option<String> {
    // 1. 尝试从 Content-Disposition header 提取
    if let Some(cd) = response.headers().get("content-disposition") {
        if let Ok(cd_str) = cd.to_str() {
            if let Some(filename) = parse_content_disposition(cd_str) {
                if let Some(safe) = sanitize_filename(&filename) {
                    return Some(safe);
                }
            }
        }
    }

    // 2. 尝试从最终 URL 提取（重定向后的 URL）
    let final_url = response.url();
    let path = final_url.path();

    // 获取路径的最后一部分
    if let Some(last_segment) = path.rsplit('/').next() {
        if !last_segment.is_empty() {
            // URL 解码
            if let Ok(decoded) = urlencoding::decode(last_segment) {
                let filename = decoded.to_string();
                // 确保有扩展名，并清理文件名
                if filename.contains('.') {
                    if let Some(safe) = sanitize_filename(&filename) {
                        return Some(safe);
                    }
                }
            }
        }
    }

    None
}

/// 清理文件名，防止目录遍历攻击
///
/// - 移除路径分隔符（/ 和 \）
/// - 移除 .. 片段
/// - 只保留文件名部分
fn sanitize_filename(filename: &str) -> Option<String> {
    // 获取最后一个路径分隔符后的部分（处理 path/to/file.exe 或 path\to\file.exe）
    let name = filename
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(filename);

    // 过滤掉 .. 和空文件名
    if name.is_empty() || name == "." || name == ".." || name.starts_with("..") {
        return None;
    }

    // 确保有扩展名
    if !name.contains('.') {
        return None;
    }

    Some(name.to_string())
}

/// 解析 Content-Disposition header 提取文件名（大小写不敏感）
///
/// 支持格式：
/// - attachment; filename="example.exe"
/// - attachment; filename=example.exe
/// - attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.exe
/// - Attachment; Filename="example.exe" (大小写变体)
fn parse_content_disposition(header: &str) -> Option<String> {
    let header_lower = header.to_lowercase();

    // 首先尝试 filename*=（RFC 5987 编码，优先级更高）
    if let Some(start) = header_lower.find("filename*=") {
        let rest = &header[start + 10..];
        // 格式: UTF-8''encoded_filename 或 utf-8''encoded_filename
        if let Some(quote_pos) = rest.find("''") {
            let encoded = rest[quote_pos + 2..].split(';').next().unwrap_or("").trim();
            if let Ok(decoded) = urlencoding::decode(encoded) {
                let filename = decoded.trim_matches('"').to_string();
                if !filename.is_empty() {
                    return Some(filename);
                }
            }
        }
    }

    // 然后尝试普通的 filename=（但要确保不是 filename*=）
    // 查找 "filename=" 但排除 "filename*="
    let mut search_start = 0;
    while let Some(pos) = header_lower[search_start..].find("filename=") {
        let absolute_pos = search_start + pos;
        // 检查是否是 filename*=（前一个字符是 *）
        if absolute_pos > 0 && header.as_bytes().get(absolute_pos - 1) == Some(&b'*') {
            search_start = absolute_pos + 9;
            continue;
        }

        let rest = &header[absolute_pos + 9..];
        let filename = rest
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_string();
        if !filename.is_empty() {
            return Some(filename);
        }
        break;
    }

    None
}
