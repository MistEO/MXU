//! 文件操作命令
//!
//! 提供本地文件读取和路径检查功能

use log::debug;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::utils::{get_app_data_dir, get_exe_directory, normalize_path};

/// 单个分卷 zip 的大小上限（字节）。
const MAX_VOLUME_BYTES: u64 = 24_500_000;
/// 单个 entry 的 local header + 中央目录条目大小上界（不含文件名）。
const ZIP_PER_ENTRY_HEADER_UPPER_BOUND: u64 = 128;
/// EOCD 记录（zip 末尾）固定大小。
const ZIP_EOCD_BYTES: u64 = 22;
/// 中央目录每条记录的固定字段大小（不含文件名）。
const ZIP_CENTRAL_DIR_FIXED_BYTES: u64 = 46;
/// 保留最近 N 次导出（含本次），多余的会在每次导出完成后清理。
const MAX_EXPORTS_TO_KEEP: usize = 10;

#[derive(Clone)]
struct ExportEntry {
    source_path: PathBuf,
    archive_name: String,
}

/// 包装真实 writer，统计已写字节数，用于在写入分卷过程中实时查询当前卷大小。
struct CountingWriter<W: Write + Seek> {
    inner: W,
    counter: Arc<AtomicU64>,
}

impl<W: Write + Seek> CountingWriter<W> {
    fn new(inner: W) -> (Self, Arc<AtomicU64>) {
        let counter = Arc::new(AtomicU64::new(0));
        (
            Self {
                inner,
                counter: counter.clone(),
            },
            counter,
        )
    }
}

impl<W: Write + Seek> Write for CountingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.counter.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Write + Seek> Seek for CountingWriter<W> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        // counter 是已写字节的**上界**：zip crate 会 seek 回去重写 local header（CRC、
        // 压缩前后大小），重写的字节被 write() 重复计入；写入失败留下的占位 header
        // 也已经进了 counter。上界对分卷预算判断是安全的（只会更早切卷）。
        self.inner.seek(pos)
    }
}

fn add_file_to_zip<W>(
    zip: &mut zip::ZipWriter<W>,
    path: &Path,
    archive_name: &str,
    options: zip::write::SimpleFileOptions,
) -> bool
where
    W: Write + Seek,
{
    use std::fs::File;

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("无法打开文件 {:?}: {}", path, e);
            return false;
        }
    };

    if let Err(e) = zip.start_file(archive_name, options) {
        log::warn!("创建 zip 条目失败 {}: {}", archive_name, e);
        return false;
    }

    if let Err(e) = io::copy(&mut file, zip) {
        log::warn!("写入 zip 失败 {}: {}", archive_name, e);
        return false;
    }

    true
}

fn estimate_entry_upper_bound(entry: &ExportEntry) -> Option<u64> {
    let file_size = entry.source_path.metadata().ok()?.len();
    let name_len = entry.archive_name.len() as u64;
    // 文件名在 local header 和中央目录条目里都出现一次，所以 ×2。
    Some(file_size + ZIP_PER_ENTRY_HEADER_UPPER_BOUND + name_len.saturating_mul(2))
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

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .map(|ext| {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            extensions.iter().any(|e| ext_lower == *e)
        })
        .unwrap_or(false)
}

/// 收集 debug 目录下各子文件夹内以指定后缀结尾的文件（递归）
/// 压缩包内路径保留子文件夹层级，例如 on_error/xxx.json
fn collect_debug_subdir_files(
    debug_dir: &Path,
    extensions: &[&str],
) -> Result<Vec<ExportEntry>, String> {
    let entries = std::fs::read_dir(debug_dir)
        .map_err(|e| format!("读取日志目录失败 [{}]: {}", debug_dir.display(), e))?;

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(dir_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };

        for export in collect_files_recursively(&path, &dir_name)? {
            if has_extension(&export.source_path, extensions) {
                files.push(export);
            }
        }
    }

    files.sort_by(|a, b| a.archive_name.cmp(&b.archive_name));
    Ok(files)
}

