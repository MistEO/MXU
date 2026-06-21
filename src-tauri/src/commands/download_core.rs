use futures_util::StreamExt;
use reqwest::header::{CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::update::move_to_old_folder;

#[derive(Debug, Clone)]
pub struct DownloadRequest {
    pub url: String,
    pub save_path: PathBuf,
    pub expected_size: Option<u64>,
    pub resume_key: Option<String>,
    pub sha256: Option<String>,
    pub session_id: u64,
}

#[derive(Debug)]
pub struct CoreDownloadResult {
    pub actual_save_path: String,
    pub detected_filename: Option<String>,
    pub downloaded_size: u64,
    pub total_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResumeMetadata {
    resume_key: String,
    expected_size: Option<u64>,
    sha256: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    detected_filename: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParsedContentRange {
    Range { start: u64, end: u64, total: u64 },
    Unsatisfied { total: u64 },
}

pub async fn download<F>(
    client: &Client,
    request: DownloadRequest,
    downloaded_shared: Arc<AtomicU64>,
    session_received_shared: Arc<AtomicU64>,
    total_shared: Arc<AtomicU64>,
    is_cancelled: F,
) -> Result<CoreDownloadResult, String>
where
    F: Fn() -> bool,
{
    if let Some(parent) = request.save_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }

    let resumable = request.resume_key.is_some();
    let part_path = if resumable {
        PathBuf::from(format!("{}.downloading", request.save_path.display()))
    } else {
        PathBuf::from(format!(
            "{}.{}.downloading",
            request.save_path.display(),
            request.session_id
        ))
    };
    let metadata_path = PathBuf::from(format!("{}.json", part_path.display()));

    if resumable {
        cleanup_legacy_session_files(request.save_path.parent().unwrap_or_else(|| Path::new(".")));
    }

    let normalized_sha256 = request.sha256.as_deref().map(normalize_sha256);
    let mut metadata = load_compatible_metadata(
        &part_path,
        &metadata_path,
        request.resume_key.as_deref(),
        request.expected_size,
        normalized_sha256.as_deref(),
    );
    let mut resume_offset = metadata
        .as_ref()
        .and_then(|_| std::fs::metadata(&part_path).ok())
        .map(|m| m.len())
        .unwrap_or(0);

    if let Some(expected) = request.expected_size {
        if resume_offset > expected {
            remove_download_artifacts(&part_path, &metadata_path);
            metadata = None;
            resume_offset = 0;
        }
    }

    let mut response = send_request(client, &request.url, resume_offset, metadata.as_ref()).await?;

    if response.status() == StatusCode::RANGE_NOT_SATISFIABLE && resume_offset > 0 {
        let remote_total = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_range)
            .and_then(|v| match v {
                ParsedContentRange::Unsatisfied { total } => Some(total),
                ParsedContentRange::Range { .. } => None,
            });

        if remote_total == Some(resume_offset)
            && request
                .expected_size
                .map(|expected| expected == resume_offset)
                .unwrap_or(true)
        {
            let detected_filename = extract_filename_from_response(&response)
                .or_else(|| metadata.as_ref().and_then(|m| m.detected_filename.clone()));
            return finalize_download(
                &request,
                &part_path,
                &metadata_path,
                detected_filename,
                resume_offset,
                normalized_sha256.as_deref(),
            )
            .await;
        }

        remove_download_artifacts(&part_path, &metadata_path);
        metadata = None;
        resume_offset = 0;
        response = send_request(client, &request.url, 0, None).await?;
    }

    if !response.status().is_success() {
        return Err(format!("HTTP 错误: {}", response.status()));
    }

    let mut append = false;
    let response_total = if response.status() == StatusCode::PARTIAL_CONTENT {
        let validators_match = metadata
            .as_ref()
            .map(|metadata| response_validators_match(metadata, &response))
            .unwrap_or(true);
        let content_range = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_range);

        match content_range {
            Some(ParsedContentRange::Range { start, end, total })
                if resume_offset > 0
                    && start == resume_offset
                    && end >= start
                    && end < total
                    && validators_match =>
            {
                append = true;
                Some(total)
            }
            _ if resume_offset > 0 => {
                remove_download_artifacts(&part_path, &metadata_path);
                metadata = None;
                resume_offset = 0;
                response = send_request(client, &request.url, 0, None).await?;
                if !response.status().is_success()
                    || response.status() == StatusCode::PARTIAL_CONTENT
                {
                    return Err(format!(
                        "服务器返回了无效的 Content-Range: {}",
                        response.status()
                    ));
                }
                response.content_length()
            }
            _ => {
                remove_download_artifacts(&part_path, &metadata_path);
                return Err("服务器在未请求断点续传时返回了 206".to_string());
            }
        }
    } else {
        if resume_offset > 0 {
            remove_download_artifacts(&part_path, &metadata_path);
            metadata = None;
            resume_offset = 0;
        }
        response.content_length()
    };

    if let (Some(expected), Some(remote)) = (request.expected_size, response_total) {
        if expected != remote {
            remove_download_artifacts(&part_path, &metadata_path);
            return Err(format!(
                "下载文件大小不匹配: 预期 {} 字节，服务器返回 {} 字节",
                expected, remote
            ));
        }
    }

    let total = response_total.or(request.expected_size).unwrap_or(0);
    downloaded_shared.store(resume_offset, Ordering::Relaxed);
    total_shared.store(total, Ordering::Relaxed);

    let response_filename = extract_filename_from_response(&response);
    let detected_filename =
        response_filename.or_else(|| metadata.as_ref().and_then(|m| m.detected_filename.clone()));

    if resumable && metadata.is_none() {
        let new_metadata = ResumeMetadata {
            resume_key: request.resume_key.clone().unwrap_or_default(),
            expected_size: request.expected_size,
            sha256: normalized_sha256.clone(),
            etag: header_string(&response, ETAG),
            last_modified: header_string(&response, LAST_MODIFIED),
            detected_filename: detected_filename.clone(),
        };
        write_metadata_atomic(&metadata_path, &new_metadata, request.session_id)?;
    }

    let (write_tx, write_rx) = tokio::sync::mpsc::channel::<bytes::Bytes>(64);
    let writer_path = part_path.clone();
    let write_handle = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&writer_path)
            .map_err(|e| format!("无法创建文件: {}", e))?;
        let mut writer = BufWriter::with_capacity(512 * 1024, file);
        let mut write_rx = write_rx;
        while let Some(chunk) = write_rx.blocking_recv() {
            writer
                .write_all(&chunk)
                .map_err(|e| format!("写入文件失败: {}", e))?;
        }
        writer
            .flush()
            .map_err(|e| format!("刷新写入缓冲区失败: {}", e))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|e| format!("同步文件失败: {}", e))?;
        Ok(())
    });

    let mut stream = response.bytes_stream();
    let mut downloaded = resume_offset;
    let mut transfer_error = None;
    let mut cancelled = false;

    while let Some(chunk) = stream.next().await {
        if is_cancelled() {
            cancelled = true;
            transfer_error = Some("下载已取消".to_string());
            break;
        }

        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(e) => {
                transfer_error = Some(format!("下载数据失败: {}", e));
                break;
            }
        };

        let len = chunk.len() as u64;
        if write_tx.send(chunk).await.is_err() {
            transfer_error = Some("磁盘写入线程异常退出".to_string());
            break;
        }
        downloaded += len;
        downloaded_shared.store(downloaded, Ordering::Relaxed);
        session_received_shared.fetch_add(len, Ordering::Relaxed);
    }

    if transfer_error.is_none() && is_cancelled() {
        cancelled = true;
        transfer_error = Some("下载已取消".to_string());
    }

    drop(write_tx);
    let write_result = write_handle
        .await
        .map_err(|e| format!("写入任务异常: {}", e))?;

    if let Err(write_error) = write_result {
        if !resumable {
            remove_download_artifacts(&part_path, &metadata_path);
        }
        return Err(write_error);
    }

    if let Some(error) = transfer_error {
        if cancelled || !resumable {
            remove_download_artifacts(&part_path, &metadata_path);
        }
        return Err(error);
    }

    let actual_size = std::fs::metadata(&part_path)
        .map_err(|e| format!("无法读取下载文件大小: {}", e))?
        .len();
    if total > 0 && actual_size != total {
        if actual_size > total || !resumable {
            remove_download_artifacts(&part_path, &metadata_path);
        }
        return Err(format!(
            "下载文件不完整: 已下载 {} 字节，总大小 {} 字节",
            actual_size, total
        ));
    }

    finalize_download(
        &request,
        &part_path,
        &metadata_path,
        detected_filename,
        actual_size,
        normalized_sha256.as_deref(),
    )
    .await
}

