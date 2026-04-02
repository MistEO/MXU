//! 控制台输出系统
//!
//! 处理 `--log-mode` 参数解析，仅在管道/重定向场景下输出格式化日志。
//! 需要通过管道捕获输出（如 `app.exe --log-mode=ui | tee log.txt`）。

use std::sync::OnceLock;

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

fn parse_mode_value(mode: &str) -> LogPrintMode {
    match mode.to_ascii_lowercase().as_str() {
        "none" | "off" | "silent" => LogPrintMode::None,
        "raw" => LogPrintMode::Raw,
        "ui" => LogPrintMode::Ui,
        "verbose" => LogPrintMode::Verbose,
        _ => default_log_print_mode(),
    }
}

fn parse_log_print_mode(args: &[String]) -> LogPrintMode {
    // --log-mode=value
    if let Some(mode) = args.iter().find_map(|a| a.strip_prefix("--log-mode=")) {
        return parse_mode_value(mode);
    }
    // --log-mode value
    if let Some(pos) = args.iter().position(|a| a == "--log-mode") {
        if let Some(mode) = args.get(pos + 1) {
            return parse_mode_value(mode);
        }
    }

    default_log_print_mode()
}

/// 初始化控制台输出模式（在 main 中调用）
/// 支持 `--log-mode=<none|raw|ui|verbose>`
/// - none: 不输出日志到控制台
/// - raw: 保留标准流原始日志输出（tauri_plugin_log Stdout target）
/// - ui: 通过管道输出格式化日志（MaaFramework stdout 在初始化阶段通过 API 关闭）
/// - verbose: 通过管道输出格式化日志（MaaFramework stdout 在初始化阶段通过 API 关闭）
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
        LogPrintMode::None | LogPrintMode::Raw => {}
    }
}

/// 向标准输出写一行日志（可被管道捕获）
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
        $crate::commands::console::console_println(format_args!($($arg)*))
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
