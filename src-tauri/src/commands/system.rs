//! 系统相关命令
//!
//! 提供权限检查、系统信息查询、全局选项设置等功能

use log::info;
use std::os::raw::c_void;

use crate::maa_ffi::MAA_LIBRARY;

use super::types::SystemInfo;
use super::utils::get_maafw_dir;

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
    let lib = MAA_LIBRARY
        .lock()
        .map_err(|e| format!("Failed to lock library: {}", e))?;

    if lib.is_none() {
        return Err("MaaFramework not initialized".to_string());
    }

    let lib = lib.as_ref().unwrap();

    let result = unsafe {
        (lib.maa_set_global_option)(
            crate::maa_ffi::MAA_GLOBAL_OPTION_SAVE_DRAW,
            &enabled as *const bool as *const c_void,
            std::mem::size_of::<bool>() as u64,
        )
    };

    if result != 0 {
        info!("保存调试图像: {}", if enabled { "启用" } else { "禁用" });
        Ok(true)
    } else {
        Err("设置保存调试图像失败".to_string())
    }
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

/// 重新尝试加载 MaaFramework 库
#[tauri::command]
pub async fn retry_load_maa_library() -> Result<String, String> {
    info!("retry_load_maa_library");

    let maafw_dir = get_maafw_dir()?;
    if !maafw_dir.exists() {
        return Err("MaaFramework directory not found".to_string());
    }

    crate::maa_ffi::init_maa_library(&maafw_dir).map_err(|e| e.to_string())?;

    let version = crate::maa_ffi::get_maa_version().unwrap_or_default();
    info!("MaaFramework loaded successfully, version: {}", version);

    Ok(version)
}

/// 检查是否检测到 VC++ 运行库缺失（检查后自动清除标记）
#[tauri::command]
pub fn check_vcredist_missing() -> bool {
    let missing = crate::maa_ffi::check_and_clear_vcredist_missing();
    if missing {
        info!("VC++ runtime missing detected, notifying frontend");
    }
    missing
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
