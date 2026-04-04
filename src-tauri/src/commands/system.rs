//! 系统相关命令
//!
//! 提供权限检查、系统信息查询、全局选项设置等功能

use super::types::SystemInfo;
use super::types::WebView2DirInfo;
use super::utils::get_maafw_dir;
use log::{info, warn};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
        use winsafe::co::{TOKEN, TOKEN_INFORMATION_CLASS};
        use winsafe::{TokenInfo, HPROCESS};

        if let Ok(token_handle) = HPROCESS::GetCurrentProcess().OpenProcessToken(TOKEN::QUERY) {
            let result = token_handle.GetTokenInformation(TOKEN_INFORMATION_CLASS::Elevation);
            if let Ok(TokenInfo::Elevation(elevation)) = result {
                elevation.TokenIsElevated()
            } else {
                false
            }
        } else {
            false
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
        use winsafe::co::SW;
        use winsafe::{ShellExecuteEx, SHELLEXECUTEINFO};

        let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;

        let exe_path_str = exe_path.to_string_lossy().to_string();

        info!("restart_as_admin: restarting with admin privileges");

        let result = ShellExecuteEx(&SHELLEXECUTEINFO {
            file: &exe_path_str,
            verb: Option::from("runas"),
            show: SW::SHOWNORMAL,
            ..Default::default()
        });

        // ShellExecuteEx 返回 Result：Ok 表示成功，Err 表示失败
        if let Err(e) = result {
            Err(format!("以管理员身份启动失败: 错误码 {}", e.raw()))
        } else {
            info!("restart_as_admin: new process started, exiting current");
            // 退出当前进程
            app_handle.exit(0);
            Ok(())
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
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        Command::new("cmd")
            .args(["/c", "start", "", &file_path])
            .creation_flags(CREATE_NO_WINDOW)
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
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let status = Command::new(&file_path)
            .creation_flags(CREATE_NO_WINDOW)
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

    // 尝试规范化路径用于精确比较
    let canonical_target = resolved_path
        .canonicalize()
        .unwrap_or_else(|_| resolved_path.clone());

    // 提取文件名用于 Windows 下的初步筛选
    #[cfg(windows)]
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

    #[cfg(windows)]
    {
        use winsafe::co::{PROCESS, PROCESS_NAME, TH32CS};
        use winsafe::{HPROCESS, HPROCESSLIST};

        let file_name_lower = file_name.to_lowercase();
        let target_lower = canonical_target.to_string_lossy().to_lowercase();

        let mut snapshot = match HPROCESSLIST::CreateToolhelp32Snapshot(TH32CS::SNAPPROCESS, None) {
            Ok(h) => h,
            Err(e) => {
                log::error!(
                    "check_process_running: CreateToolhelp32Snapshot failed: {}",
                    e
                );
                return false;
            }
        };
        for process_result in snapshot.iter_processes() {
            if let Ok(entry) = process_result {
                if entry.szExeFile().to_lowercase() == file_name_lower {
                    if let Ok(process) = HPROCESS::OpenProcess(
                        PROCESS::QUERY_LIMITED_INFORMATION,
                        false,
                        entry.th32ProcessID,
                    ) {
                        if let Ok(running_path) =
                            process.QueryFullProcessImageName(PROCESS_NAME::WIN32)
                        {
                            let running_canonical = PathBuf::from(&running_path)
                                .canonicalize()
                                .map(|p| p.to_string_lossy().to_lowercase())
                                .unwrap_or_else(|_| running_path.to_lowercase());

                            if running_canonical == target_lower {
                                info!(
                                    "check_process_running: '{}' -> true (matched: {})",
                                    program, running_path
                                );
                                return true;
                            }
                        }
                    }
                }
            } else {
                break;
            }
        }

        info!("check_process_running: '{}' -> false", program);
        false
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
    use_cmd: Option<bool>,
) -> Result<i32, String> {
    let use_cmd = use_cmd.unwrap_or(false);

    info!(
        "run_action: program={}, args={}, wait={}, use_cmd={}",
        program, args, wait_for_exit, use_cmd
    );

    // 使用 shell 语义解析参数至数组（支持引号）
    let args_vec: Vec<String> = if args.trim().is_empty() {
        vec![]
    } else {
        shell_words::split(&args).map_err(|e| format!("Failed to parse args: {}", e))?
    };

    let mut cmd = super::utils::build_launch_command(&program, &args_vec, use_cmd);

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

/// 从命令行参数中获取指定选项的值
/// 支持 `-x value`、`--name value`、`-x=value`、`--name=value` 格式
/// 返回第一个匹配的值；若值缺失或以 `-` 开头则视为无效并跳过
fn get_cli_arg_value(short: &str, long: &str) -> Option<String> {
    let short_eq = format!("{}=", short);
    let long_eq = format!("{}=", long);
    let args: Vec<String> = std::env::args().collect();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == short || arg == long {
            if let Some(value) = iter.next() {
                if !value.starts_with('-') {
                    return Some(value.clone());
                }
            }
            return None;
        }
        if let Some(value) = arg.strip_prefix(&short_eq) {
            return Some(value.to_string());
        }
        if let Some(value) = arg.strip_prefix(&long_eq) {
            return Some(value.to_string());
        }
    }
    None
}

/// 获取命令行 -i/--instance 参数指定的启动实例名称
#[tauri::command]
pub fn get_start_instance() -> Option<String> {
    get_cli_arg_value("-i", "--instance")
}

/// 检查命令行是否包含 -q/--quit-after-run 参数（任务完成后关闭自身）
#[tauri::command]
pub fn has_quit_after_run_flag() -> bool {
    std::env::args().any(|arg| arg == "-q" || arg == "--quit-after-run")
}

/// 自动迁移旧版注册表自启动到任务计划程序
#[cfg(windows)]
pub fn migrate_legacy_autostart() {
    if has_legacy_registry_autostart() {
        if create_schtask_autostart().is_ok() {
            remove_legacy_registry_autostart();
        }
    }
    // 兼容迁移：老版本已创建的计划任务可能缺少交互式运行或启动延迟，自动重建为新配置
    if schtask_autostart_needs_refresh() {
        if let Err(err) = create_schtask_autostart() {
            warn!("重建自启动计划任务失败: {}", err);
        }
    }
}

#[cfg(windows)]
fn create_schtask_autostart() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
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
            // 登录后延迟 30 秒再启动，降低桌面会话尚未完全就绪时的白屏/卡死概率
            "/delay",
            "0000:30",
            // 强制交互式运行，确保进程绑定到用户桌面会话，避免登录早期会话未就绪导致 WebView 白屏
            "/it",
            "/rl",
            "highest",
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 schtasks 失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("创建计划任务失败: {}", stderr));
    }
    Ok(())
}

