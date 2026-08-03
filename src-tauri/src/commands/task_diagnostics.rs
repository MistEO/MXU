//! Task-scoped diagnostic attachment construction.
//!
//! The caller records file boundaries when a MaaFramework SavedTask starts. If that
//! task later fails, this module packages only bytes appended during the task (plus a
//! small prelude) and images newly written to `on_error/`. It deliberately excludes
//! configuration, `vision/`, crash dumps, and a standalone manifest.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{self, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Include a little context immediately before the task-start offset.
const LOG_PRELUDE_BYTES: u64 = 64 * 1024;
/// Bound local work before compression. Oversized evidence is reported to Sentry
/// without an attachment instead of being silently truncated.
const MAX_SELECTED_RAW_BYTES: u64 = 64 * 1024 * 1024;
/// The Rust Sentry SDK stores an attachment in a `Vec<u8>`, so keep the final
/// allocation bounded independently from the source-directory size.
const MAX_COMPRESSED_BYTES: usize = 10 * 1024 * 1024;
/// Filesystems may expose a slightly older mtime than the task-start wall clock.
const MTIME_TOLERANCE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub struct TaskEvidenceStart {
    root: PathBuf,
    started_at: SystemTime,
    log_lengths: BTreeMap<PathBuf, u64>,
    existing_images: BTreeSet<PathBuf>,
}

#[derive(Debug)]
pub struct TaskEvidenceSelection {
    logs: Vec<LogSlice>,
    images: Vec<ImageEntry>,
    selected_raw_bytes: u64,
    warnings: Vec<String>,
}

#[derive(Debug)]
struct LogSlice {
    source: File,
    source_path: PathBuf,
    archive_name: String,
    start: u64,
    end: u64,
}

#[derive(Debug)]
struct ImageEntry {
    source: File,
    source_path: PathBuf,
    archive_name: String,
    len: u64,
}

#[derive(Debug)]
pub struct TaskBundle {
    pub buffer: Vec<u8>,
    pub filename: String,
    pub log_count: usize,
    pub image_count: usize,
    pub selected_raw_bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub enum TaskBundleError {
    NoEvidence,
    TooLarge {
        selected_raw_bytes: u64,
        compressed_bytes: Option<usize>,
    },
    Io(String),
}

impl std::fmt::Display for TaskBundleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoEvidence => formatter.write_str("no task-scoped evidence was found"),
            Self::TooLarge {
                selected_raw_bytes,
                compressed_bytes,
            } => write!(
                formatter,
                "task evidence is too large (raw={selected_raw_bytes}, compressed={})",
                compressed_bytes
                    .map(|size| size.to_string())
                    .unwrap_or_else(|| "not-built".to_string())
            ),
            Self::Io(message) => formatter.write_str(message),
        }
    }
}

/// Snapshot task-relevant file boundaries. Discovery failures are intentionally
/// best-effort: the eventual Sentry error event must still be sent without a bundle.
pub fn capture_task_start(root: &Path) -> TaskEvidenceStart {
    let mut log_lengths = BTreeMap::new();
    let mut existing_images = BTreeSet::new();

    for path in discover_files(root) {
        let Some(relative) = safe_relative_path(root, &path) else {
            continue;
        };
        if is_on_error_image(relative) {
            existing_images.insert(relative.to_path_buf());
        } else if is_log_file(relative) {
            if let Ok(metadata) = path.metadata() {
                log_lengths.insert(relative.to_path_buf(), metadata.len());
            }
        }
    }

    TaskEvidenceStart {
        root: root.to_path_buf(),
        started_at: SystemTime::now(),
        log_lengths,
        existing_images,
    }
}

