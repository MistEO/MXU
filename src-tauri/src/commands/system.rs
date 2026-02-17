//! 系统相关命令
//!
//! 提供权限检查、系统信息查询、全局选项设置等功能

use log::info;
use std::sync::atomic::{AtomicBool, Ordering};

use super::types::SystemInfo;
use super::utils::get_maafw_dir;

/// 标记是否检测到可能缺少 VC++ 运行库
static VCREDIST_MISSING: AtomicBool = AtomicBool::new(false);

/// 设置 VC++ 运行库缺失标记 (供内部调用)
pub fn set_vcredist_missing(missing: bool) {
    VCREDIST_MISSING.store(missing, Ordering::SeqCst);
}

/// 检查当前进程是否以管理员权限运行
#[tauri::command]
pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        use std::ptr;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token_handle: HANDLE = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle).is_err() {
                return false;
            }

            let mut elevation = TOKEN_ELEVATION::default();
            let mut return_length: u32 = 0;
            let size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;

            let result = GetTokenInformation(
                token_handle,
                TokenElevation,
                Some(ptr::addr_of_mut!(elevation) as *mut _),
                size,
                &mut return_length,
            );

            let _ = CloseHandle(token_handle);

            if result.is_ok() {
                elevation.TokenIsElevated != 0
            } else {
                false
            }
        }
    }

    #[cfg(not(windows))]
    {
        // 非 Windows 平台：检查是否为 root
        unsafe { libc::geteuid() == 0 }
    }
}

/// 以管理员权限重启应用
#[tauri::command]
pub fn restart_as_admin(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;

        let exe_path_str = exe_path.to_string_lossy().to_string();

        // 将字符串转换为 Windows 宽字符
        fn to_wide(s: &str) -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(Some(0)).collect()
        }

        let operation = to_wide("runas");
        let file = to_wide(&exe_path_str);

        info!("restart_as_admin: restarting with admin privileges");

        unsafe {
            let result = ShellExecuteW(
                HWND::default(),
                PCWSTR::from_raw(operation.as_ptr()),
                PCWSTR::from_raw(file.as_ptr()),
                PCWSTR::null(), // 无参数
                PCWSTR::null(), // 使用当前目录
                SW_SHOWNORMAL,
            );

            // ShellExecuteW 返回值 > 32 表示成功
            if result.0 as usize > 32 {
                info!("restart_as_admin: new process started, exiting current");
                // 退出当前进程
                app_handle.exit(0);
                Ok(())
            } else {
                Err(format!(
                    "以管理员身份启动失败: 错误码 {}",
                    result.0 as usize
                ))
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = app_handle;
        Err("此功能仅在 Windows 上可用".to_string())
    }
}

/// 设置全局选项 - 保存调试图像
#[tauri::command]
pub fn maa_set_save_draw(enabled: bool) -> Result<bool, String> {
    maa_framework::set_save_draw(enabled)
        .map(|_| {
            info!("保存调试图像: {}", if enabled { "启用" } else { "禁用" });
            true
        })
        .map_err(|e| format!("设置保存调试图像失败: {}", e))
}

