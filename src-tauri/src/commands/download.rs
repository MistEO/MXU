//! 下载相关命令
//!
//! 提供流式文件下载功能，支持进度回调、取消和更新包断点续传。

use log::{error, info, warn};
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::time::{sleep, Duration};

use super::download_core::{self, DownloadRequest};
use super::types::{DownloadProgressEvent, DownloadResult, GitHubRelease};
use super::utils::build_user_agent;

/// 进度上报任务的守卫，在函数任意返回路径上都能确保发送停止信号。
struct ProgressEmitterGuard(Option<tokio::sync::oneshot::Sender<()>>);

impl Drop for ProgressEmitterGuard {
    fn drop(&mut self) {
        if let Some(tx) = self.0.take() {
            let _ = tx.send(());
        }
    }
}

/// 全局下载取消标志。
static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
/// 当前下载的 session ID，用于区分不同的下载任务。
static CURRENT_DOWNLOAD_SESSION: AtomicU64 = AtomicU64::new(0);

/// 根据版本号获取 GitHub Release URL。
#[tauri::command]
pub async fn get_github_release_by_version(
    owner: String,
    repo: String,
    target_version: String,
    github_pat: Option<String>,
    proxy_url: Option<String>,
) -> Result<Option<GitHubRelease>, String> {
    let url = format!("https://api.github.com/repos/{}/{}/releases", owner, repo);
    let mut client_builder = reqwest::Client::builder()
        .user_agent("mxu")
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(3));

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
        } else {
            info!("[下载] 直连（无代理）: {}", url);
        }
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let mut request = client
        .get(&url)
        .header(ACCEPT, "application/vnd.github.v3+json")
        .header(USER_AGENT, "mxu");

    if let Some(pat) = github_pat {
        if !pat.trim().is_empty() {
            request = request.header(AUTHORIZATION, format!("token {}", pat.trim()));
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
    let normalize = |v: &str| {
        v.trim_start_matches(|c| c == 'v' || c == 'V')
            .to_lowercase()
    };
    let target_normalized = normalize(&target_version);

    for release in releases {
        if normalize(&release.tag_name) == target_normalized {
            info!(
                "找到匹配的 Release: {} (tag: {})",
                release.name, release.tag_name
            );
            return Ok(Some(release));
        }
    }
    warn!("未找到匹配的 Release: target_version={}", target_version);
    Ok(None)
}

/// 流式下载文件。更新包传入 `resume_key` 后会保留可验证的半成品供下次续传。
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    save_path: String,
    total_size: Option<u64>,
    proxy_url: Option<String>,
    resume_key: Option<String>,
    sha256: Option<String>,
) -> Result<DownloadResult, String> {
    info!("download_file: {} -> {}", url, save_path);

    let session_id = CURRENT_DOWNLOAD_SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    info!("download_file session_id: {}", session_id);

    let mut client_builder = reqwest::Client::builder()
        .user_agent(build_user_agent())
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(10));

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
        }
    } else {
        info!("[下载] 直连（无代理）: {}", url);
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let downloaded_shared = Arc::new(AtomicU64::new(0));
    let session_received_shared = Arc::new(AtomicU64::new(0));
    let total_shared = Arc::new(AtomicU64::new(total_size.unwrap_or(0)));
    let progress_guard = start_progress_emitter(
        app.clone(),
        session_id,
        downloaded_shared.clone(),
        session_received_shared.clone(),
        total_shared.clone(),
    );

    let core_result = download_core::download(
        &client,
        DownloadRequest {
            url,
            save_path: PathBuf::from(save_path),
            expected_size: total_size.filter(|size| *size > 0),
            resume_key,
            sha256,
            session_id,
        },
        downloaded_shared,
        session_received_shared,
        total_shared,
        || {
            DOWNLOAD_CANCELLED.load(Ordering::SeqCst)
                || CURRENT_DOWNLOAD_SESSION.load(Ordering::SeqCst) != session_id
        },
    )
    .await;

    drop(progress_guard);
    let result = core_result?;
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            session_id,
            downloaded_size: result.downloaded_size,
            total_size: result.total_size,
            speed: 0,
            progress: 100.0,
        },
    );

    info!(
        "download_file completed: {} bytes -> {} (session {})",
        result.downloaded_size, result.actual_save_path, session_id
    );
    Ok(DownloadResult {
        session_id,
        actual_save_path: result.actual_save_path,
        detected_filename: result.detected_filename,
    })
}

fn start_progress_emitter(
    app: tauri::AppHandle,
    session_id: u64,
    downloaded: Arc<AtomicU64>,
    session_received: Arc<AtomicU64>,
    total: Arc<AtomicU64>,
) -> ProgressEmitterGuard {
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let mut last_session_received = session_received.load(Ordering::Relaxed);
        let mut last_instant = tokio::time::Instant::now();
        let mut smoothed_speed = 0.0;
        const EMA_ALPHA: f64 = 0.3;

        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                _ = sleep(Duration::from_millis(100)) => {
                    let current = downloaded.load(Ordering::Relaxed);
                    let current_session_received = session_received.load(Ordering::Relaxed);
                    let total = total.load(Ordering::Relaxed);
                    let now = tokio::time::Instant::now();
                    let elapsed = now.duration_since(last_instant).as_secs_f64();
                    if elapsed <= 0.0 {
                        continue;
                    }
                    let instant_speed = current_session_received
                        .saturating_sub(last_session_received) as f64
                        / elapsed;
                    smoothed_speed = if smoothed_speed == 0.0 {
                        instant_speed
                    } else {
                        EMA_ALPHA * instant_speed + (1.0 - EMA_ALPHA) * smoothed_speed
                    };
                    let progress = if total > 0 {
                        ((current as f64 / total as f64) * 100.0).min(100.0)
                    } else {
                        0.0
                    };
                    let _ = app.emit(
                        "download-progress",
                        DownloadProgressEvent {
                            session_id,
                            downloaded_size: current,
                            total_size: total,
                            speed: smoothed_speed as u64,
                            progress,
                        },
                    );
                    last_session_received = current_session_received;
                    last_instant = now;
                }
            }
        }
    });
    ProgressEmitterGuard(Some(stop_tx))
}

/// 设置取消标志。半成品会在下载写入线程退出后由下载任务清理。
#[tauri::command]
pub fn cancel_download(save_path: String) -> Result<(), String> {
    info!("cancel_download called for: {}", save_path);
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}