/// Freeze the end boundary as soon as the outer SavedTask reaches its terminal
/// callback. Compression may happen later, but a following task cannot expand the
/// selected ranges or add its screenshots to this attachment.
pub fn capture_task_end(
    start: TaskEvidenceStart,
) -> Result<TaskEvidenceSelection, TaskBundleError> {
    let (logs, images, warnings) = select_entries(&start);
    if logs.is_empty() && images.is_empty() {
        return Err(TaskBundleError::NoEvidence);
    }

    let selected_raw_bytes = logs
        .iter()
        .map(|entry| entry.end.saturating_sub(entry.start))
        .chain(images.iter().map(|entry| entry.len))
        .fold(0u64, u64::saturating_add);
    if selected_raw_bytes > MAX_SELECTED_RAW_BYTES {
        return Err(TaskBundleError::TooLarge {
            selected_raw_bytes,
            compressed_bytes: None,
        });
    }

    Ok(TaskEvidenceSelection {
        logs,
        images,
        selected_raw_bytes,
        warnings,
    })
}

/// Build one ZIP attachment from an already-frozen task selection.
pub fn build_task_bundle(
    mut selection: TaskEvidenceSelection,
    run_id: &str,
    maa_task_id: i64,
) -> Result<TaskBundle, TaskBundleError> {
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in &mut selection.logs {
        write_log_slice(&mut archive, entry, options)?;
    }
    for entry in &mut selection.images {
        write_image(&mut archive, entry, options)?;
    }

    let buffer = archive
        .finish()
        .map_err(|error| TaskBundleError::Io(format!("finish diagnostic ZIP: {error}")))?
        .into_inner();
    if buffer.len() > MAX_COMPRESSED_BYTES {
        return Err(TaskBundleError::TooLarge {
            selected_raw_bytes: selection.selected_raw_bytes,
            compressed_bytes: Some(buffer.len()),
        });
    }

    Ok(TaskBundle {
        buffer,
        filename: format!("mxu-task-failure-{run_id}-{maa_task_id}.zip"),
        log_count: selection.logs.len(),
        image_count: selection.images.len(),
        selected_raw_bytes: selection.selected_raw_bytes,
        warnings: selection.warnings,
    })
}

fn select_entries(start: &TaskEvidenceStart) -> (Vec<LogSlice>, Vec<ImageEntry>, Vec<String>) {
    let mut logs = Vec::new();
    let mut images = Vec::new();
    let mut warnings = Vec::new();

    for path in discover_files(&start.root) {
        let Some(relative) = safe_relative_path(&start.root, &path) else {
            continue;
        };
        let Some(archive_name) = normalize_archive_path(relative) else {
            continue;
        };
        // Open the selected generation at the terminal callback. The background
        // compressor must never resolve this path again because rotation may make
        // it point at a different file.
        let Ok(source) = File::open(&path) else {
            continue;
        };
        let Ok(metadata) = source.metadata() else {
            continue;
        };

        if is_on_error_image(relative) {
            if start.existing_images.contains(relative) || !modified_during_task(&metadata, start) {
                continue;
            }
            images.push(ImageEntry {
                source,
                source_path: path,
                archive_name,
                len: metadata.len(),
            });
            continue;
        }

        if !is_log_file(relative) {
            continue;
        }

        let end = metadata.len();
        let Some(previous_len) = start.log_lengths.get(relative).copied() else {
            if !modified_during_task(&metadata, start) || end == 0 {
                continue;
            }
            warnings.push(format!("new_log_included_whole:{archive_name}"));
            logs.push(LogSlice {
                source,
                source_path: path,
                archive_name,
                start: 0,
                end,
            });
            continue;
        };

        if end > previous_len {
            logs.push(LogSlice {
                source,
                source_path: path,
                archive_name,
                start: previous_len.saturating_sub(LOG_PRELUDE_BYTES),
                end,
            });
        } else if end < previous_len && modified_during_task(&metadata, start) && end > 0 {
            warnings.push(format!("rotated_log_included_whole:{archive_name}"));
            logs.push(LogSlice {
                source,
                source_path: path,
                archive_name,
                start: 0,
                end,
            });
        }
    }

    logs.sort_by(|left, right| left.archive_name.cmp(&right.archive_name));
    images.sort_by(|left, right| left.archive_name.cmp(&right.archive_name));
    (logs, images, warnings)
}

