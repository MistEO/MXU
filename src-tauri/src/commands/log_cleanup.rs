//! 顶层日志文件与 MaaFramework on_error 产物的会话感知清理逻辑。

use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::State;

use super::types::MaaState;
use super::utils::get_app_data_dir;

const ACTIVE_LOG_FILE_NAMES: [&str; 2] = ["mxu-tauri.log", "maafw.log"];

/// 进程级会话边界，用于区分本次启动与更早 MXU 会话产生的文件。
#[derive(Debug)]
pub struct LogCleanupState {
    process_started_at: SystemTime,
}

impl LogCleanupState {
    pub fn new(process_started_at: SystemTime) -> Self {
        Self { process_started_at }
    }
}

/// 调用方请求的 MaaFramework on_error 目录清理策略。
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OnErrorScope {
    #[default]
    OldSessionOnly,
    IncludeCurrentWhenIdle,
}

/// 后端检查真实任务状态后实际采用的清理策略。
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppliedOnErrorScope {
    OldSessionOnly,
    AllExisting,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogCleanupReport {
    pub log_files_deleted: u64,
    pub on_error_files_deleted: u64,
    pub protected_files: u64,
    pub failures: u64,
    pub on_error_scope_applied: AppliedOnErrorScope,
}

impl LogCleanupReport {
    fn new(on_error_scope_applied: AppliedOnErrorScope) -> Self {
        Self {
            log_files_deleted: 0,
            on_error_files_deleted: 0,
            protected_files: 0,
            failures: 0,
            on_error_scope_applied,
        }
    }

    fn protect(&mut self) {
        self.protected_files = self.protected_files.saturating_add(1);
    }

    fn fail(&mut self) {
        self.failures = self.failures.saturating_add(1);
    }
}

fn is_log_file(path: &Path) -> bool {
    path.extension() == Some(OsStr::new("log"))
}

fn is_protected_log_name(path: &Path, exclude_file_name: Option<&str>) -> bool {
    let Some(name) = path.file_name() else {
        return true;
    };

    ACTIVE_LOG_FILE_NAMES
        .iter()
        .any(|protected| name == OsStr::new(protected))
        || exclude_file_name.is_some_and(|excluded| name == OsStr::new(excluded))
}

fn remove_file_with_report(
    path: &Path,
    report: &mut LogCleanupReport,
    remove_file: &dyn Fn(&Path) -> io::Result<()>,
) -> bool {
    match remove_file(path) {
        Ok(()) => true,
        Err(error) => {
            report.fail();
            log::warn!(
                "Failed to delete cleanup target [{}]: {}",
                path.display(),
                error
            );
            false
        }
    }
}

fn collect_on_error_files(
    directory: &Path,
    files: &mut Vec<(PathBuf, SystemTime)>,
    report: &mut LogCleanupReport,
) {
    let directory_metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            report.fail();
            log::warn!(
                "Failed to inspect on_error directory [{}]: {}",
                directory.display(),
                error
            );
            return;
        }
    };

    if directory_metadata.file_type().is_symlink() {
        report.protect();
        return;
    }
    if !directory_metadata.is_dir() {
        report.protect();
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            report.fail();
            log::warn!(
                "Failed to read on_error directory [{}]: {}",
                directory.display(),
                error
            );
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                report.fail();
                log::warn!(
                    "Failed to read an entry in on_error directory [{}]: {}",
                    directory.display(),
                    error
                );
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                report.fail();
                report.protect();
                log::warn!(
                    "Failed to inspect on_error entry [{}]: {}",
                    path.display(),
                    error
                );
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            report.protect();
        } else if metadata.is_dir() {
            collect_on_error_files(&path, files, report);
        } else if metadata.is_file() {
            match metadata.modified() {
                Ok(modified) => files.push((path, modified)),
                Err(error) => {
                    report.fail();
                    report.protect();
                    log::warn!(
                        "Failed to read modification time for on_error file [{}]: {}",
                        path.display(),
                        error
                    );
                }
            }
        } else {
            report.protect();
        }
    }
}

