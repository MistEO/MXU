//! Task-scoped diagnostic evidence construction.
//!
//! The caller records file boundaries when a MaaFramework SavedTask starts. If that
//! task later fails, this module reads bounded log tails for Sentry Logs and packages
//! only images newly written to `on_error/` as an attachment. It deliberately excludes
//! configuration, `vision/`, crash dumps, and a standalone manifest.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Include a little context immediately before the task-start offset.
const LOG_PRELUDE_BYTES: u64 = 64 * 1024;
/// Bound the selected screenshots before building an attachment. PNG and JPEG data
/// is already compressed, so the ZIP stores entries verbatim and stays near this cap.
const MAX_IMAGE_RAW_BYTES: u64 = 5 * 1024 * 1024;
/// The Rust Sentry SDK stores an attachment in a `Vec<u8>`, so also bound the final
/// ZIP allocation. ZIP metadata can push a raw selection just below the cap over it.
const MAX_IMAGE_BUNDLE_BYTES: usize = 5 * 1024 * 1024;
/// Structured diagnostic logs have their own bounded budget and are independent
/// from screenshot attachment sampling.
const MAX_LOG_RAW_BYTES: u64 = 1024 * 1024;
const MAX_LOG_FILE_BYTES: u64 = 512 * 1024;
const MAX_LOG_FILES: usize = 128;
const MAX_IMAGE_FILES: usize = 128;
/// Bound directory walking independently from file sizes. Limit hits are carried
/// into the Sentry event as diagnostic warnings.
const MAX_DISCOVERY_ENTRIES: usize = 8 * 1024;
const MAX_DISCOVERY_DEPTH: usize = 16;
/// Filesystems may expose a slightly older mtime than the task-start wall clock.
const MTIME_TOLERANCE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub struct TaskEvidenceStart {
    root: PathBuf,
    started_at: SystemTime,
    log_lengths: BTreeMap<PathBuf, u64>,
    existing_images: BTreeMap<PathBuf, FileStamp>,
    warnings: Vec<String>,
}

#[derive(Debug)]
pub struct TaskEvidenceSelection {
    logs: Vec<LogSlice>,
    images: Vec<ImageEntry>,
    warnings: Vec<String>,
    image_root: PathBuf,
    image_started_at: SystemTime,
    existing_images: BTreeMap<PathBuf, FileStamp>,
}

/// A candidate screenshot refresh captured during the bounded post-failure settle
/// window. The caller must verify that the task evidence epoch is still current
/// before applying it.
#[derive(Debug)]
pub struct TaskImageRefresh {
    images: Vec<ImageEntry>,
    warnings: Vec<String>,
}

#[derive(Debug)]
struct LogSlice {
    source: File,
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
    stamp: FileStamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
}

#[derive(Debug)]
pub struct DiagnosticLog {
    pub source: String,
    pub kind: &'static str,
    pub content: String,
    pub raw_bytes: u64,
}