pub fn resolve_local_file_path(filename: &str) -> Result<PathBuf, String> {
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

/// 删除 debug 目录中的 .log 文件，可选择排除一个当前正在使用的日志文件
#[tauri::command]
pub fn clear_log_files(exclude_file_name: Option<String>) -> Result<u64, String> {
    let debug_dir = get_app_data_dir()?.join("debug");

    if !debug_dir.exists() {
        return Ok(0);
    }

    let mut deleted = 0_u64;
    let entries = std::fs::read_dir(&debug_dir)
        .map_err(|e| format!("读取日志目录失败 [{}]: {}", debug_dir.display(), e))?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !name.ends_with(".log") {
            continue;
        }

        if exclude_file_name.as_deref() == Some(name) {
            continue;
        }

        match std::fs::remove_file(&path) {
            Ok(()) => deleted = deleted.saturating_add(1),
            Err(e) => log::debug!("Failed to delete log file [{}]: {}", path.display(), e),
        }
    }

    Ok(deleted)
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
        // 7-Zip 临时目录
        "\\7zocab",
        "\\7zo",
        // WinRAR 临时目录
        "\\rar$",
        // WinZip 临时目录
        "\\wz",
        // 360压缩临时目录
        "\\360zip$",
        "\\360zip_tmp",
        "\\360xtract",
        // 2345好压临时目录
        "\\2345zip",
        "\\haozip$",
        // 快压临时目录
        "\\kuaizip$",
        // Bandizip 临时目录
        "\\bztmp",
        "\\bandizip$",
        // 百度网盘下载临时目录
        "\\baiduyundownload",
        "\\baidupcs",
        // 迅雷下载临时目录
        "\\thundernetwork",
        "\\xunlei\\downloads\\.tmp",
        // QQ/微信 文件临时目录
        "\\tencent\\qq\\temp",
        "\\tencent files\\",
        "\\weixin files\\",
        // 通用临时目录特征
        "\\temp_",
        "\\.tmp\\",
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

/// 从指定目录收集图片，按 mtime 从新到旧排序。不做任何大小截断。
fn collect_debug_images(dir: &Path, archive_prefix: &str) -> Vec<ExportEntry> {
    if !dir.exists() || !dir.is_dir() {
        return Vec::new();
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            // 目录不存在的情况上面已经 return 了，所以走到这里通常是权限或 IO 问题。
            log::warn!("读取 {} 目录失败 [{}]: {}", archive_prefix, dir.display(), e);
            return Vec::new();
        }
    };

    let mut images: Vec<_> = rd.flatten().filter(|e| is_image_file(&e.path())).collect();

    images.sort_by(|a, b| {
        let time_a = a.metadata().and_then(|m| m.modified()).ok();
        let time_b = b.metadata().and_then(|m| m.modified()).ok();
        time_b.cmp(&time_a)
    });

    let mut entries = Vec::with_capacity(images.len());
    for entry in images {
        let path = entry.path();
        let Some(name) = path.file_name() else {
            continue;
        };
        let archive_name = format!("{}/{}", archive_prefix, name.to_string_lossy());
        entries.push(ExportEntry {
            source_path: path,
            archive_name,
        });
    }
    entries
}

/// 导出日志文件为分卷 zip 压缩包目录
/// 返回 part01.zip 路径（其同级目录下还有后续分卷）
///
/// 注：`vision/` 是否有内容由 `maa_set_save_draw` 控制；导出时只要 `vision/`
/// 下有文件就一并打包，因此本命令不接收 save_draw 参数。
#[tauri::command]
pub async fn export_logs(
    project_name: Option<String>,
    project_version: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || export_logs_blocking(project_name, project_version))
        .await
        .map_err(|e| format!("导出任务执行失败: {}", e))?
}