fn clear_log_files_in_directory(
    debug_dir: &Path,
    process_started_at: SystemTime,
    exclude_file_name: Option<&str>,
    on_error_scope_applied: AppliedOnErrorScope,
    remove_file: &dyn Fn(&Path) -> io::Result<()>,
) -> Result<LogCleanupReport, String> {
    let mut report = LogCleanupReport::new(on_error_scope_applied);
    let entries = match fs::read_dir(debug_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(report),
        Err(error) => {
            return Err(format!(
                "读取日志目录失败 [{}]: {}",
                debug_dir.display(),
                error
            ))
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                report.fail();
                log::warn!(
                    "Failed to read an entry in log directory [{}]: {}",
                    debug_dir.display(),
                    error
                );
                continue;
            }
        };
        let path = entry.path();
        if !is_log_file(&path) {
            continue;
        }
        if is_protected_log_name(&path, exclude_file_name) {
            report.protect();
            continue;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                report.fail();
                report.protect();
                log::warn!("Failed to inspect log file [{}]: {}", path.display(), error);
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            report.protect();
            continue;
        }

        let modified = match metadata.modified() {
            Ok(modified) => modified,
            Err(error) => {
                report.fail();
                report.protect();
                log::warn!(
                    "Failed to read modification time for log file [{}]: {}",
                    path.display(),
                    error
                );
                continue;
            }
        };
        if modified >= process_started_at {
            report.protect();
            continue;
        }

        if remove_file_with_report(&path, &mut report, remove_file) {
            report.log_files_deleted = report.log_files_deleted.saturating_add(1);
        }
    }

    // 删除前先对已有 on_error 文件做快照；遍历结束后新产生的文件不会被本次清理带走。
    let mut on_error_files = Vec::new();
    collect_on_error_files(
        &debug_dir.join("on_error"),
        &mut on_error_files,
        &mut report,
    );

    for (path, modified) in on_error_files {
        let should_delete = match on_error_scope_applied {
            AppliedOnErrorScope::OldSessionOnly => modified < process_started_at,
            AppliedOnErrorScope::AllExisting => true,
        };
        if !should_delete {
            report.protect();
            continue;
        }

        if remove_file_with_report(&path, &mut report, remove_file) {
            report.on_error_files_deleted = report.on_error_files_deleted.saturating_add(1);
        }
    }

    Ok(report)
}

fn any_task_running(state: &MaaState) -> Result<bool, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|error| format!("Failed to lock Maa instance state: {}", error))?;
    Ok(instances.values().any(|instance| {
        instance
            .tasker
            .as_ref()
            .is_some_and(|tasker| tasker.running())
    }))
}

fn resolve_on_error_scope(
    requested_scope: OnErrorScope,
    any_task_running: Option<bool>,
) -> AppliedOnErrorScope {
    match (requested_scope, any_task_running) {
        (OnErrorScope::IncludeCurrentWhenIdle, Some(false)) => AppliedOnErrorScope::AllExisting,
        _ => AppliedOnErrorScope::OldSessionOnly,
    }
}