fn write_log_slice<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    entry: &mut LogSlice,
    options: SimpleFileOptions,
) -> Result<(), TaskBundleError> {
    entry
        .source
        .seek(SeekFrom::Start(entry.start))
        .map_err(|error| {
            TaskBundleError::Io(format!(
                "seek log [{}]: {error}",
                entry.source_path.display()
            ))
        })?;
    archive
        .start_file(&entry.archive_name, options)
        .map_err(|error| TaskBundleError::Io(format!("start ZIP entry: {error}")))?;
    let mut selected = (&mut entry.source).take(entry.end.saturating_sub(entry.start));
    io::copy(&mut selected, archive)
        .map_err(|error| TaskBundleError::Io(format!("write log ZIP entry: {error}")))?;
    Ok(())
}

fn write_image<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    entry: &mut ImageEntry,
    options: SimpleFileOptions,
) -> Result<(), TaskBundleError> {
    archive
        .start_file(&entry.archive_name, options)
        .map_err(|error| TaskBundleError::Io(format!("start ZIP entry: {error}")))?;
    let mut selected = (&mut entry.source).take(entry.len);
    io::copy(&mut selected, archive).map_err(|error| {
        TaskBundleError::Io(format!(
            "write attachment [{}]: {error}",
            entry.source_path.display()
        ))
    })?;
    Ok(())
}

fn discover_files(root: &Path) -> Vec<PathBuf> {
    if !root.is_dir() {
        return Vec::new();
    }

    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                let relative = path.strip_prefix(root).unwrap_or(&path);
                if first_component_is(relative, "vision") {
                    continue;
                }
                pending.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    files
}

fn safe_relative_path<'a>(root: &Path, path: &'a Path) -> Option<&'a Path> {
    let relative = path.strip_prefix(root).ok()?;
    if relative
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        Some(relative)
    } else {
        None
    }
}

fn normalize_archive_path(path: &Path) -> Option<String> {
    let components: Option<Vec<String>> = path
        .components()
        .map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    let value = components?.join("/");
    (!value.is_empty()).then_some(value)
}

fn first_component_is(path: &Path, expected: &str) -> bool {
    path.components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn is_log_file(relative: &Path) -> bool {
    if first_component_is(relative, "on_error") || first_component_is(relative, "vision") {
        return false;
    }
    relative
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|name| name.ends_with(".log") || name.contains(".log."))
}

fn is_on_error_image(relative: &Path) -> bool {
    if !first_component_is(relative, "on_error") {
        return false;
    }
    relative
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|extension| matches!(extension.as_str(), "png" | "jpg" | "jpeg"))
}

