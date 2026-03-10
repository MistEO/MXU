//! 文件操作命令
//!
//! 提供本地文件读取和路径检查功能

use log::debug;
use std::path::{Path, PathBuf};

use super::utils::{get_app_data_dir, get_exe_directory, normalize_path};

const MAX_EXPORT_ARCHIVE_BYTES: u64 = 24_500_000;

#[derive(Clone)]
struct ExportEntry {
    source_path: PathBuf,
    archive_name: String,
}

fn add_file_to_zip<W>(
    zip: &mut zip::ZipWriter<W>,
    path: &Path,
    archive_name: &str,
    options: zip::write::SimpleFileOptions,
) -> bool
where
    W: std::io::Write + std::io::Seek,
{
    use std::fs::File;
    use std::io::{Read, Write};

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("无法打开文件 {:?}: {}", path, e);
            return false;
        }
    };

    let mut content = Vec::new();
    if let Err(e) = file.read_to_end(&mut content) {
        log::warn!("读取文件失败 {:?}: {}", path, e);
        return false;
    }

    if let Err(e) = zip.start_file(archive_name, options) {
        log::warn!("创建 zip 条目失败 {}: {}", archive_name, e);
        return false;
    }

    if let Err(e) = zip.write_all(&content) {
        log::warn!("写入 zip 失败 {}: {}", archive_name, e);
        return false;
    }

    true
}

fn add_entries_to_zip<W>(
    zip: &mut zip::ZipWriter<W>,
    entries: &[ExportEntry],
    options: zip::write::SimpleFileOptions,
) where
    W: std::io::Write + std::io::Seek,
{
    for entry in entries {
        add_file_to_zip(zip, &entry.source_path, &entry.archive_name, options);
    }
}

fn estimate_archive_size(
    entries: &[ExportEntry],
    options: zip::write::SimpleFileOptions,
) -> Result<u64, String> {
    let cursor = std::io::Cursor::new(Vec::<u8>::new());
    let mut zip = zip::ZipWriter::new(cursor);
    add_entries_to_zip(&mut zip, entries, options);
    let cursor = zip
        .finish()
        .map_err(|e| format!("估算压缩包大小失败: {}", e))?;
    Ok(cursor.into_inner().len() as u64)
}

fn normalize_archive_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn collect_files_recursively(dir: &Path, archive_prefix: &str) -> Result<Vec<ExportEntry>, String> {
    if !dir.exists() || !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = std::fs::read_dir(&current_dir)
            .map_err(|e| format!("读取目录失败 [{}]: {}", current_dir.display(), e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !path.is_file() {
                continue;
            }

            let relative_path = match path.strip_prefix(dir) {
                Ok(rel) => rel,
                Err(_) => continue,
            };
            let archive_name = if archive_prefix.is_empty() {
                normalize_archive_path(relative_path)
            } else {
                format!(
                    "{}/{}",
                    archive_prefix.trim_end_matches('/'),
                    normalize_archive_path(relative_path)
                )
            };

            files.push(ExportEntry {
                source_path: path,
                archive_name,
            });
        }
    }

    files.sort_by(|a, b| a.archive_name.cmp(&b.archive_name));
    Ok(files)
}

fn is_image_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    path.extension()
        .map(|ext| {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg"
        })
        .unwrap_or(false)
}

fn resolve_local_file_path(filename: &str) -> Result<PathBuf, String> {
    let exe_dir = get_exe_directory()?;
    let file_path = normalize_path(&exe_dir.join(filename).to_string_lossy());
    // 防止路径穿越，确保仍在 exe 目录下
    if !file_path.starts_with(&exe_dir) {
        return Err(format!("非法文件路径: {}", filename));
    }
    Ok(file_path)
}

/// 读取 exe 同目录下的文本文件
#[tauri::command]
pub fn read_local_file(filename: String) -> Result<String, String> {
    let file_path = resolve_local_file_path(&filename)?;
    debug!("Reading local file: {:?}", file_path);

    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("读取文件失败 [{}]: {}", file_path.display(), e))
}

/// 读取 exe 同目录下的二进制文件，返回 base64 编码
#[tauri::command]
pub fn read_local_file_base64(filename: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let file_path = resolve_local_file_path(&filename)?;
    debug!("Reading local file (base64): {:?}", file_path);

    let data = std::fs::read(&file_path)
        .map_err(|e| format!("读取文件失败 [{}]: {}", file_path.display(), e))?;

    Ok(STANDARD.encode(&data))
}