fn export_logs_blocking(
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

    let now = chrono::Local::now();
    let date_str = now.format("%Y%m%d-%H%M%S");
    let name = project_name.unwrap_or_else(|| "mxu".to_string());
    let version = project_version.unwrap_or_default();
    let dir_name = if version.is_empty() {
        format!("{}-logs-{}", name, date_str)
    } else {
        format!("{}-logs-{}-{}", name, version, date_str)
    };
    // 产物放在 debug_exports/ 下而不是 debug/，避免下次导出把上次的产物扫进去。
    let exports_root = data_dir.join("debug_exports");
    let out_dir = exports_root.join(&dir_name);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("创建导出目录失败 [{}]: {}", out_dir.display(), e))?;

    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // ─── 1. 收集常规文件（log / config / 子目录下的 log/json） ───
    let mut regular_entries: Vec<ExportEntry> = Vec::new();

    let entries = std::fs::read_dir(&debug_dir).map_err(|e| format!("读取日志目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().map(|e| e != "log").unwrap_or(true) {
            continue;
        }
        let Some(archive_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        regular_entries.push(ExportEntry {
            source_path: path,
            archive_name,
        });
    }
    regular_entries.sort_by(|a, b| a.archive_name.cmp(&b.archive_name));

    let config_dir = data_dir.join("config");
    regular_entries.extend(collect_files_recursively(&config_dir, "config")?);
    regular_entries.extend(collect_debug_subdir_files(&debug_dir, &["log", "json"])?);

    // ─── 2. 收集图片（on_error + vision，按 mtime 新→旧） ───
    let on_error_images = collect_debug_images(&debug_dir.join("on_error"), "on_error");
    let vision_images = collect_debug_images(&debug_dir.join("vision"), "vision");

    // ─── 3. 合并入卷条目：先 regular，再 on_error，再 vision ───
    // 图片按 mtime 新→旧排在尾部，保证最近的崩溃图一定落在 part01.zip。
    let mut all_entries: Vec<ExportEntry> = Vec::new();
    all_entries.extend(regular_entries);
    all_entries.extend(on_error_images);
    all_entries.extend(vision_images);

    let total_entries = all_entries.len();
    if total_entries == 0 {
        return Err("没有可导出的日志文件".to_string());
    }

    // ─── 4. 分卷打包 ───
    // 卷数硬上界 = 总条目数（每文件独占一卷的退化情形）；据此选零填充宽度。
    let width = if total_entries >= 100 { 3 } else { 2 };

    let mut volume_idx: usize = 1;
    let mut iter = all_entries.into_iter().peekable();
    let mut total_files_written: usize = 0;
    let mut first_volume_path: Option<PathBuf> = None;

    while iter.peek().is_some() {
        let volume_path = out_dir.join(format!(
            "{}-part{:0width$}.zip",
            dir_name,
            volume_idx,
            width = width
        ));
        let file = File::create(&volume_path)
            .map_err(|e| format!("创建分卷文件失败 [{}]: {}", volume_path.display(), e))?;
        // 64 KB 缓冲：deflate 输出的 chunk 经常几十到几百 KB，默认 8 KB 太小。
        let (counting, counter) = CountingWriter::new(BufWriter::with_capacity(64 * 1024, file));
        let mut zip = ZipWriter::new(counting);
        let mut wrote_any = false;
        let mut volume_file_count: usize = 0;
        // 预留 finish() 时要写入的 EOCD + 累计的中央目录字节，避免卷写超。
        let mut central_dir_reserve: u64 = ZIP_EOCD_BYTES;

        while let Some(entry) = iter.peek() {
            let est_delta = estimate_entry_upper_bound(entry).unwrap_or(u64::MAX);
            let current_bytes = counter.load(Ordering::Relaxed);
            let entry_cd_bytes = ZIP_CENTRAL_DIR_FIXED_BYTES + entry.archive_name.len() as u64;
            let projected = current_bytes
                .saturating_add(est_delta)
                .saturating_add(central_dir_reserve)
                .saturating_add(entry_cd_bytes);
            // 单文件超过卷上限时，当前卷为空就让它独占一卷，保证不丢文件。
            if wrote_any && projected > MAX_VOLUME_BYTES {
                break;
            }
            let entry = iter.next().expect("peek 已确认存在");
            if add_file_to_zip(&mut zip, &entry.source_path, &entry.archive_name, options) {
                central_dir_reserve = central_dir_reserve.saturating_add(entry_cd_bytes);
                wrote_any = true;
                volume_file_count += 1;
                total_files_written += 1;
            }
        }

        zip.finish()
            .map_err(|e| format!("完成分卷压缩失败 [{}]: {}", volume_path.display(), e))?;

        if let Ok(metadata) = std::fs::metadata(&volume_path) {
            log::info!(
                "分卷 {} 完成：{} 个文件，{} bytes",
                volume_path.display(),
                volume_file_count,
                metadata.len()
            );
        }

        if first_volume_path.is_none() {
            first_volume_path = Some(volume_path);
        }
        volume_idx += 1;
    }

    log::info!(
        "日志导出完成：{} 个文件分为 {} 个分卷，输出目录 {}",
        total_files_written,
        volume_idx - 1,
        out_dir.display()
    );

    // 只保留最近 MAX_EXPORTS_TO_KEEP 次导出。清理失败仅 warn，不影响本次结果。
    prune_old_exports(&exports_root, &out_dir);

    // 返回 part01.zip 路径，让前端 revealItemInDir 选中第一个分卷.
    // total_entries == 0 已早返，所以循环至少跑过一次。
    let reveal_target = first_volume_path.expect("至少应有一个分卷写入成功");
    Ok(reveal_target.to_string_lossy().to_string())
}