#[derive(Debug, Default)]
pub struct DiagnosticLogs {
    pub entries: Vec<DiagnosticLog>,
    pub selected_raw_bytes: u64,
    pub truncated: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub struct ImageBundle {
    pub buffer: Vec<u8>,
    pub filename: String,
    pub image_count: usize,
    pub selected_raw_bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub enum ImageBundleError {
    NoEvidence,
    TooLarge {
        selected_raw_bytes: u64,
        bundle_bytes: Option<usize>,
    },
    Io(String),
}

impl std::fmt::Display for ImageBundleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoEvidence => formatter.write_str("no task-scoped evidence was found"),
            Self::TooLarge {
                selected_raw_bytes,
                bundle_bytes,
            } => write!(
                formatter,
                "task screenshot evidence is too large (raw={selected_raw_bytes}, bundle={})",
                bundle_bytes
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
    // Record the wall-clock boundary before discovery. A fast failure may write an
    // on_error image while the directory is being walked; it must not be treated as
    // predating the task merely because discovery took time.
    let started_at = SystemTime::now();
    let mut log_lengths = BTreeMap::new();
    let mut existing_images = BTreeMap::new();
    let (files, warnings) = discover_files(root);

    for path in files {
        let Some(relative) = safe_relative_path(root, &path) else {
            continue;
        };
        if is_on_error_image(relative) {
            if let Ok(metadata) = path.metadata() {
                let stamp = file_stamp(&metadata);
                // A screenshot created while discovery is running belongs to this
                // task, not the pre-task baseline. Unknown mtimes stay in the
                // baseline because ownership cannot be proven safely.
                if stamp.modified.is_none_or(|modified| modified < started_at) {
                    existing_images.insert(relative.to_path_buf(), stamp);
                }
            }
        } else if is_log_file(relative) {
            if let Ok(metadata) = path.metadata() {
                log_lengths.insert(relative.to_path_buf(), metadata.len());
            }
        }
    }

    TaskEvidenceStart {
        root: root.to_path_buf(),
        started_at,
        log_lengths,
        existing_images,
        warnings,
    }
}

/// Freeze log boundaries and already-visible screenshots as soon as the outer
/// SavedTask reaches its terminal callback. A bounded, epoch-checked screenshot
/// refresh may replace or extend the image selection afterward.
pub fn capture_task_end(start: TaskEvidenceStart) -> TaskEvidenceSelection {
    let (logs, images, warnings) = select_entries(&start);
    TaskEvidenceSelection {
        logs,
        images,
        warnings,
        image_root: start.root,
        image_started_at: start.started_at,
        existing_images: start.existing_images,
    }
}

/// Capture screenshots visible during the bounded post-failure settle window.
///
/// This function only opens stable file generations and returns them as an opaque
/// candidate. The caller owns the task epoch check and must discard stale candidates.
pub fn capture_task_image_refresh(selection: &TaskEvidenceSelection) -> TaskImageRefresh {
    let (images, warnings) = select_images(
        &selection.image_root,
        selection.image_started_at,
        &selection.existing_images,
    );
    TaskImageRefresh { images, warnings }
}

/// Merge a refresh only after its task epoch has been revalidated. Existing stable
/// handles are retained when the observed generation did not change; growing or
/// replaced files are upgraded to the newest safely opened generation.
pub fn apply_task_image_refresh(selection: &mut TaskEvidenceSelection, refresh: TaskImageRefresh) {
    for image in refresh.images {
        if let Some(index) = selection
            .images
            .iter()
            .position(|existing| existing.archive_name == image.archive_name)
        {
            if selection.images[index].stamp != image.stamp {
                selection.images[index] = image;
            }
        } else {
            selection.images.push(image);
        }
    }
    selection
        .images
        .sort_by(|left, right| left.archive_name.cmp(&right.archive_name));
    selection.warnings.extend(refresh.warnings);
    selection.warnings.sort();
    selection.warnings.dedup();
}

/// Read bounded log tails from an already-frozen task selection.
///
/// Each file contributes at most 512 KiB and all files share a 1 MiB budget. The
/// tail of every selected range is retained because failure details are normally
/// emitted last. Limit hits are exposed through `truncated`.
pub fn build_diagnostic_logs(selection: &mut TaskEvidenceSelection) -> DiagnosticLogs {
    selection.logs.sort_by(|left, right| {
        log_priority(&left.archive_name)
            .cmp(&log_priority(&right.archive_name))
            .then_with(|| left.archive_name.cmp(&right.archive_name))
    });

    let mut result = DiagnosticLogs {
        warnings: std::mem::take(&mut selection.warnings),
        ..Default::default()
    };
    for entry in &mut selection.logs {
        let remaining_budget = MAX_LOG_RAW_BYTES.saturating_sub(result.selected_raw_bytes);
        if remaining_budget == 0 {
            result.truncated = true;
            break;
        }

        let selected_len = entry.end.saturating_sub(entry.start);
        let read_len = selected_len.min(MAX_LOG_FILE_BYTES).min(remaining_budget);
        if read_len == 0 {
            continue;
        }
        let read_start = entry.end.saturating_sub(read_len);
        match read_log_slice(entry, read_start, read_len) {
            Ok(bytes) if !bytes.is_empty() => {
                let content = String::from_utf8_lossy(&bytes)
                    .trim_matches('\0')
                    .to_string();
                if content.trim().is_empty() {
                    continue;
                }
                result.selected_raw_bytes =
                    result.selected_raw_bytes.saturating_add(bytes.len() as u64);
                result.truncated |= read_len < selected_len;
                result.entries.push(DiagnosticLog {
                    source: entry.archive_name.clone(),
                    kind: log_kind(&entry.archive_name),
                    content,
                    raw_bytes: bytes.len() as u64,
                });
            }
            Ok(_) => {}
            Err(error) => result
                .warnings
                .push(format!("read_log_failed:{}:{error}", entry.archive_name)),
        }
    }
    result
}

/// Build a screenshots-only ZIP attachment from an already-frozen task selection.
pub fn build_image_bundle(
    mut selection: TaskEvidenceSelection,
    run_id: &str,
    maa_task_id: i64,
) -> Result<ImageBundle, ImageBundleError> {
    if selection.images.is_empty() {
        return Err(ImageBundleError::NoEvidence);
    }
    let selected_raw_bytes = selection
        .images
        .iter()
        .map(|entry| entry.len)
        .fold(0u64, u64::saturating_add);
    if selected_raw_bytes > MAX_IMAGE_RAW_BYTES {
        return Err(ImageBundleError::TooLarge {
            selected_raw_bytes,
            bundle_bytes: None,
        });
    }

    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    // PNG/JPEG payloads are already compressed. Deflating them again costs CPU and
    // commonly makes screenshots slightly larger, while Sentry bills final bytes.
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    for entry in &mut selection.images {
        write_image(&mut archive, entry, options)?;
    }

    let buffer = archive
        .finish()
        .map_err(|error| ImageBundleError::Io(format!("finish screenshot ZIP: {error}")))?
        .into_inner();
    if buffer.len() > MAX_IMAGE_BUNDLE_BYTES {
        return Err(ImageBundleError::TooLarge {
            selected_raw_bytes,
            bundle_bytes: Some(buffer.len()),
        });
    }

    Ok(ImageBundle {
        buffer,
        filename: format!("mxu-task-failure-{run_id}-{maa_task_id}-screenshots.zip"),
        image_count: selection.images.len(),
        selected_raw_bytes,
        warnings: Vec::new(),
    })
}

fn select_entries(start: &TaskEvidenceStart) -> (Vec<LogSlice>, Vec<ImageEntry>, Vec<String>) {
    let mut logs = Vec::new();
    let mut images = Vec::new();
    let (files, discovery_warnings) = discover_files(&start.root);
    let mut warnings = start.warnings.clone();
    warnings.extend(discovery_warnings);

    for path in files {
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
            if images.len() >= MAX_IMAGE_FILES {
                push_warning(
                    &mut warnings,
                    &format!("image_file_limit_reached:{MAX_IMAGE_FILES}"),
                );
                continue;
            }
            if !should_include_image(
                relative,
                &metadata,
                start.started_at,
                &start.existing_images,
            ) {
                continue;
            }
            let stamp = file_stamp(&metadata);
            images.push(ImageEntry {
                source,
                source_path: path,
                archive_name,
                len: stamp.len,
                stamp,
            });
            continue;
        }

        if !is_log_file(relative) {
            continue;
        }
        if logs.len() >= MAX_LOG_FILES {
            push_warning(
                &mut warnings,
                &format!("log_file_limit_reached:{MAX_LOG_FILES}"),
            );
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
                archive_name,
                start: 0,
                end,
            });
            continue;
        };