async fn send_request(
    client: &Client,
    url: &str,
    offset: u64,
    metadata: Option<&ResumeMetadata>,
) -> Result<Response, String> {
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(RANGE, format!("bytes={}-", offset));
        if let Some(if_range) = metadata.and_then(if_range_value) {
            request = request.header(IF_RANGE, if_range);
        }
    }
    request.send().await.map_err(|e| format!("请求失败: {}", e))
}

async fn finalize_download(
    request: &DownloadRequest,
    part_path: &Path,
    metadata_path: &Path,
    detected_filename: Option<String>,
    downloaded_size: u64,
    expected_sha256: Option<&str>,
) -> Result<CoreDownloadResult, String> {
    if let Some(expected) = expected_sha256 {
        if let Err(error) = verify_sha256(part_path, expected).await {
            remove_download_artifacts(part_path, metadata_path);
            return Err(error);
        }
    }

    let actual_save_path =
        resolve_actual_save_path(&request.save_path, detected_filename.as_deref());
    if actual_save_path.exists() {
        move_to_old_folder(&actual_save_path)?;
    }
    std::fs::rename(part_path, &actual_save_path).map_err(|e| format!("重命名文件失败: {}", e))?;
    let _ = std::fs::remove_file(metadata_path);

    Ok(CoreDownloadResult {
        actual_save_path: actual_save_path.to_string_lossy().to_string(),
        detected_filename,
        downloaded_size,
        total_size: downloaded_size,
    })
}