/// 扫描 `exports_root` 下子目录，按目录名里的时间戳新→旧排序，
/// 删除超出 `MAX_EXPORTS_TO_KEEP` 的旧目录。`current_export` 始终保留。
///
/// 用目录名解时间戳而不是 mtime：Windows 上目录 mtime 不稳定，
/// 且备份/同步工具可能改写。
fn prune_old_exports(exports_root: &Path, current_export: &Path) {
    let rd = match std::fs::read_dir(exports_root) {
        Ok(rd) => rd,
        Err(e) => {
            log::warn!(
                "枚举导出目录失败 [{}]: {}，跳过旧导出清理",
                exports_root.display(),
                e
            );
            return;
        }
    };

    // 解不出时间戳的子目录直接跳过（既不删也不算名额）。
    let mut dirs: Vec<(PathBuf, String)> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| e.path() != current_export)
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_string_lossy().into_owned();
            let ts = parse_export_timestamp(&name)?;
            Some((path, ts))
        })
        .collect();

    // 本次产物始终保留，所以历史最多留 MAX_EXPORTS_TO_KEEP - 1 个
    let keep_others = MAX_EXPORTS_TO_KEEP - 1;
    if dirs.len() <= keep_others {
        return;
    }

    // 时间戳字符串的字典序就是时间序
    dirs.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in dirs.into_iter().skip(keep_others) {
        match std::fs::remove_dir_all(&path) {
            Ok(()) => log::info!("已清理旧导出: {}", path.display()),
            Err(e) => log::warn!("清理旧导出失败 [{}]: {}", path.display(), e),
        }
    }
}

/// 从导出目录名末尾解出 `YYYYMMDD-HHMMSS` 时间戳作为排序键。
fn parse_export_timestamp(dir_name: &str) -> Option<String> {
    const TS_LEN: usize = 15;
    if dir_name.len() < TS_LEN {
        return None;
    }
    let tail = &dir_name[dir_name.len() - TS_LEN..];
    let bytes = tail.as_bytes();
    let shape_ok = bytes[..8].iter().all(|b| b.is_ascii_digit())
        && bytes[8] == b'-'
        && bytes[9..].iter().all(|b| b.is_ascii_digit());
    if !shape_ok {
        return None;
    }
    Some(tail.to_string())
}