        if end > previous_len {
            logs.push(LogSlice {
                source,
                archive_name,
                start: previous_len.saturating_sub(LOG_PRELUDE_BYTES),
                end,
            });
        } else if end == previous_len && end > 0 && modified_during_task(&metadata, start) {
            // The task may have emitted its complete failure log while the start
            // snapshot was still walking the directory. Preserve a bounded tail
            // instead of interpreting an unchanged post-snapshot length as empty.
            warnings.push(format!("log_changed_during_start_snapshot:{archive_name}"));
            logs.push(LogSlice {
                source,
                archive_name,
                start: end.saturating_sub(LOG_PRELUDE_BYTES),
                end,
            });
        } else if end < previous_len && modified_during_task(&metadata, start) && end > 0 {
            warnings.push(format!("rotated_log_included_whole:{archive_name}"));
            logs.push(LogSlice {
                source,
                archive_name,
                start: 0,
                end,
            });
        }
    }

    logs.sort_by(|left, right| left.archive_name.cmp(&right.archive_name));
    images.sort_by(|left, right| left.archive_name.cmp(&right.archive_name));
    warnings.sort();
    warnings.dedup();
    (logs, images, warnings)
}

fn select_images(
    root: &Path,
    started_at: SystemTime,
    existing_images: &BTreeMap<PathBuf, FileStamp>,
) -> (Vec<ImageEntry>, Vec<String>) {
    let (files, mut warnings) = discover_files(root);
    let mut images = Vec::new();
    for path in files {
        let Some(relative) = safe_relative_path(root, &path) else {
            continue;
        };
        if !is_on_error_image(relative) {
            continue;
        }
        let Some(archive_name) = normalize_archive_path(relative) else {
            continue;
        };
        let source = match File::open(&path) {
            Ok(source) => source,
            Err(error) => {
                warnings.push(format!("open_image_failed:{archive_name}:{error}"));
                continue;
            }
        };
        let metadata = match source.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!("read_image_metadata_failed:{archive_name}:{error}"));
                continue;
            }
        };
        if !should_include_image(relative, &metadata, started_at, existing_images) {
            continue;
        }
        if images.len() >= MAX_IMAGE_FILES {
            push_warning(
                &mut warnings,
                &format!("image_file_limit_reached:{MAX_IMAGE_FILES}"),
            );
            break;
        }
        let stamp = file_stamp(&metadata);
        images.push(ImageEntry {
            source,
            source_path: path,
            archive_name,
            len: stamp.len,
            stamp,
        });
    }
    images.sort_by(|left, right| left.archive_name.cmp(&right.archive_name));
    warnings.sort();
    warnings.dedup();
    (images, warnings)
}

