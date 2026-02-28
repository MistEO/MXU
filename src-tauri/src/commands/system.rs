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

/// 检查指定程序是否正在运行（通过完整路径比较，避免同名程序误判）
/// 公共工具函数，可被其他模块调用
pub fn check_process_running(program: &str) -> bool {
    use std::path::PathBuf;

    let resolved_path = PathBuf::from(program);

    // 提取文件名用于初步筛选
    let file_name = match resolved_path.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => {
            log::warn!(
                "check_process_running: cannot extract filename from '{}'",
                program
            );
            return false;
        }
    };

    // 尝试规范化路径用于精确比较
    let canonical_target = resolved_path
        .canonicalize()
        .unwrap_or_else(|_| resolved_path.clone());

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let file_name_lower = file_name.to_lowercase();

        /// 动态扩容获取进程完整路径，处理长路径（>MAX_PATH）场景
        unsafe fn query_process_image_path(
            process: windows::Win32::Foundation::HANDLE,
        ) -> Option<String> {
            let mut capacity: u32 = 512;
            loop {
                let mut buf = vec![0u16; capacity as usize];
                let mut size = capacity;
                let result = QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_FORMAT(0),
                    windows::core::PWSTR(buf.as_mut_ptr()),
                    &mut size,
                );
                if result.is_ok() {
                    return Some(String::from_utf16_lossy(&buf[..size as usize]));
                }
                // ERROR_INSUFFICIENT_BUFFER 对应 HRESULT 0x8007007A，仅此错误时扩容重试
                let err = windows::core::Error::from_win32();
                if err.code().0 as u32 != 0x8007007A || capacity >= 32768 {
                    // 非缓冲区不足错误或已达上限，放弃
                    return None;
                }
                capacity *= 2;
            }
        }

        unsafe {
            let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(e) => {
                    log::error!(
                        "check_process_running: CreateToolhelp32Snapshot failed: {}",
                        e
                    );
                    return false;
                }
            };

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            let target_lower = canonical_target.to_string_lossy().to_lowercase();

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    // 从 szExeFile (UTF-16) 提取进程名
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();

                    // 先按文件名筛选
                    if exe_name == file_name_lower {
                        // 尝试获取完整路径
                        if let Ok(process) = OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION,
                            false,
                            entry.th32ProcessID,
                        ) {
                            if let Some(running_path) = query_process_image_path(process) {
                                let running_canonical = PathBuf::from(&running_path)
                                    .canonicalize()
                                    .map(|p| p.to_string_lossy().to_lowercase())
                                    .unwrap_or_else(|_| running_path.to_lowercase());

                                if running_canonical == target_lower {
                                    let _ = CloseHandle(process);
                                    let _ = CloseHandle(snapshot);
                                    info!(
                                        "check_process_running: '{}' -> true (matched: {})",
                                        program, running_path
                                    );
                                    return true;
                                }
                            }
                            let _ = CloseHandle(process);
                        }
                    }

                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }

            let _ = CloseHandle(snapshot);
            info!("check_process_running: '{}' -> false", program);
            false
        }
    }

    #[cfg(target_os = "linux")]
    {
        // 遍历 /proc/<pid>/exe 读取真实可执行路径进行比较
        if let Ok(proc_dir) = std::fs::read_dir("/proc") {
            for entry in proc_dir.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !name_str.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }

                let exe_link = entry.path().join("exe");
                if let Ok(resolved) = std::fs::read_link(&exe_link) {
                    let canonical = resolved.canonicalize().unwrap_or(resolved);
                    if canonical == canonical_target {
                        info!(
                            "check_process_running: '{}' -> true (pid: {})",
                            program, name_str
                        );
                        return true;
                    }
                }
            }
        }

        info!("check_process_running: '{}' -> false", program);
        false
    }

    #[cfg(target_os = "macos")]
    {
        // macOS 没有 /proc，通过 libproc API 获取每个进程的可执行路径进行比较
        extern "C" {
            fn proc_listallpids(buffer: *mut i32, buffersize: i32) -> i32;
            fn proc_pidpath(pid: i32, buffer: *mut u8, buffersize: u32) -> i32;
        }

        unsafe {
            // proc_listallpids 返回填入的 PID 数量。
            // 从合理初始容量开始，若缓冲区不足则扩容重试，避免多余的探测调用。
            let mut capacity = 1024usize;
            let num_pids;
            let mut pids;
            loop {
                pids = vec![0i32; capacity];
                let buf_size = (capacity * std::mem::size_of::<i32>()) as i32;
                let actual = proc_listallpids(pids.as_mut_ptr(), buf_size);
                if actual <= 0 {
                    info!(
                        "check_process_running: '{}' -> false (list failed)",
                        program
                    );
                    return false;
                }
                if actual as usize >= capacity {
                    // 缓冲区已满，可能被截断，扩容后重试
                    capacity *= 2;
                    continue;
                }
                num_pids = actual as usize;
                break;
            }

            // PROC_PIDPATHINFO_MAXSIZE = 4096
            let mut path_buf = [0u8; 4096];

            for &pid in &pids[..num_pids] {
                if pid == 0 {
                    continue;
                }

                let ret = proc_pidpath(pid, path_buf.as_mut_ptr(), path_buf.len() as u32);
                if ret <= 0 {
                    continue;
                }

                if let Ok(path_str) = std::str::from_utf8(&path_buf[..ret as usize]) {
                    let pid_path = PathBuf::from(path_str);
                    let canonical = pid_path.canonicalize().unwrap_or(pid_path);
                    if canonical == canonical_target {
                        info!(
                            "check_process_running: '{}' -> true (pid: {})",
                            program, pid
                        );
                        return true;
                    }
                }
            }
        }

        info!("check_process_running: '{}' -> false", program);
        false
    }
}

