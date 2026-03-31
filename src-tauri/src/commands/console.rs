//! 控制台输出系统
//!
//! 处理 `--log-mode` 参数解析、终端附着、CRT 重定向等

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

/// 初始化控制台输出（在 main 中调用）
/// 支持 `--log-mode=<none|raw|ui|verbose>`
/// - none: 不输出日志到控制台
/// - raw: 保留标准流原始日志输出（tauri_plugin_log Stdout target）
/// - ui: 附着父终端，CRT fd → NUL 丢弃 C++ 噪音，println! 输出格式化日志
/// - verbose: 附着父终端，C++ 原始日志保留，println! 输出格式化日志
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

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::Console::{
            AttachConsole, GetStdHandle, SetConsoleOutputCP, SetStdHandle,
            ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
        };

        // 检查父进程是否已传入有效的 stdout 句柄（管道重定向场景）
        // 必须在 AttachConsole 之前检查，因为 AttachConsole 可能改变句柄状态
        let inherited_out = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) }.unwrap_or(HANDLE::default());
        let is_piped = !inherited_out.is_invalid() && inherited_out != HANDLE::default();

        // 1. 附着父终端（从 cmd/powershell 启动时生效）
        if unsafe { AttachConsole(ATTACH_PARENT_PROCESS) }.is_err() {
            // AttachConsole 失败但有管道句柄时仍可输出
            if !is_piped {
                log::warn!("AttachConsole failed; --log-mode=ui/verbose 需要从终端启动");
                return;
            }
        }

        // 设置控制台输出代码页为 UTF-8（仅对终端直接输出有效，管道场景无影响）
        unsafe { let _ = SetConsoleOutputCP(65001); }

        // 2. 设置 Win32 stdout/stderr 句柄
        //    仅在无管道时打开 CONOUT$（GUI 程序默认 stdout 为 NULL）
        //    有管道时保留父进程传入的管道句柄，确保 println! 输出可被管道捕获
        if !is_piped {
            if let Ok(conout) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
                let conout_handle = HANDLE(conout.as_raw_handle() as *mut std::ffi::c_void);
                unsafe {
                    let _ = SetStdHandle(STD_OUTPUT_HANDLE, conout_handle);
                    let _ = SetStdHandle(STD_ERROR_HANDLE, conout_handle);
                }
                std::mem::forget(conout);
            }
        }

        // 3. ui 模式：CRT fd 1/2 → NUL（丢弃 C++ 库噪音）
        //    _dup2 会自动调用 SetStdHandle 覆盖 Win32 句柄，
        //    所以先保存 → _dup2 → 恢复，确保 println! 仍输出到终端
        if log_mode == LogPrintMode::Ui {
            // 保存当前 Win32 stdout/stderr 句柄
            let saved_out = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) }.unwrap_or(HANDLE::default());
            let saved_err = unsafe { GetStdHandle(STD_ERROR_HANDLE) }.unwrap_or(HANDLE::default());

            if let Ok(nul) = std::fs::OpenOptions::new().write(true).open("NUL") {
                unsafe {
                    extern "C" {
                        fn _open_osfhandle(osfhandle: isize, flags: i32) -> i32;
                        fn _dup2(fd1: i32, fd2: i32) -> i32;
                    }
                    let nul_fd = _open_osfhandle(nul.as_raw_handle() as isize, 0);
                    if nul_fd >= 0 {
                        let _ = _dup2(nul_fd, 1); // CRT stdout → NUL（同时覆盖 Win32 句柄）
                        let _ = _dup2(nul_fd, 2); // CRT stderr → NUL（同时覆盖 Win32 句柄）
                    }

                    // 恢复 Win32 句柄，让 println! 继续输出到终端/管道
                    let _ = SetStdHandle(STD_OUTPUT_HANDLE, saved_out);
                    let _ = SetStdHandle(STD_ERROR_HANDLE, saved_err);
                }
                std::mem::forget(nul);
            }
        }
    }

    // macOS/Linux: ui 模式重定向 fd 1/2 到 /dev/null
    #[cfg(not(windows))]
    {
        if log_mode == LogPrintMode::Ui {
            if let Ok(nul) = std::fs::OpenOptions::new().write(true).open("/dev/null") {
                use std::os::unix::io::AsRawFd;
                let nul_fd = nul.as_raw_fd();
                unsafe {
                    let _ = libc::dup2(nul_fd, 1); // stdout → /dev/null
                    let _ = libc::dup2(nul_fd, 2); // stderr → /dev/null
                }
                std::mem::forget(nul);
            }
        }
    }
}

/// 向终端输出一行日志（println! 可被管道捕获）
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
