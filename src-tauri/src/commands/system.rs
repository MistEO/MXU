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

/// 创建日志悬浮窗
/// x, y 为物理像素坐标（与 GetWindowRect 一致）
#[tauri::command]
pub async fn create_log_overlay_window(
    app_handle: tauri::AppHandle,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    always_on_top: bool,
) -> Result<(), String> {
    use tauri::Manager;

    let label = "log-overlay";

    // 检查窗口是否已存在
    if let Some(window) = app_handle.get_webview_window(label) {
        info!("Log overlay window already exists");
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        tauri::WebviewUrl::App("log-overlay.html".into()),
    )
    .title("日志悬浮窗")
    .inner_size(width, height)
    .decorations(false)
    .resizable(true)
    .always_on_top(always_on_top)
    .skip_taskbar(true)
    .visible(false);

    // transparent() 在 macOS 上需要 macos-private-api feature，仅 Windows 启用
    #[cfg(target_os = "windows")]
    {
        builder = builder.transparent(true);
    }

    let window = builder
    .build()
    .map_err(|e| format!("Failed to create log overlay window: {}", e))?;

    // 使用物理像素坐标设置位置（避免 DPI 缩放问题）
    use tauri::PhysicalPosition;
    window
        .set_position(tauri::Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|e| format!("Failed to set position: {}", e))?;

    window.show().map_err(|e| format!("Failed to show window: {}", e))?;

    info!("Log overlay window created (always_on_top={}, pos=({},{}))", always_on_top, x, y);

    Ok(())
}

/// 获取实例连接的窗口句柄（由 Rust 后端存储，前端直接查询）
#[tauri::command]
pub fn get_connected_window_handle(
    state: tauri::State<std::sync::Arc<super::types::MaaState>>,
    instance_id: String,
) -> Result<Option<i64>, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get(&instance_id) {
        Ok(instance.connected_window_handle.map(|h| h as i64))
    } else {
        Ok(None)
    }
}

/// 手动设置实例的跟随窗口句柄（用于 ADB 控制器手动选择模拟器窗口）
#[tauri::command]
pub fn set_connected_window_handle(
    state: tauri::State<std::sync::Arc<super::types::MaaState>>,
    instance_id: String,
    handle: Option<i64>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get_mut(&instance_id) {
        instance.connected_window_handle = handle.map(|h| h as u64);
        info!(
            "Manually set connected window handle for instance {}: {:?}",
            instance_id, handle
        );
        Ok(())
    } else {
        Err("Instance not found".to_string())
    }
}

/// 获取指定窗口的可见区域位置和大小 (物理像素, Windows only)
///
/// 返回 (x, y, width, height, scale_factor)
/// 优先使用 DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) 获取真实可见边界，
/// 排除 Windows 10/11 不可见的扩展边框。回退到 GetWindowRect。
/// scale_factor 为该窗口所在监视器的 DPI 缩放比 (如 1.0, 1.25, 1.5)。
#[tauri::command]
pub fn get_window_rect_by_handle(handle: i64) -> Result<(i32, i32, i32, i32, f64), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        use windows::Win32::UI::HiDpi::GetDpiForWindow;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

        let hwnd = HWND(handle as *mut _);
        let mut rect = RECT::default();

        // 优先用 DWM 获取真实可见边界
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
        };

        if ok.is_err() {
            unsafe {
                GetWindowRect(hwnd, &mut rect)
                    .map_err(|e| format!("GetWindowRect failed: {}", e))?;
            }
        }

        let dpi = unsafe { GetDpiForWindow(hwnd) };
        let scale = if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 };

        Ok((rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, scale))
    }
    #[cfg(not(windows))]
    {
        let _ = handle;
        Err("Not supported on this platform".to_string())
    }
}

/// 将悬浮窗放置在目标窗口的上一层（z-order）
#[tauri::command]
pub async fn set_overlay_above_target(
    app_handle: tauri::AppHandle,
    target_handle: i64,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindow, SetWindowPos, GW_HWNDPREV, SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE,
            HWND_TOP,
        };

        let overlay = app_handle
            .get_webview_window("log-overlay")
            .ok_or("Overlay window not found")?;
        let overlay_hwnd = overlay.hwnd().map_err(|e| format!("Failed to get overlay hwnd: {}", e))?;

        let target_hwnd = HWND(target_handle as *mut _);
        let overlay_win_hwnd = HWND(overlay_hwnd.0 as *mut _);
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;

        unsafe {
            // 找到 target 上方的窗口，把 overlay 插到那下面（即 target 上方）
            let insert_after = GetWindow(target_hwnd, GW_HWNDPREV)
                .ok()
                .filter(|h| !h.is_invalid())
                .unwrap_or(HWND_TOP);

            let _ = SetWindowPos(overlay_win_hwnd, insert_after, 0, 0, 0, 0, flags);
        }

        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app_handle, target_handle);
        Ok(())
    }
}

/// 设置悬浮窗是否始终置顶
#[tauri::command]
pub async fn set_overlay_always_on_top(
    app_handle: tauri::AppHandle,
    always_on_top: bool,
) -> Result<(), String> {
    use tauri::Manager;

    let overlay = app_handle
        .get_webview_window("log-overlay")
        .ok_or("Overlay window not found")?;

    overlay
        .set_always_on_top(always_on_top)
        .map_err(|e| format!("Failed to set always_on_top: {}", e))?;

    info!("Log overlay always_on_top set to {}", always_on_top);
    Ok(())
}

/// 关闭日志悬浮窗
#[tauri::command]
pub async fn close_log_overlay(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(overlay) = app_handle.get_webview_window("log-overlay") {
        overlay.close().map_err(|e| format!("Failed to close overlay: {}", e))?;
    }
    Ok(())
}