fn load_compatible_metadata(
    part_path: &Path,
    metadata_path: &Path,
    resume_key: Option<&str>,
    expected_size: Option<u64>,
    sha256: Option<&str>,
) -> Option<ResumeMetadata> {
    let Some(resume_key) = resume_key else {
        remove_download_artifacts(part_path, metadata_path);
        return None;
    };
    if !part_path.exists() || !metadata_path.exists() {
        remove_download_artifacts(part_path, metadata_path);
        return None;
    }

    let metadata = File::open(metadata_path)
        .ok()
        .and_then(|file| serde_json::from_reader::<_, ResumeMetadata>(BufReader::new(file)).ok());
    let compatible = metadata.filter(|metadata| {
        metadata.resume_key == resume_key
            && metadata.expected_size == expected_size
            && metadata.sha256.as_deref() == sha256
    });

    if compatible.is_none() {
        remove_download_artifacts(part_path, metadata_path);
    }
    compatible
}

fn write_metadata_atomic(
    metadata_path: &Path,
    metadata: &ResumeMetadata,
    session_id: u64,
) -> Result<(), String> {
    let temp_path = PathBuf::from(format!("{}.{}.tmp", metadata_path.display(), session_id));
    let mut file = File::create(&temp_path).map_err(|e| format!("无法创建下载元数据: {}", e))?;
    serde_json::to_writer(&mut file, metadata).map_err(|e| format!("无法写入下载元数据: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("无法同步下载元数据: {}", e))?;
    std::fs::rename(&temp_path, metadata_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("无法保存下载元数据: {}", e)
    })
}

fn remove_download_artifacts(part_path: &Path, metadata_path: &Path) {
    let _ = std::fs::remove_file(part_path);
    let _ = std::fs::remove_file(metadata_path);
}

fn cleanup_legacy_session_files(directory: &Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".downloading") else {
            continue;
        };
        let Some(session) = stem.rsplit('.').next() else {
            continue;
        };
        if !session.is_empty() && session.chars().all(|c| c.is_ascii_digit()) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn if_range_value(metadata: &ResumeMetadata) -> Option<String> {
    metadata
        .etag
        .as_ref()
        .filter(|etag| !etag.trim_start().starts_with("W/"))
        .cloned()
        .or_else(|| metadata.last_modified.clone())
}

fn response_validators_match(metadata: &ResumeMetadata, response: &Response) -> bool {
    if let Some(expected) = metadata
        .etag
        .as_ref()
        .filter(|etag| !etag.trim_start().starts_with("W/"))
    {
        return header_string(response, ETAG)
            .map(|actual| actual == *expected)
            .unwrap_or(true);
    }
    if let Some(expected) = metadata.last_modified.as_ref() {
        return header_string(response, LAST_MODIFIED)
            .map(|actual| actual == *expected)
            .unwrap_or(true);
    }
    true
}

fn header_string(response: &Response, name: reqwest::header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn parse_content_range(value: &str) -> Option<ParsedContentRange> {
    let value = value.trim().strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let total = total.parse().ok()?;
    if range == "*" {
        return Some(ParsedContentRange::Unsatisfied { total });
    }
    let (start, end) = range.split_once('-')?;
    Some(ParsedContentRange::Range {
        start: start.parse().ok()?,
        end: end.parse().ok()?,
        total,
    })
}

fn normalize_sha256(value: &str) -> String {
    value
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(value.trim())
        .to_ascii_lowercase()
}

async fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let path = path.to_path_buf();
    let expected = expected.to_string();
    tokio::task::spawn_blocking(move || verify_sha256_sync(&path, &expected))
        .await
        .map_err(|e| format!("SHA-256 校验任务失败: {}", e))?
}

fn verify_sha256_sync(path: &Path, expected: &str) -> Result<(), String> {
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("更新包 SHA-256 格式无效".to_string());
    }
    let file = File::open(path).map_err(|e| format!("无法读取下载文件: {}", e))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("无法校验下载文件: {}", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        return Err(format!(
            "更新包 SHA-256 校验失败: 预期 {}，实际 {}",
            expected, actual
        ));
    }
    Ok(())
}

