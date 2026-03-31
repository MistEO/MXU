//! 辅助函数
//!
//! 提供路径处理和其他通用工具函数

use super::types::MaaCallbackEvent;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

// ==================== 控制台输出 ====================

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogPrintMode {
    None,
    Raw,
    Ui,
    Verbose,
}

static LOG_PRINT_MODE: OnceLock<LogPrintMode> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsoleMode {
    Ui,
    Verbose,
}

static CONSOLE_MODE: OnceLock<ConsoleMode> = OnceLock::new();

fn default_log_print_mode() -> LogPrintMode {
    #[cfg(debug_assertions)]
    {
        LogPrintMode::Raw
    }

    #[cfg(not(debug_assertions))]
    {
        LogPrintMode::None
    }
}

fn parse_log_print_mode(args: &[String]) -> LogPrintMode {
    if let Some(mode) = args.iter().find_map(|a| a.strip_prefix("--log-mode=")) {
        return match mode.to_ascii_lowercase().as_str() {
            "none" | "off" | "silent" => LogPrintMode::None,
            "raw" => LogPrintMode::Raw,
            "ui" => LogPrintMode::Ui,
            "verbose" => LogPrintMode::Verbose,
            _ => default_log_print_mode(),
        };
    }

    default_log_print_mode()
}

/// 初始化控制台输出（在 main 中调用）
/// 支持 `--log-mode=<none|raw|ui|verbose>`
/// - none: 不输出日志到控制台
/// - raw: 保留标准流原始日志输出
/// - ui/verbose: 输出解析日志到标准流
pub fn init_console_output() {
    let args: Vec<String> = std::env::args().collect();
    let log_mode = parse_log_print_mode(&args);
    let _ = LOG_PRINT_MODE.set(log_mode);

    match log_mode {
        LogPrintMode::Ui => {
            let _ = CONSOLE_MODE.set(ConsoleMode::Ui);
        }
        LogPrintMode::Verbose => {
            let _ = CONSOLE_MODE.set(ConsoleMode::Verbose);
        }
        LogPrintMode::None | LogPrintMode::Raw => {
            return;
        }
    }
}

/// 向标准输出打印一行日志
pub fn console_println(args: std::fmt::Arguments<'_>) {
    if !is_console_enabled() {
        return;
    }
    println!("{}", args);
}

/// 便捷宏：向控制台输出日志
#[macro_export]
macro_rules! cprintln {
    ($($arg:tt)*) => {
        $crate::commands::utils::console_println(format_args!($($arg)*))
    };
}

/// 返回控制台输出是否已启用
pub fn is_console_enabled() -> bool {
    matches!(
        get_log_print_mode(),
        LogPrintMode::Ui | LogPrintMode::Verbose
    )
}

/// 返回控制台输出模式
pub fn get_console_mode() -> ConsoleMode {
    *CONSOLE_MODE.get().unwrap_or(&ConsoleMode::Ui)
}

/// 返回日志打印模式
pub fn get_log_print_mode() -> LogPrintMode {
    *LOG_PRINT_MODE.get_or_init(default_log_print_mode)
}

/// 是否启用标准输出日志（用于 tauri_plugin_log 的 Stdout target）
pub fn should_log_to_stdout() -> bool {
    matches!(get_log_print_mode(), LogPrintMode::Raw)
}

// ==================== 回调事件 ====================

/// 发送回调事件到前端
pub fn emit_callback_event<S: Into<String>>(app: &AppHandle, message: S, details: S) {
    let event = MaaCallbackEvent {
        message: message.into(),
        details: details.into(),
    };
    if let Err(e) = app.emit("maa-callback", event) {
        log::error!("Failed to emit maa-callback: {}", e);
    }
}

/// 获取应用数据目录
/// - macOS: ~/Library/Application Support/MXU/
/// - Windows/Linux: exe 所在目录（保持便携式部署）
pub fn get_app_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 环境变量".to_string())?;
        let path = PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("MXU");
        Ok(path)
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux 保持便携式，使用 exe 所在目录
        get_exe_directory()
    }
}

/// 规范化路径：移除冗余的 `.`、处理 `..`、统一分隔符
/// 使用 Path::components() 解析，不需要路径实际存在
pub fn normalize_path(path: &str) -> PathBuf {
    use std::path::{Component, Path};

    let path = Path::new(path);
    let mut components = Vec::new();

    for component in path.components() {
        match component {
            // 跳过当前目录标记 "."
            Component::CurDir => {}
            // 处理父目录 ".."：如果栈顶是普通目录则弹出，否则保留
            Component::ParentDir => {
                if matches!(components.last(), Some(Component::Normal(_))) {
                    components.pop();
                } else {
                    components.push(component);
                }
            }
            // 保留其他组件（Prefix、RootDir、Normal）
            _ => components.push(component),
        }
    }

    // 重建路径
    components.into_iter().collect()
}

/// 获取日志目录（应用数据目录下的 debug 子目录）
pub fn get_logs_dir() -> PathBuf {
    get_app_data_dir()
        .unwrap_or_else(|_| {
            // 回退到 exe 目录
            let exe_path = std::env::current_exe().unwrap_or_default();
            exe_path
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .to_path_buf()
        })
        .join("debug")
}

/// 获取 exe 所在目录路径（内部使用）
pub fn get_exe_directory() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取 exe 路径失败: {}", e))?;
    exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法获取 exe 所在目录".to_string())
}

/// 获取可执行文件所在目录下的 maafw 子目录
pub fn get_maafw_dir() -> Result<PathBuf, String> {
    Ok(get_exe_directory()?.join("maafw"))
}

/// 构建 User-Agent 字符串
pub fn build_user_agent() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let tauri_version = tauri::VERSION;
    format!("MXU/{} ({}; {}) Tauri/{}", version, os, arch, tauri_version)
}