fn modified_during_task(metadata: &std::fs::Metadata, start: &TaskEvidenceStart) -> bool {
    metadata.modified().is_ok_and(|modified| {
        modified
            .checked_add(MTIME_TOLERANCE)
            .is_some_and(|adjusted| adjusted >= start.started_at)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn test_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "mxu-task-diagnostics-{}",
            sentry::types::random_uuid()
        ));
        std::fs::create_dir_all(root.join("on_error")).expect("create test directory");
        root
    }

    fn zip_entries(buffer: Vec<u8>) -> BTreeMap<String, Vec<u8>> {
        let mut archive = zip::ZipArchive::new(Cursor::new(buffer)).expect("open ZIP");
        let mut entries = BTreeMap::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("read ZIP entry");
            let mut body = Vec::new();
            entry.read_to_end(&mut body).expect("read ZIP body");
            entries.insert(entry.name().to_string(), body);
        }
        entries
    }

    #[test]
    fn bundles_only_appended_logs_and_new_on_error_images() {
        let root = test_root();
        std::fs::write(root.join("maafw.log"), b"old-log\n").expect("write old log");
        std::fs::write(root.join("on_error/old.png"), b"old-image").expect("write old image");
        std::fs::create_dir_all(root.join("vision")).expect("create vision");
        std::fs::write(root.join("vision/ignored.png"), b"vision").expect("write vision");

        let start = capture_task_start(&root);
        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(root.join("maafw.log"))
            .expect("open log");
        log.write_all(b"task-log\n").expect("append task log");
        std::fs::write(root.join("on_error/new.png"), b"new-image").expect("write image");

        let selection = capture_task_end(start).expect("capture task end");
        log.write_all(b"next-task-log\n")
            .expect("append next task log");
        std::fs::write(root.join("on_error/next.png"), b"next-image").expect("write next image");
        let bundle = build_task_bundle(selection, "run", 42).expect("build bundle");
        let entries = zip_entries(bundle.buffer);
        assert_eq!(bundle.log_count, 1);
        assert_eq!(bundle.image_count, 1);
        assert!(entries["maafw.log"].ends_with(b"task-log\n"));
        assert_eq!(entries["on_error/new.png"], b"new-image");
        assert!(!entries["maafw.log"]
            .windows(b"next-task-log".len())
            .any(|window| window == b"next-task-log"));
        assert!(!entries.contains_key("on_error/old.png"));
        assert!(!entries.contains_key("on_error/next.png"));
        assert!(!entries.contains_key("vision/ignored.png"));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn includes_nested_agent_logs_but_not_config_or_dump_files() {
        let root = test_root();
        std::fs::create_dir_all(root.join("cpp-algo/debug")).expect("create nested directory");
        std::fs::write(root.join("cpp-algo/debug/maafw.log"), b"before\n")
            .expect("write nested log");
        std::fs::write(root.join("config.json"), b"config").expect("write config");
        std::fs::write(root.join("process.dmp"), b"dump").expect("write dump");

        let start = capture_task_start(&root);
        let mut nested = std::fs::OpenOptions::new()
            .append(true)
            .open(root.join("cpp-algo/debug/maafw.log"))
            .expect("open nested log");
        nested.write_all(b"failure\n").expect("append nested log");

        let selection = capture_task_end(start).expect("capture task end");
        let bundle = build_task_bundle(selection, "run", 7).expect("build bundle");
        let entries = zip_entries(bundle.buffer);
        assert!(entries.contains_key("cpp-algo/debug/maafw.log"));
        assert!(!entries.contains_key("config.json"));
        assert!(!entries.contains_key("process.dmp"));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn keeps_selected_file_generations_when_paths_are_replaced() {
        let root = test_root();
        let log_path = root.join("maafw.log");
        let image_path = root.join("on_error/failure.png");
        std::fs::write(&log_path, b"before\n").expect("write initial log");

        let start = capture_task_start(&root);
        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(&log_path)
            .expect("open log");
        log.write_all(b"selected-failure\n")
            .expect("append failure");
        drop(log);
        std::fs::write(&image_path, b"selected-image").expect("write selected image");

        let selection = capture_task_end(start).expect("capture task end");
        std::fs::rename(&log_path, root.join("maafw.log.1")).expect("rotate selected log");
        std::fs::write(&log_path, b"replacement-generation\n").expect("write replacement log");
        std::fs::rename(&image_path, root.join("on_error/failure-old.png"))
            .expect("rotate selected image");
        std::fs::write(&image_path, b"replacement-image").expect("write replacement image");

        let bundle = build_task_bundle(selection, "run", 9).expect("build bundle");
        let entries = zip_entries(bundle.buffer);
        assert!(entries["maafw.log"]
            .windows(b"selected-failure".len())
            .any(|window| window == b"selected-failure"));
        assert!(!entries["maafw.log"]
            .windows(b"replacement-generation".len())
            .any(|window| window == b"replacement-generation"));
        assert_eq!(entries["on_error/failure.png"], b"selected-image");

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }
}
