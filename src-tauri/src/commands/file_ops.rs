//! 文件操作命令
//!
//! 提供本地文件读取和路径检查功能

use log::debug;
use std::path::PathBuf;

use super::utils::{get_app_data_dir, get_exe_directory, normalize_path};

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
pub fn export_logs() -> Result<String, String> {
    use std::fs::File;
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // 日志在数据目录下（macOS: ~/Library/Application Support/MXU/debug）
    let data_dir = get_app_data_dir()?;
    let debug_dir = data_dir.join("debug");

    if !debug_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    // 生成带时间戳的文件名
    let now = chrono::Local::now();
    let filename = format!("mxu-logs-{}.zip", now.format("%Y%m%d-%H%M%S"));
    let zip_path = debug_dir.join(&filename);

    let file = File::create(&zip_path).map_err(|e| format!("创建压缩文件失败: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // 辅助函数：将文件添加到 zip
    fn add_file_to_zip(
        zip: &mut ZipWriter<File>,
        path: &std::path::Path,
        archive_name: &str,
        options: SimpleFileOptions,
    ) -> bool {
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

    // 辅助函数：检查是否为图片文件
    fn is_image_file(path: &std::path::Path) -> bool {
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

        let name_str = name.to_string_lossy();
        add_file_to_zip(&mut zip, &path, &name_str, options);
    }

    // 处理 on_error 文件夹（只包含前50张图片）
    let on_error_dir = debug_dir.join("on_error");
    if on_error_dir.exists() && on_error_dir.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&on_error_dir) {
            let mut images: Vec<_> = rd.flatten().filter(|e| is_image_file(&e.path())).collect();

            // 按修改时间排序（最新的在前）
            images.sort_by(|a, b| {
                let time_a = a.metadata().and_then(|m| m.modified()).ok();
                let time_b = b.metadata().and_then(|m| m.modified()).ok();
                time_b.cmp(&time_a)
            });

            // 只取前50张
            for entry in images.into_iter().take(50) {
                let path = entry.path();
                let Some(name) = path.file_name() else {
                    continue;
                };
                let archive_name = format!("on_error/{}", name.to_string_lossy());
                add_file_to_zip(&mut zip, &path, &archive_name, options);
            }
        } else {
            log::warn!("无法读取 on_error 目录");
        }
    }

    zip.finish().map_err(|e| format!("完成压缩失败: {}", e))?;

    Ok(zip_path.to_string_lossy().to_string())
}