/// 打开文件（使用系统默认程序）
#[tauri::command]
pub async fn open_file(file_path: String) -> Result<(), String> {
    info!("open_file: {}", file_path);

    #[cfg(windows)]
    {
        use std::process::Command;
        // 在 Windows 上使用 cmd /c start 来打开文件
        Command::new("cmd")
            .args(["/c", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

/// 运行程序并等待其退出
#[tauri::command]
pub async fn run_and_wait(file_path: String) -> Result<i32, String> {
    info!("run_and_wait: {}", file_path);

    #[cfg(windows)]
    {
        use std::process::Command;
        let status = Command::new(&file_path)
            .status()
            .map_err(|e| format!("Failed to run file: {}", e))?;

        let exit_code = status.code().unwrap_or(-1);
        info!("run_and_wait finished with exit code: {}", exit_code);
        Ok(exit_code)
    }

    #[cfg(not(windows))]
    {
        let _ = file_path;
        Err("run_and_wait is only supported on Windows".to_string())
    }
}

/// Run pre-action (launch program and optionally wait for exit)
/// program: 程序路径
/// args: 附加参数（空格分隔）
/// cwd: 工作目录（可选，默认为程序所在目录）
/// wait_for_exit: 是否等待进程退出
#[tauri::command]
pub async fn run_action(
    program: String,
    args: String,
    cwd: Option<String>,
    wait_for_exit: bool,
) -> Result<i32, String> {
    use std::process::Command;

    info!(
        "run_action: program={}, args={}, wait={}",
        program, args, wait_for_exit
    );

    // 解析参数字符串为参数数组（简单按空格分割，不处理引号）
    let args_vec: Vec<&str> = if args.trim().is_empty() {
        vec![]
    } else {
        args.split_whitespace().collect()
    };

    let mut cmd = Command::new(&program);

    // 添加参数
    if !args_vec.is_empty() {
        cmd.args(&args_vec);
    }

    // 设置工作目录
    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    } else {
        // 默认使用程序所在目录作为工作目录
        if let Some(parent) = std::path::Path::new(&program).parent() {
            if parent.exists() {
                cmd.current_dir(parent);
            }
        }
    }

    if wait_for_exit {
        // 等待进程退出
        let status = cmd
            .status()
            .map_err(|e| format!("Failed to run action: {} - {}", program, e))?;

        let exit_code = status.code().unwrap_or(-1);
        info!("run_action finished with exit code: {}", exit_code);
        Ok(exit_code)
    } else {
        // 不等待，启动后立即返回
        cmd.spawn()
            .map_err(|e| format!("Failed to spawn action: {} - {}", program, e))?;

        info!("run_action spawned (not waiting)");
        Ok(0) // 不等待时返回 0
    }
}

/// 重新尝试加载 MaaFramework 库
#[tauri::command]
pub async fn retry_load_maa_library() -> Result<String, String> {
    info!("retry_load_maa_library");

    let maafw_dir = get_maafw_dir()?;
    if !maafw_dir.exists() {
        return Err("MaaFramework directory not found".to_string());
    }

    // Load library
    #[cfg(windows)]
    let dll_path = maafw_dir.join("MaaFramework.dll");
    #[cfg(target_os = "macos")]
    let dll_path = maafw_dir.join("libMaaFramework.dylib");
    #[cfg(target_os = "linux")]
    let dll_path = maafw_dir.join("libMaaFramework.so");

    maa_framework::load_library(&dll_path).map_err(|e| e.to_string())?;

    let version = maa_framework::maa_version().to_string();
    info!("MaaFramework loaded successfully, version: {}", version);

    Ok(version)
}

/// 检查是否检测到 VC++ 运行库缺失（检查后自动清除标记）
#[tauri::command]
pub fn check_vcredist_missing() -> bool {
    let missing = VCREDIST_MISSING.swap(false, Ordering::SeqCst);
    if missing {
        info!("VC++ runtime missing detected, notifying frontend");
    }
    missing
}

/// 检查本次启动是否来自开机自启动（通过 --autostart 参数判断）
#[tauri::command]
pub fn is_autostart() -> bool {
    std::env::args().any(|arg| arg == "--autostart")
}

/// 获取系统架构
#[tauri::command]
pub fn get_arch() -> String {
    std::env::consts::ARCH.to_string()
}

/// 获取系统信息
#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    // 获取操作系统名称
    let os = std::env::consts::OS.to_string();

    // 获取操作系统版本
    let info = os_info::get();
    let os_version = format!("{} {}", info.os_type(), info.version());

    // 获取系统架构
    let arch = std::env::consts::ARCH.to_string();

    // 获取 Tauri 框架版本（来自 Tauri 常量）
    let tauri_version = tauri::VERSION.to_string();

    SystemInfo {
        os,
        os_version,
        arch,
        tauri_version,
    }
}
