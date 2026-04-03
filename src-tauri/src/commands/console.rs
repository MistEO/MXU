//! 控制台日志输出系统
//!
//! 处理 `--log-stdout` 参数解析，仅在管道/重定向场景下输出格式化日志。
//! 需要通过管道捕获输出（如 `app.exe --log-stdout | tee log.txt`）。

use std::sync::OnceLock;

static LOG_STDOUT: OnceLock<bool> = OnceLock::new();

/// 初始化日志 stdout 输出（在 main 中调用）
/// 检测命令行参数 `--log-stdout`，存在则启用格式化日志到 stdout
pub fn init_log_stdout() {
    let enabled = std::env::args().any(|a| a == "--log-stdout");
    let _ = LOG_STDOUT.set(enabled);
}

/// 向标准输出写一行日志（可被管道捕获）
pub fn log_stdout_println(args: std::fmt::Arguments<'_>) {
    if !is_log_stdout() {
        return;
    }
    println!("{}", args);
}

/// 便捷宏：向 stdout 输出日志
#[macro_export]
macro_rules! cprintln {
    ($($arg:tt)*) => {
        $crate::commands::console::log_stdout_println(format_args!($($arg)*))
    };
}

/// 返回是否启用了 --log-stdout
pub fn is_log_stdout() -> bool {
    *LOG_STDOUT.get_or_init(|| false)
}