/// 检查 exe 同目录下的文件是否存在
#[tauri::command]
pub fn local_file_exists(filename: String) -> Result<bool, String> {
    let file_path = resolve_local_file_path(&filename)?;
    Ok(file_path.exists())
}

/// 获取 exe 所在目录路径
#[tauri::command]
pub fn get_exe_dir() -> Result<String, String> {
    let exe_dir = get_exe_directory()?;
    Ok(exe_dir.to_string_lossy().to_string())
}

/// 获取应用数据目录路径
/// - macOS: ~/Library/Application Support/MXU/
/// - Windows/Linux: exe 所在目录
#[tauri::command]
pub fn get_data_dir() -> Result<String, String> {
    let data_dir = get_app_data_dir()?;
    Ok(data_dir.to_string_lossy().to_string())
}

/// 获取当前工作目录
#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get current directory: {}", e))
}

/// 检查 exe 路径是否存在问题
/// 返回: None 表示正常, Some("root") 表示在磁盘根目录, Some("temp") 表示在临时目录
#[tauri::command]
pub fn check_exe_path() -> Option<String> {
    let exe_dir = match get_exe_directory() {
        Ok(dir) => dir,
        Err(_) => return None,
    };

    let path_str = exe_dir.to_string_lossy().to_lowercase();

    // 检查是否在磁盘根目录（如 C:\, D:\ 等）
    // Windows 根目录特征：路径只有盘符和反斜杠，如 "c:\" 或 "d:\"
    if exe_dir.parent().is_none() || exe_dir.parent() == Some(std::path::Path::new("")) {
        return Some("root".to_string());
    }

    // Windows 下额外检查：盘符根目录（如 C:\）
    #[cfg(target_os = "windows")]
    {
        let components: Vec<_> = exe_dir.components().collect();
        // 根目录只有一个组件（盘符前缀）
        if components.len() == 1 {
            return Some("root".to_string());
        }
    }

    // 检查是否在临时目录
    // 常见的临时目录特征
    let temp_indicators = [
        "\\temp\\",
        "/temp/",
        "\\tmp\\",
        "/tmp/",
        "\\appdata\\local\\temp",
        "/appdata/local/temp",
        // Windows 压缩包临时解压目录
        "\\temporary internet files\\",
        "\\7zocab",
        "\\7zo",
        // 一些压缩软件的临时目录
        "\\wz",
        "\\rar$",
        "\\temp_",
    ];

    for indicator in &temp_indicators {
        if path_str.contains(indicator) {
            return Some("temp".to_string());
        }
    }

    // 检查系统临时目录
    if let Ok(temp_dir) = std::env::var("TEMP") {
        let temp_lower = temp_dir.to_lowercase();
        if path_str.starts_with(&temp_lower) {
            return Some("temp".to_string());
        }
    }
    if let Ok(tmp_dir) = std::env::var("TMP") {
        let tmp_lower = tmp_dir.to_lowercase();
        if path_str.starts_with(&tmp_lower) {
            return Some("temp".to_string());
        }
    }

    None
}

/// 为文件设置可执行权限（仅 Unix 系统）
/// Windows 上此命令不做任何操作
#[tauri::command]
pub fn set_executable(file_path: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&file_path)
            .map_err(|e| format!("无法获取文件元数据 [{}]: {}", file_path, e))?;
        let mut permissions = metadata.permissions();
        // 添加可执行权限 (owner, group, others)
        let mode = permissions.mode() | 0o111;
        permissions.set_mode(mode);
        std::fs::set_permissions(&file_path, permissions)
            .map_err(|e| format!("无法设置执行权限 [{}]: {}", file_path, e))?;
        log::info!("Set executable permission: {}", file_path);
    }
    #[cfg(not(unix))]
    {
        let _ = file_path; // 避免未使用警告
    }
    Ok(())
}