/// 删除旧会话的顶层 .log 文件及 MaaFramework on_error 产物。
#[tauri::command]
pub fn clear_log_files(
    cleanup_state: State<'_, LogCleanupState>,
    maa_state: State<'_, Arc<MaaState>>,
    exclude_file_name: Option<String>,
    on_error_scope: Option<OnErrorScope>,
) -> Result<LogCleanupReport, String> {
    let requested_scope = on_error_scope.unwrap_or_default();
    let mut state_failures = 0_u64;

    // 只有可能删除当前会话文件时才持续持有互斥锁；若请求已降级为旧会话清理，
    // 则释放锁，避免在清理旧文件期间阻塞新任务启动。
    let mut task_submission_guard = None;
    let applied_scope = if requested_scope == OnErrorScope::IncludeCurrentWhenIdle {
        match maa_state.task_submission_cleanup_gate.lock() {
            Ok(guard) => match any_task_running(&maa_state) {
                Ok(false) => {
                    task_submission_guard = Some(guard);
                    resolve_on_error_scope(requested_scope, Some(false))
                }
                Ok(true) => resolve_on_error_scope(requested_scope, Some(true)),
                Err(error) => {
                    state_failures = state_failures.saturating_add(1);
                    log::warn!(
                        "Could not confirm task state; protecting current on_error files: {}",
                        error
                    );
                    resolve_on_error_scope(requested_scope, None)
                }
            },
            Err(error) => {
                state_failures = state_failures.saturating_add(1);
                log::warn!(
                    "Could not lock task submission gate; protecting current on_error files: {}",
                    error
                );
                resolve_on_error_scope(requested_scope, None)
            }
        }
    } else {
        resolve_on_error_scope(requested_scope, None)
    };

    let debug_dir = get_app_data_dir()?.join("debug");
    let mut report = clear_log_files_in_directory(
        &debug_dir,
        cleanup_state.process_started_at,
        exclude_file_name.as_deref(),
        applied_scope,
        &|path| fs::remove_file(path),
    )?;
    report.failures = report.failures.saturating_add(state_failures);

    // 明确互斥锁的生命周期：当前会话文件删除完成后，新任务提交才能取得该锁。
    drop(task_submission_guard);

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};
    use std::time::{Duration, UNIX_EPOCH};
    use tempfile::TempDir;

    fn session_start() -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(1_000_000)
    }

    fn create_file(path: &Path, modified: SystemTime) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, b"test").unwrap();
        set_file_mtime(path, FileTime::from_system_time(modified)).unwrap();
    }

    fn run_cleanup(
        debug_dir: &Path,
        exclude_file_name: Option<&str>,
        scope: AppliedOnErrorScope,
    ) -> LogCleanupReport {
        clear_log_files_in_directory(
            debug_dir,
            session_start(),
            exclude_file_name,
            scope,
            &|path| fs::remove_file(path),
        )
        .unwrap()
    }

    #[test]
    fn top_level_cleanup_deletes_only_old_unprotected_logs() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path();
        let start = session_start();
        let old = start - Duration::from_secs(10);
        let new = start + Duration::from_secs(10);

        create_file(&debug_dir.join("old.log"), old);
        create_file(&debug_dir.join("new.log"), new);
        create_file(&debug_dir.join("boundary.log"), start);
        create_file(&debug_dir.join("frontend.log"), old);
        create_file(&debug_dir.join("mxu-tauri.log"), old);
        create_file(&debug_dir.join("maafw.log"), old);
        create_file(&debug_dir.join("note.txt"), old);
        fs::create_dir(debug_dir.join("directory.log")).unwrap();

        let report = run_cleanup(
            debug_dir,
            Some("frontend.log"),
            AppliedOnErrorScope::OldSessionOnly,
        );

        assert_eq!(report.log_files_deleted, 1);
        assert_eq!(report.on_error_files_deleted, 0);
        assert_eq!(report.protected_files, 6);
        assert_eq!(report.failures, 0);
        assert!(!debug_dir.join("old.log").exists());
        for name in [
            "new.log",
            "boundary.log",
            "frontend.log",
            "mxu-tauri.log",
            "maafw.log",
            "note.txt",
            "directory.log",
        ] {
            assert!(debug_dir.join(name).exists(), "{name} should be preserved");
        }
    }

    #[test]
    fn old_session_scope_recurses_and_preserves_current_on_error_files() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path();
        let start = session_start();

        create_file(
            &debug_dir.join("on_error/old.png"),
            start - Duration::from_secs(10),
        );
        create_file(
            &debug_dir.join("on_error/nested/current.json"),
            start + Duration::from_secs(10),
        );
        create_file(&debug_dir.join("on_error/boundary.png"), start);

        let report = run_cleanup(debug_dir, None, AppliedOnErrorScope::OldSessionOnly);

        assert_eq!(report.on_error_files_deleted, 1);
        assert_eq!(report.protected_files, 2);
        assert!(!debug_dir.join("on_error/old.png").exists());
        assert!(debug_dir.join("on_error/nested/current.json").exists());
        assert!(debug_dir.join("on_error/boundary.png").exists());
        assert!(debug_dir.join("on_error/nested").is_dir());
    }

    #[test]
    fn all_existing_scope_removes_current_on_error_snapshot_without_removing_directories() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path();
        let start = session_start();

        for (name, modified) in [
            ("old.png", start - Duration::from_secs(10)),
            ("boundary.png", start),
            ("nested/current.json", start + Duration::from_secs(10)),
        ] {
            create_file(&debug_dir.join("on_error").join(name), modified);
        }

        let report = run_cleanup(debug_dir, None, AppliedOnErrorScope::AllExisting);

        assert_eq!(report.on_error_files_deleted, 3);
        assert_eq!(report.protected_files, 0);
        assert!(debug_dir.join("on_error").is_dir());
        assert!(debug_dir.join("on_error/nested").is_dir());
    }

    #[test]
    fn on_error_cleanup_uses_a_snapshot() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path();
        let on_error_dir = debug_dir.join("on_error");
        create_file(&on_error_dir.join("existing.png"), session_start());

        let late_file = on_error_dir.join("late.png");
        let report = clear_log_files_in_directory(
            debug_dir,
            session_start(),
            None,
            AppliedOnErrorScope::AllExisting,
            &|path| {
                create_file(&late_file, session_start());
                fs::remove_file(path)
            },
        )
        .unwrap();

        assert_eq!(report.on_error_files_deleted, 1);
        assert!(late_file.exists());
    }

    #[test]
    fn deletion_failures_are_counted_and_do_not_stop_other_targets() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path();
        let old = session_start() - Duration::from_secs(10);
        create_file(&debug_dir.join("fail.log"), old);
        create_file(&debug_dir.join("on_error/delete.png"), old);

        let report = clear_log_files_in_directory(
            debug_dir,
            session_start(),
            None,
            AppliedOnErrorScope::OldSessionOnly,
            &|path| {
                if path.file_name() == Some(OsStr::new("fail.log")) {
                    Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))
                } else {
                    fs::remove_file(path)
                }
            },
        )
        .unwrap();

        assert_eq!(report.log_files_deleted, 0);
        assert_eq!(report.on_error_files_deleted, 1);
        assert_eq!(report.failures, 1);
        assert!(debug_dir.join("fail.log").exists());
        assert!(!debug_dir.join("on_error/delete.png").exists());
    }

    #[test]
    fn missing_debug_directory_returns_an_empty_report() {
        let temp = TempDir::new().unwrap();
        let missing = temp.path().join("missing");

        let report = run_cleanup(&missing, None, AppliedOnErrorScope::OldSessionOnly);

        assert_eq!(
            report,
            LogCleanupReport::new(AppliedOnErrorScope::OldSessionOnly)
        );
    }

    #[test]
    fn requested_current_scope_is_conservatively_downgraded() {
        assert_eq!(
            resolve_on_error_scope(OnErrorScope::IncludeCurrentWhenIdle, Some(false)),
            AppliedOnErrorScope::AllExisting
        );
        assert_eq!(
            resolve_on_error_scope(OnErrorScope::IncludeCurrentWhenIdle, Some(true)),
            AppliedOnErrorScope::OldSessionOnly
        );
        assert_eq!(
            resolve_on_error_scope(OnErrorScope::IncludeCurrentWhenIdle, None),
            AppliedOnErrorScope::OldSessionOnly
        );
        assert_eq!(
            resolve_on_error_scope(OnErrorScope::OldSessionOnly, Some(false)),
            AppliedOnErrorScope::OldSessionOnly
        );
    }

    #[test]
    fn on_error_symlinks_are_preserved() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path();
        let on_error_dir = debug_dir.join("on_error");
        fs::create_dir_all(&on_error_dir).unwrap();
        let target = temp.path().join("outside.png");
        create_file(&target, session_start());
        let link = on_error_dir.join("linked.png");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&target, &link).is_err() {
            return;
        }

        let report = run_cleanup(debug_dir, None, AppliedOnErrorScope::AllExisting);

        assert_eq!(report.on_error_files_deleted, 0);
        assert_eq!(report.protected_files, 1);
        assert!(link.exists());
        assert!(target.exists());
    }
}