fn resolve_actual_save_path(save_path: &Path, detected_filename: Option<&str>) -> PathBuf {
    detected_filename
        .and_then(|filename| save_path.parent().map(|parent| parent.join(filename)))
        .unwrap_or_else(|| save_path.to_path_buf())
}

fn extract_filename_from_response(response: &Response) -> Option<String> {
    if let Some(cd) = response.headers().get("content-disposition") {
        if let Ok(cd_str) = cd.to_str() {
            if let Some(filename) = parse_content_disposition(cd_str) {
                if let Some(safe) = sanitize_filename(&filename) {
                    return Some(safe);
                }
            }
        }
    }

    let path = response.url().path();
    if let Some(last_segment) = path.rsplit('/').next() {
        if !last_segment.is_empty() {
            if let Ok(decoded) = urlencoding::decode(last_segment) {
                let filename = decoded.to_string();
                if filename.contains('.') {
                    return sanitize_filename(&filename);
                }
            }
        }
    }
    None
}

fn sanitize_filename(filename: &str) -> Option<String> {
    let name = filename.rsplit(['/', '\\']).next().unwrap_or(filename);
    if name.is_empty() || name == "." || name == ".." || name.starts_with("..") {
        return None;
    }
    name.contains('.').then(|| name.to_string())
}

