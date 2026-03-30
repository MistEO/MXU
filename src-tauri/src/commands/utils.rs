//! 辅助函数
//!
//! 提供路径处理和其他通用工具函数

use super::types::MaaCallbackEvent;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

// ==================== 控制台输出 ====================

static CONSOLE_ENABLED: AtomicBool = AtomicBool::new(false);

/// 存储 CONOUT$ 句柄的原始指针值（线程安全：WriteConsoleW 本身是线程安全的）
#[cfg(windows)]
static CONSOLE_HANDLE: OnceLock<usize> = OnceLock::new();

/// 初始化控制台输出（在 main 中调用）
/// 仅当命令行传入 `--console` 参数时启用
pub fn init_console_output() {
    if !std::env::args().any(|a| a == "--console") {
        return;
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::Console::{
            AttachConsole, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE,
            STD_OUTPUT_HANDLE,
        };

        // 附着到父进程终端（从 cmd/powershell 启动时生效）
        if unsafe { AttachConsole(ATTACH_PARENT_PROCESS) }.is_ok() {
            // 打开 CONOUT$ 获取控制台输出句柄（不受后续 stdout 重定向影响）
            if let Ok(f) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
                let raw = f.as_raw_handle() as usize;
                let _ = CONSOLE_HANDLE.set(raw);
                std::mem::forget(f); // 保持句柄存活
                CONSOLE_ENABLED.store(true, Ordering::Relaxed);

                // 将进程的 stdout/stderr 重定向到 NUL
                // 防止 MaaFramework C++ 库的内部日志直接输出到终端
                if let Ok(nul) = std::fs::OpenOptions::new().write(true).open("NUL") {
                    let nul_handle = HANDLE(nul.as_raw_handle() as *mut std::ffi::c_void);
                    unsafe {
                        // Win32 层重定向
                        let _ = SetStdHandle(STD_OUTPUT_HANDLE, nul_handle);
                        let _ = SetStdHandle(STD_ERROR_HANDLE, nul_handle);

                        // CRT 层重定向（C/C++ 库通过 fd 1/2 写入）
                        extern "C" {
                            fn _open_osfhandle(osfhandle: isize, flags: i32) -> i32;
                            fn _dup2(fd1: i32, fd2: i32) -> i32;
                        }
                        let nul_fd = _open_osfhandle(nul.as_raw_handle() as isize, 0);
                        if nul_fd >= 0 {
                            let _ = _dup2(nul_fd, 1); // CRT stdout
                            let _ = _dup2(nul_fd, 2); // CRT stderr
                        }
                    }
                    std::mem::forget(nul); // 保持 NUL 句柄存活
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        CONSOLE_ENABLED.store(true, Ordering::Relaxed);
    }
}

/// 向控制台输出一行日志（仅在命令行启动时有效）
/// Windows: 使用 WriteConsoleW 直接写 UTF-16，不依赖 codepage 设置
pub fn console_println(args: std::fmt::Arguments<'_>) {
    if !CONSOLE_ENABLED.load(Ordering::Relaxed) {
        return;
    }

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::Console::WriteConsoleW;

        if let Some(&raw) = CONSOLE_HANDLE.get() {
            let handle = HANDLE(raw as *mut std::ffi::c_void);
            let text = format!("{}\r\n", args);
            let wide: Vec<u16> = text.encode_utf16().collect();
            let mut written = 0u32;
            unsafe {
                let _ = WriteConsoleW(handle, &wide, Some(&mut written), None);
            }
        }
    }

    #[cfg(not(windows))]
    {
        println!("{}", args);
    }
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
    CONSOLE_ENABLED.load(Ordering::Relaxed)
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