/// Tauri 命令：检查指定程序是否正在运行
/// program: 程序的绝对路径
#[tauri::command]
pub fn is_process_running(program: String) -> bool {
    check_process_running(&program)
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

    // 使用 shell 语义解析参数至数组（支持引号）
    let args_vec: Vec<String> = if args.trim().is_empty() {
        vec![]
    } else {
        shell_words::split(&args)
            .map_err(|e| format!("Failed to parse args: {}", e))?
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

/// 自动迁移旧版注册表自启动到任务计划程序
#[cfg(windows)]
pub fn migrate_legacy_autostart() {
    if has_legacy_registry_autostart() {
        if create_schtask_autostart().is_ok() {
            remove_legacy_registry_autostart();
        }
    }
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn create_schtask_autostart() -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    let exe = exe_path.to_string_lossy();
    let output = std::process::Command::new("schtasks")
        .args([
            "/create",
            "/tn",
            "MXU",
            "/tr",
            &format!("\"{}\" --autostart", exe),
            "/sc",
            "onlogon",
            // 强制交互式运行，确保进程绑定到用户桌面会话，避免登录早期会话未就绪导致 WebView 白屏
            "/it",
            "/rl",
            "highest",
            "/f",
        ])
        .output()
        .map_err(|e| format!("执行 schtasks 失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("创建计划任务失败: {}", stderr));
    }
    Ok(())
}

/// 清理旧版注册表自启动条目（tauri-plugin-autostart 遗留）
#[cfg(windows)]
fn remove_legacy_registry_autostart() {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::*;

    unsafe {
        let subkey = to_wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_SET_VALUE | KEY_QUERY_VALUE,
            &mut hkey,
        )
        .is_ok()
        {
            for name in &["mxu", "MXU"] {
                let wname = to_wide(name);
                let _ = RegDeleteValueW(hkey, PCWSTR(wname.as_ptr()));
            }
            let _ = RegCloseKey(hkey);
        }
    }
}

/// 检查旧版注册表中是否存在自启动条目
#[cfg(windows)]
fn has_legacy_registry_autostart() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::*;

    unsafe {
        let subkey = to_wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_QUERY_VALUE,
            &mut hkey,
        )
        .is_err()
        {
            return false;
        }
        let found = ["mxu", "MXU"].iter().any(|name| {
            let wname = to_wide(name);
            RegQueryValueExW(hkey, PCWSTR(wname.as_ptr()), None, None, None, None).is_ok()
        });
        let _ = RegCloseKey(hkey);
        found
    }
}

/// 通过 Windows 任务计划程序启用开机自启动（以最高权限运行，避免 UAC 弹窗）
#[tauri::command]
pub fn autostart_enable() -> Result<(), String> {
    #[cfg(windows)]
    {
        create_schtask_autostart()?;
        remove_legacy_registry_autostart();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("此功能仅在 Windows 上可用".to_string())
    }
}

/// 通过 Windows 任务计划程序禁用开机自启动
#[tauri::command]
pub fn autostart_disable() -> Result<(), String> {
    #[cfg(windows)]
    {
        // 删除计划任务（不存在时忽略错误）
        let _ = std::process::Command::new("schtasks")
            .args(["/delete", "/tn", "MXU", "/f"])
            .output();
        // 清理旧版注册表条目
        remove_legacy_registry_autostart();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("此功能仅在 Windows 上可用".to_string())
    }
}

/// 查询是否存在自启动（任务计划程序或旧版注册表）
#[tauri::command]
pub fn autostart_is_enabled() -> bool {
    #[cfg(windows)]
    {
        let schtask = std::process::Command::new("schtasks")
            .args(["/query", "/tn", "MXU"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        schtask || has_legacy_registry_autostart()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 获取系统架构
#[tauri::command]
pub fn get_arch() -> String {
    std::env::consts::ARCH.to_string()
}

/// 获取操作系统类型
#[tauri::command]
pub fn get_os() -> String {
    std::env::consts::OS.to_string()
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