fn should_include_image(
    relative: &Path,
    metadata: &std::fs::Metadata,
    started_at: SystemTime,
    existing_images: &BTreeMap<PathBuf, FileStamp>,
) -> bool {
    if !modified_since(metadata, started_at) {
        return false;
    }
    existing_images
        .get(relative)
        .is_none_or(|previous| *previous != file_stamp(metadata))
}

fn file_stamp(metadata: &std::fs::Metadata) -> FileStamp {
    FileStamp {
        len: metadata.len(),
        modified: metadata.modified().ok(),
    }
}

fn read_log_slice(entry: &mut LogSlice, start: u64, len: u64) -> Result<Vec<u8>, io::Error> {
    entry.source.seek(SeekFrom::Start(start))?;
    let mut selected = (&mut entry.source).take(len);
    let mut bytes = Vec::with_capacity(len.min(usize::MAX as u64) as usize);
    selected.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn write_image<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    entry: &mut ImageEntry,
    options: SimpleFileOptions,
) -> Result<(), ImageBundleError> {
    archive
        .start_file(&entry.archive_name, options)
        .map_err(|error| ImageBundleError::Io(format!("start ZIP entry: {error}")))?;
    let mut selected = (&mut entry.source).take(entry.len);
    io::copy(&mut selected, archive).map_err(|error| {
        ImageBundleError::Io(format!(
            "write attachment [{}]: {error}",
            entry.source_path.display()
        ))
    })?;
    Ok(())
}

fn discover_files(root: &Path) -> (Vec<PathBuf>, Vec<String>) {
    if !root.is_dir() {
        return (Vec::new(), Vec::new());
    }

    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut visited_entries = 0usize;
    'walk: while let Some((directory, depth)) = pending.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                push_warning(&mut warnings, "discovery_read_directory_failed");
                continue;
            }
        };
        for entry in entries {
            if visited_entries >= MAX_DISCOVERY_ENTRIES {
                push_warning(
                    &mut warnings,
                    &format!("discovery_entry_limit_reached:{MAX_DISCOVERY_ENTRIES}"),
                );
                break 'walk;
            }
            visited_entries += 1;

            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    push_warning(&mut warnings, "discovery_read_entry_failed");
                    continue;
                }
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => {
                    push_warning(&mut warnings, "discovery_file_type_failed");
                    continue;
                }
            };
            if file_type.is_symlink() {
                push_warning(&mut warnings, "discovery_symlink_skipped");
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                let relative = path.strip_prefix(root).unwrap_or(&path);
                if first_component_is(relative, "vision") {
                    continue;
                }
                if depth >= MAX_DISCOVERY_DEPTH {
                    push_warning(
                        &mut warnings,
                        &format!("discovery_depth_limit_reached:{MAX_DISCOVERY_DEPTH}"),
                    );
                    continue;
                }
                pending.push((path, depth + 1));
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    (files, warnings)
}