/// 判断现有 MXU 自启动计划任务是否需要刷新参数
#[cfg(windows)]
fn schtask_autostart_needs_refresh() -> bool {
    use regex::Regex;

    use std::os::windows::process::CommandExt;
    let output = match std::process::Command::new("schtasks")
        .args(["/query", "/tn", "MXU", "/xml"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return false, // 不存在任务或查询失败，不做迁移
    };

    let xml = String::from_utf8_lossy(&output.stdout);
    let tag_equals = |tag: &str, expected: &str| -> bool {
        let pattern = format!(
            r"(?is)<\s*{}\s*>\s*{}\s*<\s*/\s*{}\s*>",
            regex::escape(tag),
            regex::escape(expected),
            regex::escape(tag)
        );
        Regex::new(&pattern)
            .map(|re| re.is_match(&xml))
            .unwrap_or(false)
    };

    // 尊重用户手动禁用：禁用状态下不自动重建
    let enabled = tag_equals("Enabled", "true");
    if !enabled {
        return false;
    }

    let has_interactive = tag_equals("LogonType", "InteractiveToken");
    let has_delay_30s = tag_equals("Delay", "PT30S");
    !(has_interactive && has_delay_30s)
}

/// 清理旧版注册表自启动条目（tauri-plugin-autostart 遗留）
#[cfg(windows)]
fn remove_legacy_registry_autostart() {
    use winsafe::co::{KEY, REG_OPTION};
    use winsafe::HKEY;

    let key_result = HKEY::CURRENT_USER.RegOpenKeyEx(
        Some(r"Software\Microsoft\Windows\CurrentVersion\Run"),
        REG_OPTION::NoValue,
        KEY::SET_VALUE | KEY::QUERY_VALUE,
    );

    if let Ok(key) = key_result {
        for name in &["mxu", "MXU"] {
            let _ = key.RegDeleteValue(Some(name));
        }
    }
}

/// 检查旧版注册表中是否存在自启动条目
#[cfg(windows)]
fn has_legacy_registry_autostart() -> bool {
    use winsafe::co::{KEY, REG_OPTION};
    use winsafe::HKEY;

    let key_result = HKEY::CURRENT_USER.RegOpenKeyEx(
        Some(r"Software\Microsoft\Windows\CurrentVersion\Run"),
        REG_OPTION::NoValue,
        KEY::QUERY_VALUE,
    );
    if let Ok(key) = key_result {
        ["mxu", "MXU"]
            .iter()
            .any(|name| key.RegQueryValueEx(Some(name)).is_ok())
    } else {
        false
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
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("schtasks")
            .args(["/delete", "/tn", "MXU", "/f"])
            .creation_flags(CREATE_NO_WINDOW)
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
        use std::os::windows::process::CommandExt;
        let schtask = std::process::Command::new("schtasks")
            .args(["/query", "/tn", "MXU"])
            .creation_flags(CREATE_NO_WINDOW)
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

/// 获取当前使用的 WebView2 目录
#[tauri::command]
pub fn get_webview2_dir() -> WebView2DirInfo {
    if let Ok(folder) = std::env::var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER") {
        WebView2DirInfo {
            path: folder,
            system: false,
        }
    } else {
        // 没有设置自定义目录，使用系统 WebView2
        WebView2DirInfo {
            path: String::new(),
            system: true,
        }
    }
}