/// 导出日志文件为 zip 压缩包
/// 返回生成的 zip 文件路径
#[tauri::command]
pub fn export_logs(
    project_name: Option<String>,
    project_version: Option<String>,
) -> Result<String, String> {
    use std::fs::File;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // 日志在数据目录下（macOS: ~/Library/Application Support/MXU/debug）
    let data_dir = get_app_data_dir()?;
    let debug_dir = data_dir.join("debug");

    if !debug_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    // 生成带时间戳的文件名：项目名-版本号-日期.zip
    let now = chrono::Local::now();
    let date_str = now.format("%Y%m%d-%H%M%S");
    let name = project_name.unwrap_or_else(|| "mxu".to_string());
    let version = project_version.unwrap_or_default();
    let filename = if version.is_empty() {
        format!("{}-logs-{}.zip", name, date_str)
    } else {
        format!("{}-logs-{}-{}.zip", name, version, date_str)
    };
    let zip_path = debug_dir.join(&filename);

    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let empty_archive_size = estimate_archive_size(&[], options)?;
    let mut regular_entries = Vec::new();

    // 遍历 debug 目录下的所有 .log 文件
    let entries = std::fs::read_dir(&debug_dir).map_err(|e| format!("读取日志目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // 使用 early-continue 简化逻辑
        if !path.is_file() {
            continue;
        }
        if path.extension().map(|e| e != "log").unwrap_or(true) {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        let archive_name = name.to_string_lossy().to_string();

        regular_entries.push(ExportEntry {
            source_path: path,
            archive_name,
        });
    }

    regular_entries.sort_by(|a, b| a.archive_name.cmp(&b.archive_name));

    let config_dir = data_dir.join("config");
    regular_entries.extend(collect_files_recursively(&config_dir, "config")?);

    let mut selected_images = Vec::new();
    let mut estimated_archive_size = estimate_archive_size(&regular_entries, options)?;

    if estimated_archive_size > MAX_EXPORT_ARCHIVE_BYTES {
        log::warn!(
            "日志与配置压缩后预计已有 {} bytes，已超过 {} bytes 的导出目标，on_error 图片将全部跳过",
            estimated_archive_size,
            MAX_EXPORT_ARCHIVE_BYTES
        );
    }

    // 处理 on_error 文件夹，按最新优先，直到压缩包接近 24.5 MB
    let on_error_dir = debug_dir.join("on_error");
    if on_error_dir.exists() && on_error_dir.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&on_error_dir) {
            let mut images: Vec<_> = rd.flatten().filter(|e| is_image_file(&e.path())).collect();

            images.sort_by(|a, b| {
                let time_a = a.metadata().and_then(|m| m.modified()).ok();
                let time_b = b.metadata().and_then(|m| m.modified()).ok();
                time_b.cmp(&time_a)
            });

            for entry in images {
                let path = entry.path();
                let Some(name) = path.file_name() else {
                    continue;
                };
                let archive_name = format!("on_error/{}", name.to_string_lossy());

                if estimated_archive_size > MAX_EXPORT_ARCHIVE_BYTES {
                    break;
                }

                let image_entry = ExportEntry {
                    source_path: path,
                    archive_name,
                };
                let estimated_delta =
                    estimate_archive_size(std::slice::from_ref(&image_entry), options)?
                        .saturating_sub(empty_archive_size);

                if estimated_archive_size + estimated_delta > MAX_EXPORT_ARCHIVE_BYTES {
                    log::info!(
                        "on_error 图片已截断：当前预计 {} bytes，再加入 {} 后会超过 {} bytes",
                        estimated_archive_size,
                        estimated_archive_size + estimated_delta,
                        MAX_EXPORT_ARCHIVE_BYTES
                    );
                    break;
                }

                estimated_archive_size += estimated_delta;
                selected_images.push(image_entry);
            }
        } else {
            log::warn!("无法读取 on_error 目录");
        }
    }

    let file = File::create(&zip_path).map_err(|e| format!("创建压缩文件失败: {}", e))?;
    let mut zip = ZipWriter::new(file);
    add_entries_to_zip(&mut zip, &regular_entries, options);
    add_entries_to_zip(&mut zip, &selected_images, options);
    zip.finish().map_err(|e| format!("完成压缩失败: {}", e))?;

    if let Ok(metadata) = std::fs::metadata(&zip_path) {
        log::info!(
            "日志导出完成：{} 个常规文件，{} 张调试图片，压缩包大小 {} bytes",
            regular_entries.len(),
            selected_images.len(),
            metadata.len()
        );
    }

    Ok(zip_path.to_string_lossy().to_string())
}