fn push_warning(warnings: &mut Vec<String>, warning: &str) {
    if !warnings.iter().any(|existing| existing == warning) {
        warnings.push(warning.to_string());
    }
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

fn log_priority(path: &str) -> u8 {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if file_name.starts_with("maafw.log") {
        0
    } else if file_name.starts_with("maa.log") {
        1
    } else if file_name.starts_with("mxu") || file_name.starts_with("log-") {
        2
    } else {
        3
    }
}

fn log_kind(path: &str) -> &'static str {
    match log_priority(path) {
        0 => "maafw",
        1 => "maa",
        2 => "mxu",
        _ => "other",
    }
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
    modified_since(metadata, start.started_at)
}

fn modified_since(metadata: &std::fs::Metadata, started_at: SystemTime) -> bool {
    metadata.modified().is_ok_and(|modified| {
        modified
            .checked_add(MTIME_TOLERANCE)
            .is_some_and(|adjusted| adjusted >= started_at)
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

    fn zip_compression_methods(buffer: &[u8]) -> Vec<zip::CompressionMethod> {
        let mut archive = zip::ZipArchive::new(Cursor::new(buffer)).expect("open ZIP");
        (0..archive.len())
            .map(|index| {
                archive
                    .by_index(index)
                    .expect("read ZIP entry")
                    .compression()
            })
            .collect()
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

        let mut selection = capture_task_end(start);
        log.write_all(b"next-task-log\n")
            .expect("append next task log");
        std::fs::write(root.join("on_error/next.png"), b"next-image").expect("write next image");
        let logs = build_diagnostic_logs(&mut selection);
        let bundle = build_image_bundle(selection, "run", 42).expect("build image bundle");
        let compression_methods = zip_compression_methods(&bundle.buffer);
        assert!(bundle.buffer.len() <= MAX_IMAGE_BUNDLE_BYTES);
        let entries = zip_entries(bundle.buffer);
        assert_eq!(logs.entries.len(), 1);
        assert_eq!(bundle.image_count, 1);
        assert!(logs.entries[0].content.ends_with("task-log\n"));
        assert_eq!(entries["on_error/new.png"], b"new-image");
        assert_eq!(compression_methods, vec![zip::CompressionMethod::Stored]);
        assert!(!logs.entries[0].content.contains("next-task-log"));
        assert!(!entries.contains_key("maafw.log"));
        assert!(!entries.contains_key("on_error/old.png"));
        assert!(!entries.contains_key("on_error/next.png"));
        assert!(!entries.contains_key("vision/ignored.png"));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn includes_an_existing_screenshot_path_when_its_generation_changes() {
        let root = test_root();
        let image_path = root.join("on_error/failure.png");
        std::fs::write(&image_path, b"old").expect("write old image");

        let start = capture_task_start(&root);
        std::fs::write(&image_path, b"new-image-generation").expect("overwrite image");

        let selection = capture_task_end(start);
        let bundle = build_image_bundle(selection, "run", 43).expect("build image bundle");
        let entries = zip_entries(bundle.buffer);
        assert_eq!(entries["on_error/failure.png"], b"new-image-generation");

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn late_screenshot_refresh_can_be_applied_after_an_empty_terminal_snapshot() {
        let root = test_root();
        let start = capture_task_start(&root);
        let mut selection = capture_task_end(start);

        std::fs::write(root.join("on_error/late.png"), b"late-image").expect("write late image");
        let refresh = capture_task_image_refresh(&selection);
        apply_task_image_refresh(&mut selection, refresh);

        let bundle = build_image_bundle(selection, "run", 44).expect("build image bundle");
        let entries = zip_entries(bundle.buffer);
        assert_eq!(entries["on_error/late.png"], b"late-image");

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

        let mut selection = capture_task_end(start);
        let logs = build_diagnostic_logs(&mut selection);
        assert_eq!(logs.entries.len(), 1);
        assert_eq!(logs.entries[0].source, "cpp-algo/debug/maafw.log");
        assert!(logs.entries[0].content.contains("failure"));
        assert!(matches!(
            build_image_bundle(selection, "run", 7),
            Err(ImageBundleError::NoEvidence)
        ));

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

        let mut selection = capture_task_end(start);
        std::fs::rename(&log_path, root.join("maafw.log.1")).expect("rotate selected log");
        std::fs::write(&log_path, b"replacement-generation\n").expect("write replacement log");
        std::fs::rename(&image_path, root.join("on_error/failure-old.png"))
            .expect("rotate selected image");
        std::fs::write(&image_path, b"replacement-image").expect("write replacement image");

        let logs = build_diagnostic_logs(&mut selection);
        let bundle = build_image_bundle(selection, "run", 9).expect("build image bundle");
        let entries = zip_entries(bundle.buffer);
        assert!(logs.entries[0].content.contains("selected-failure"));
        assert!(!logs.entries[0].content.contains("replacement-generation"));
        assert!(!entries.contains_key("maafw.log"));
        assert_eq!(entries["on_error/failure.png"], b"selected-image");

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn bounds_structured_logs_per_file_and_in_total() {
        let root = test_root();
        let first = root.join("maafw.log");
        let second = root.join("agent.log");
        std::fs::write(&first, b"before\n").expect("write first log");
        std::fs::write(&second, b"before\n").expect("write second log");

        let start = capture_task_start(&root);
        for path in [&first, &second] {
            let mut log = std::fs::OpenOptions::new()
                .append(true)
                .open(path)
                .expect("open log");
            log.write_all(&vec![b'x'; 700 * 1024])
                .expect("append oversized log");
        }

        let mut selection = capture_task_end(start);
        let logs = build_diagnostic_logs(&mut selection);
        assert_eq!(logs.entries.len(), 2);
        assert_eq!(logs.selected_raw_bytes, MAX_LOG_RAW_BYTES);
        assert!(logs
            .entries
            .iter()
            .all(|entry| entry.raw_bytes <= MAX_LOG_FILE_BYTES));
        assert!(logs.truncated);

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn retains_log_tail_written_during_the_start_snapshot() {
        let root = test_root();
        let log_path = root.join("maafw.log");
        std::fs::write(&log_path, b"failure-before-snapshot-finished\n")
            .expect("write early failure log");
        let mut start = capture_task_start(&root);
        // Model a snapshot whose wall-clock boundary preceded the write while its
        // recorded file length already included it.
        start.started_at = SystemTime::UNIX_EPOCH;

        let mut selection = capture_task_end(start);
        let logs = build_diagnostic_logs(&mut selection);
        assert_eq!(logs.entries.len(), 1);
        assert!(logs.entries[0]
            .content
            .contains("failure-before-snapshot-finished"));
        assert!(logs
            .warnings
            .iter()
            .any(|warning| warning.starts_with("log_changed_during_start_snapshot:")));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn rejects_oversized_screenshot_sets_before_bundling() {
        let root = test_root();
        let start = capture_task_start(&root);
        let image_path = root.join("on_error/oversized.png");
        let image = File::create(&image_path).expect("create oversized image");
        image
            .set_len(MAX_IMAGE_RAW_BYTES + 1)
            .expect("extend oversized image");

        let mut selection = capture_task_end(start);
        let logs = build_diagnostic_logs(&mut selection);
        assert!(logs.entries.is_empty());
        assert!(matches!(
            build_image_bundle(selection, "run", 11),
            Err(ImageBundleError::TooLarge {
                selected_raw_bytes,
                bundle_bytes: None,
            }) if selected_raw_bytes == MAX_IMAGE_RAW_BYTES + 1
        ));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn rejects_zip_metadata_that_pushes_a_bundle_over_the_hard_limit() {
        let root = test_root();
        let start = capture_task_start(&root);
        let image_path = root.join("on_error/at-limit.png");
        let image = File::create(&image_path).expect("create at-limit image");
        image
            .set_len(MAX_IMAGE_RAW_BYTES)
            .expect("extend at-limit image");

        let selection = capture_task_end(start);
        assert!(matches!(
            build_image_bundle(selection, "run", 12),
            Err(ImageBundleError::TooLarge {
                selected_raw_bytes,
                bundle_bytes: Some(bundle_bytes),
            }) if selected_raw_bytes == MAX_IMAGE_RAW_BYTES
                && bundle_bytes > MAX_IMAGE_BUNDLE_BYTES
        ));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn reports_directory_depth_limit_as_diagnostic_warning() {
        let root = test_root();
        let mut directory = root.clone();
        for index in 0..=MAX_DISCOVERY_DEPTH {
            directory = directory.join(format!("level-{index}"));
            std::fs::create_dir(&directory).expect("create nested directory");
        }

        let start = capture_task_start(&root);
        let mut selection = capture_task_end(start);
        let logs = build_diagnostic_logs(&mut selection);
        assert!(logs.entries.is_empty());
        assert!(logs.warnings.iter().any(|warning| {
            warning == &format!("discovery_depth_limit_reached:{MAX_DISCOVERY_DEPTH}")
        }));

        std::fs::remove_dir_all(&root).expect("remove test directory");
    }
}