fn parse_content_disposition(header: &str) -> Option<String> {
    let header_lower = header.to_lowercase();
    if let Some(start) = header_lower.find("filename*=") {
        let rest = &header[start + 10..];
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

    let mut search_start = 0;
    while let Some(pos) = header_lower[search_start..].find("filename=") {
        let absolute_pos = search_start + pos;
        if absolute_pos > 0 && header.as_bytes().get(absolute_pos - 1) == Some(&b'*') {
            search_start = absolute_pos + 9;
            continue;
        }
        let filename = header[absolute_pos + 9..]
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::extract::State;
    use axum::http::{HeaderMap, Response as HttpResponse};
    use axum::routing::get;
    use axum::Router;
    use bytes::Bytes;
    use futures_util::stream;
    use std::convert::Infallible;
    use std::io;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;
    use std::time::Duration;
    use tempfile::TempDir;

    #[derive(Debug, Clone, Copy)]
    enum ServerMode {
        HonorRange,
        IgnoreRange,
        InvalidRange,
        ChangedValidator,
        Interrupt,
        Slow,
    }

    #[derive(Clone)]
    struct TestServerState {
        data: Arc<Vec<u8>>,
        mode: Arc<Mutex<ServerMode>>,
        requests: Arc<Mutex<Vec<(Option<String>, Option<String>)>>>,
    }

    async fn serve_file(
        State(state): State<TestServerState>,
        headers: HeaderMap,
    ) -> HttpResponse<Body> {
        let range = headers
            .get(RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let if_range = headers
            .get(IF_RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        state
            .requests
            .lock()
            .unwrap()
            .push((range.clone(), if_range.clone()));

        let mode = *state.mode.lock().unwrap();
        let data = state.data.clone();
        if matches!(mode, ServerMode::Interrupt) {
            let split = data.len() / 2;
            let first_chunk = Bytes::copy_from_slice(&data[..split]);
            let body = Body::from_stream(stream::unfold(0, move |step| {
                let first_chunk = first_chunk.clone();
                async move {
                    match step {
                        0 => Some((Ok::<Bytes, io::Error>(first_chunk), 1)),
                        1 => {
                            tokio::time::sleep(Duration::from_millis(25)).await;
                            Some((
                                Err(io::Error::new(
                                    io::ErrorKind::ConnectionReset,
                                    "test interruption",
                                )),
                                2,
                            ))
                        }
                        _ => None,
                    }
                }
            }));
            return response(
                StatusCode::OK,
                body,
                &[
                    ("content-length", data.len().to_string()),
                    ("etag", "\"etag-v1\"".into()),
                ],
            );
        }

        if matches!(mode, ServerMode::Slow) {
            let chunks = data
                .chunks(2)
                .map(Bytes::copy_from_slice)
                .collect::<Vec<_>>();
            let body = Body::from_stream(stream::unfold(
                chunks.into_iter(),
                |mut chunks| async move {
                    let chunk = chunks.next()?;
                    tokio::time::sleep(Duration::from_millis(25)).await;
                    Some((Ok::<Bytes, Infallible>(chunk), chunks))
                },
            ));
            return response(
                StatusCode::OK,
                body,
                &[
                    ("content-length", data.len().to_string()),
                    ("etag", "\"etag-v1\"".into()),
                ],
            );
        }

        let requested_offset = range.as_deref().and_then(parse_range_offset);
        if let Some(offset) = requested_offset {
            if matches!(mode, ServerMode::ChangedValidator)
                && if_range.as_deref() != Some("\"etag-v2\"")
            {
                return full_response(&data, "\"etag-v2\"");
            }
            if matches!(mode, ServerMode::IgnoreRange) {
                return full_response(&data, "\"etag-v1\"");
            }
            if offset >= data.len() {
                return response(
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    Body::empty(),
                    &[("content-range", format!("bytes */{}", data.len()))],
                );
            }
            if matches!(mode, ServerMode::InvalidRange) {
                return response(
                    StatusCode::PARTIAL_CONTENT,
                    Body::from(data.as_slice().to_vec()),
                    &[(
                        "content-range",
                        format!("bytes 0-{}/{}", data.len() - 1, data.len()),
                    )],
                );
            }
            return response(
                StatusCode::PARTIAL_CONTENT,
                Body::from(data[offset..].to_vec()),
                &[
                    (
                        "content-range",
                        format!("bytes {}-{}/{}", offset, data.len() - 1, data.len()),
                    ),
                    ("etag", "\"etag-v1\"".into()),
                ],
            );
        }

        full_response(&data, "\"etag-v1\"")
    }

    fn response(status: StatusCode, body: Body, headers: &[(&str, String)]) -> HttpResponse<Body> {
        let mut builder = HttpResponse::builder().status(status);
        for (name, value) in headers {
            builder = builder.header(*name, value);
        }
        builder.body(body).unwrap()
    }

    fn full_response(data: &[u8], etag: &str) -> HttpResponse<Body> {
        response(
            StatusCode::OK,
            Body::from(data.to_vec()),
            &[
                ("content-length", data.len().to_string()),
                ("etag", etag.to_string()),
            ],
        )
    }

    fn parse_range_offset(value: &str) -> Option<usize> {
        value
            .strip_prefix("bytes=")?
            .strip_suffix('-')?
            .parse()
            .ok()
    }

    async fn start_server(
        data: Vec<u8>,
        mode: ServerMode,
    ) -> (String, TestServerState, tokio::task::JoinHandle<()>) {
        let state = TestServerState {
            data: Arc::new(data),
            mode: Arc::new(Mutex::new(mode)),
            requests: Arc::new(Mutex::new(Vec::new())),
        };
        let app = Router::new()
            .route("/update.zip", get(serve_file))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{}/update.zip", address), state, server)
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn request(url: String, save_path: PathBuf, size: Option<u64>, key: &str) -> DownloadRequest {
        DownloadRequest {
            url,
            save_path,
            expected_size: size,
            resume_key: Some(key.to_string()),
            sha256: None,
            session_id: 1,
        }
    }

    async fn run_download(
        request: DownloadRequest,
        cancelled: Arc<AtomicBool>,
    ) -> Result<CoreDownloadResult, String> {
        download(
            &Client::new(),
            request,
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(0)),
            || cancelled.load(Ordering::SeqCst),
        )
        .await
    }

    fn seed_partial(path: &Path, bytes: &[u8], key: &str, expected_size: Option<u64>, etag: &str) {
        let part_path = PathBuf::from(format!("{}.downloading", path.display()));
        let metadata_path = PathBuf::from(format!("{}.json", part_path.display()));
        std::fs::write(&part_path, bytes).unwrap();
        write_metadata_atomic(
            &metadata_path,
            &ResumeMetadata {
                resume_key: key.to_string(),
                expected_size,
                sha256: None,
                etag: Some(etag.to_string()),
                last_modified: None,
                detected_filename: Some("update.zip".to_string()),
            },
            99,
        )
        .unwrap();
    }

    #[test]
    fn resumes_after_interrupted_transfer() {
        runtime().block_on(async {
            let data = b"0123456789abcdef".to_vec();
            let (url, state, server) = start_server(data.clone(), ServerMode::Interrupt).await;
            let temp = TempDir::new().unwrap();
            let save_path = temp.path().join("update.zip");
            let cancelled = Arc::new(AtomicBool::new(false));

            let first = run_download(
                request(
                    url.clone(),
                    save_path.clone(),
                    Some(data.len() as u64),
                    "v2",
                ),
                cancelled.clone(),
            )
            .await;
            assert!(first.is_err());
            let part_path = PathBuf::from(format!("{}.downloading", save_path.display()));
            let partial_size = std::fs::metadata(&part_path).unwrap().len();
            assert!(partial_size > 0 && partial_size < data.len() as u64);

            *state.mode.lock().unwrap() = ServerMode::HonorRange;
            run_download(
                request(url, save_path.clone(), Some(data.len() as u64), "v2"),
                cancelled,
            )
            .await
            .unwrap();

            assert_eq!(std::fs::read(&save_path).unwrap(), data);
            let requests = state.requests.lock().unwrap();
            assert_eq!(
                requests[1].0.as_deref(),
                Some(format!("bytes={}-", partial_size).as_str())
            );
            assert_eq!(requests[1].1.as_deref(), Some("\"etag-v1\""));
            server.abort();
        });
    }

    #[test]
    fn restarts_when_server_ignores_or_invalidates_range() {
        runtime().block_on(async {
            for mode in [
                ServerMode::IgnoreRange,
                ServerMode::InvalidRange,
                ServerMode::ChangedValidator,
            ] {
                let data = b"complete update package".to_vec();
                let (url, state, server) = start_server(data.clone(), mode).await;
                let temp = TempDir::new().unwrap();
                let save_path = temp.path().join("update.zip");
                seed_partial(
                    &save_path,
                    &data[..5],
                    "v3",
                    Some(data.len() as u64),
                    "\"etag-v1\"",
                );

                run_download(
                    request(url, save_path.clone(), Some(data.len() as u64), "v3"),
                    Arc::new(AtomicBool::new(false)),
                )
                .await
                .unwrap();
                assert_eq!(std::fs::read(&save_path).unwrap(), data);
                assert!(state.requests.lock().unwrap()[0].0.is_some());
                if matches!(mode, ServerMode::InvalidRange) {
                    assert_eq!(state.requests.lock().unwrap().len(), 2);
                    assert!(state.requests.lock().unwrap()[1].0.is_none());
                }
                server.abort();
            }
        });
    }

    #[test]
    fn handles_416_only_for_complete_partial() {
        runtime().block_on(async {
            let data = b"already complete".to_vec();
            let (url, state, server) = start_server(data.clone(), ServerMode::HonorRange).await;
            let temp = TempDir::new().unwrap();
            let save_path = temp.path().join("update.zip");
            seed_partial(
                &save_path,
                &data,
                "v4",
                Some(data.len() as u64),
                "\"etag-v1\"",
            );
            run_download(
                request(
                    url.clone(),
                    save_path.clone(),
                    Some(data.len() as u64),
                    "v4",
                ),
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();
            assert_eq!(std::fs::read(&save_path).unwrap(), data);

            let wrong_temp = TempDir::new().unwrap();
            let wrong_path = wrong_temp.path().join("wrong.zip");
            seed_partial(
                &wrong_path,
                b"oversized stale bytes",
                "v5",
                None,
                "\"etag-v1\"",
            );
            let result = run_download(
                request(url, wrong_path.clone(), None, "v5"),
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();
            assert_eq!(std::fs::read(result.actual_save_path).unwrap(), data);
            assert!(state
                .requests
                .lock()
                .unwrap()
                .iter()
                .any(|request| request.0.is_none()));
            server.abort();
        });
    }

    #[test]
    fn accepts_matching_sha256() {
        runtime().block_on(async {
            let data = b"verified update package".to_vec();
            let expected_sha256 = format!("{:x}", Sha256::digest(&data));
            let (url, _state, server) = start_server(data.clone(), ServerMode::HonorRange).await;
            let temp = TempDir::new().unwrap();
            let save_path = temp.path().join("update.zip");
            let mut download_request = request(
                url,
                save_path.clone(),
                Some(data.len() as u64),
                "matching-checksum",
            );
            download_request.sha256 = Some(expected_sha256);

            run_download(download_request, Arc::new(AtomicBool::new(false)))
                .await
                .unwrap();

            assert_eq!(std::fs::read(save_path).unwrap(), data);
            server.abort();
        });
    }

    #[test]
    fn discards_incompatible_or_corrupt_partial() {
        runtime().block_on(async {
            let data = b"verified package".to_vec();
            let (url, state, server) = start_server(data.clone(), ServerMode::HonorRange).await;
            let temp = TempDir::new().unwrap();
            let save_path = temp.path().join("update.zip");
            seed_partial(
                &save_path,
                &data[..4],
                "old-version",
                Some(data.len() as u64),
                "\"etag-v1\"",
            );
            run_download(
                request(
                    url.clone(),
                    save_path.clone(),
                    Some(data.len() as u64),
                    "new-version",
                ),
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();
            assert!(state.requests.lock().unwrap()[0].0.is_none());

            let corrupt_path = temp.path().join("corrupt.zip");
            let mut corrupt_request = request(
                url,
                corrupt_path.clone(),
                Some(data.len() as u64),
                "checksum",
            );
            corrupt_request.sha256 = Some("0".repeat(64));
            assert!(
                run_download(corrupt_request, Arc::new(AtomicBool::new(false)))
                    .await
                    .is_err()
            );
            assert!(!corrupt_path.exists());
            assert!(!PathBuf::from(format!("{}.downloading", corrupt_path.display())).exists());
            server.abort();
        });
    }

    #[test]
    fn active_cancel_removes_partial_and_metadata() {
        runtime().block_on(async {
            let data = b"a deliberately slow update package".to_vec();
            let (url, _state, server) = start_server(data.clone(), ServerMode::Slow).await;
            let temp = TempDir::new().unwrap();
            let save_path = temp.path().join("update.zip");
            let cancelled = Arc::new(AtomicBool::new(false));
            let task_cancelled = cancelled.clone();
            let task_path = save_path.clone();
            let task = tokio::spawn(async move {
                run_download(
                    request(url, task_path, Some(data.len() as u64), "cancelled"),
                    task_cancelled,
                )
                .await
            });
            tokio::time::sleep(Duration::from_millis(60)).await;
            cancelled.store(true, Ordering::SeqCst);
            assert!(task.await.unwrap().is_err());
            assert!(!PathBuf::from(format!("{}.downloading", save_path.display())).exists());
            assert!(!PathBuf::from(format!("{}.downloading.json", save_path.display())).exists());
            server.abort();
        });
    }
}
