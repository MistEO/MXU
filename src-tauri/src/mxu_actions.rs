//! MXU 内置 Custom Actions
//!
//! 提供 MXU 特有的自定义动作实现，如 MXU_SLEEP 等

use chrono::TimeZone;
use log::{info, warn};
use maa_framework::custom::FnAction;
use maa_framework::resource::Resource;

// ============================================================================
// MXU_SLEEP Custom Action
// ============================================================================

/// MXU_SLEEP 动作名称常量
const MXU_SLEEP_ACTION: &str = "MXU_SLEEP_ACTION";

/// MXU_SLEEP custom action 回调函数
/// 从 custom_action_param 中读取 sleep_time（秒），执行等待操作
fn mxu_sleep_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_SLEEP] Received param: {}", param_str);

    // 解析 JSON 获取 sleep_time
    let sleep_seconds: u64 = match serde_json::from_str::<serde_json::Value>(param_str) {
        Ok(json) => json.get("sleep_time").and_then(|v| v.as_u64()).unwrap_or(5),
        Err(e) => {
            warn!(
                "[MXU_SLEEP] Failed to parse param JSON: {}, using default 5s",
                e
            );
            5
        }
    };

    info!("[MXU_SLEEP] Sleeping for {} seconds...", sleep_seconds);

    // 执行睡眠
    std::thread::sleep(std::time::Duration::from_secs(sleep_seconds));

    info!("[MXU_SLEEP] Sleep completed");
    true
}

// ============================================================================
// MXU_WAITUNTIL Custom Action
// ============================================================================

/// MXU_WAITUNTIL 动作名称常量
const MXU_WAITUNTIL_ACTION: &str = "MXU_WAITUNTIL_ACTION";

/// MXU_WAITUNTIL custom action 回调函数
/// 从 custom_action_param 中读取 target_time（HH:MM 格式），等待到该时间点
/// 仅支持 24 小时内：若目标时间已过则等待到次日该时间
fn mxu_waituntil_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_WAITUNTIL] Received param: {}", param_str);

    let Ok(json) = serde_json::from_str::<serde_json::Value>(param_str) else {
        warn!("[MXU_WAITUNTIL] Failed to parse param JSON");
        return false;
    };

    let Some(target_time) = json
        .get("target_time")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
    else {
        warn!("[MXU_WAITUNTIL] Missing or empty 'target_time' parameter");
        return false;
    };
    let target_time = target_time.to_string();

    // 解析 HH:MM 格式
    let parts: Vec<&str> = target_time.split(':').collect();
    if parts.len() < 2 {
        warn!("[MXU_WAITUNTIL] Invalid time format: {}", target_time);
        return false;
    }

    let target_hour: u32 = match parts[0].parse() {
        Ok(h) if h < 24 => h,
        _ => {
            warn!("[MXU_WAITUNTIL] Invalid hour: {}", parts[0]);
            return false;
        }
    };

    let target_minute: u32 = match parts[1].parse() {
        Ok(m) if m < 60 => m,
        _ => {
            warn!("[MXU_WAITUNTIL] Invalid minute: {}", parts[1]);
            return false;
        }
    };

    // 计算当前时间与目标时间的差值
    let now = chrono::Local::now();
    let today_target = now
        .date_naive()
        .and_hms_opt(target_hour, target_minute, 0)
        .unwrap();
    let today_target = match chrono::Local.from_local_datetime(&today_target).single() {
        Some(dt) => dt,
        None => {
            warn!(
                "[MXU_WAITUNTIL] Ambiguous or invalid local time for target {:02}:{:02}, falling back to current time",
                target_hour, target_minute
            );
            now
        }
    };

    let wait_duration = if today_target > now {
        today_target - now
    } else {
        // 目标时间已过，等到明天
        let tomorrow_target = today_target + chrono::Duration::days(1);
        tomorrow_target - now
    };

    let wait_secs = wait_duration.num_seconds().max(0) as u64;
    info!(
        "[MXU_WAITUNTIL] Waiting until {}:{:02} ({}s from now)",
        target_hour, target_minute, wait_secs
    );

    std::thread::sleep(std::time::Duration::from_secs(wait_secs));

    info!("[MXU_WAITUNTIL] Wait completed, target time reached");
    true
}

// ============================================================================
// MXU_LAUNCH Custom Action
// ============================================================================

/// MXU_LAUNCH 动作名称常量
const MXU_LAUNCH_ACTION: &str = "MXU_LAUNCH_ACTION";

/// MXU_LAUNCH custom action 回调函数
/// 从 custom_action_param 中读取 program, args, wait_for_exit，启动外部程序
fn mxu_launch_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_LAUNCH] Received param: {}", param_str);

    let json: serde_json::Value = match serde_json::from_str(param_str) {
        Ok(v) => v,
        Err(e) => {
            warn!("[MXU_LAUNCH] Failed to parse param JSON: {}", e);
            return false;
        }
    };

    let program = match json.get("program").and_then(|v| v.as_str()) {
        Some(p) if !p.trim().is_empty() => p.to_string(),
        _ => {
            warn!("[MXU_LAUNCH] Missing or empty 'program' parameter");
            return false;
        }
    };

    let args_str = json
        .get("args")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let wait_for_exit = json
        .get("wait_for_exit")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    info!(
        "[MXU_LAUNCH] Launching: program={}, args={}, wait_for_exit={}",
        program, args_str, wait_for_exit
    );

    let args_vec: Vec<String> = if args_str.trim().is_empty() {
        Vec::new()
    } else {
        match shell_words::split(&args_str) {
            Ok(parsed) => parsed,
            Err(e) => {
                warn!(
                    "[MXU_LAUNCH] Failed to parse arguments with shell_words ({}); falling back to whitespace split: {}",
                    e, args_str
                );
                args_str.split_whitespace().map(|s| s.to_string()).collect()
            }
        }
    };

    let mut cmd = std::process::Command::new(&program);

    if !args_vec.is_empty() {
        cmd.args(&args_vec);
    }

    // 默认使用程序所在目录作为工作目录
    if let Some(parent) = std::path::Path::new(&program).parent() {
        if parent.exists() {
            cmd.current_dir(parent);
        }
    }

    if wait_for_exit {
        match cmd.status() {
            Ok(status) => {
                let exit_code = status.code().unwrap_or(-1);
                info!("[MXU_LAUNCH] Process exited with code: {}", exit_code);
                true
            }
            Err(e) => {
                log::error!("[MXU_LAUNCH] Failed to run program: {}", e);
                false
            }
        }
    } else {
        match cmd.spawn() {
            Ok(_) => {
                info!("[MXU_LAUNCH] Process spawned (not waiting)");
                true
            }
            Err(e) => {
                log::error!("[MXU_LAUNCH] Failed to spawn program: {}", e);
                false
            }
        }
    }
}

// ============================================================================
// MXU_WEBHOOK Custom Action
// ============================================================================

/// MXU_WEBHOOK 动作名称常量
const MXU_WEBHOOK_ACTION: &str = "MXU_WEBHOOK_ACTION";

/// MXU_WEBHOOK custom action 回调函数
/// 从 custom_action_param 中读取 url，执行 HTTP GET 请求
fn mxu_webhook_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_WEBHOOK] Received param: {}", param_str);

    let json: serde_json::Value = match serde_json::from_str(param_str) {
        Ok(v) => v,
        Err(e) => {
            warn!("[MXU_WEBHOOK] Failed to parse param JSON: {}", e);
            return false;
        }
    };

    let url = match json.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.trim().is_empty() => u.to_string(),
        _ => {
            warn!("[MXU_WEBHOOK] Missing or empty 'url' parameter");
            return false;
        }
    };

    info!("[MXU_WEBHOOK] Sending GET request to: {}", url);

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::error!("[MXU_WEBHOOK] Failed to build HTTP client: {}", e);
            return false;
        }
    };

    match client.get(&url).send() {
        Ok(resp) => {
            let status = resp.status();
            info!("[MXU_WEBHOOK] Response status: {}", status);
            if status.is_success() {
                true
            } else {
                warn!("[MXU_WEBHOOK] Non-success status code: {}", status);
                true // 仍然返回成功，只要请求发出去了
            }
        }
        Err(e) => {
            log::error!("[MXU_WEBHOOK] Request failed: {}", e);
            false
        }
    }
}

// ============================================================================
// MXU_NOTIFY Custom Action
// ============================================================================

/// MXU_NOTIFY 动作名称常量
const MXU_NOTIFY_ACTION: &str = "MXU_NOTIFY_ACTION";

/// MXU_NOTIFY custom action 回调函数
/// 从 custom_action_param 中读取 title, body，发送系统通知
fn mxu_notify_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_NOTIFY] Received param: {}", param_str);

    let json: serde_json::Value = match serde_json::from_str(param_str) {
        Ok(v) => v,
        Err(e) => {
            warn!("[MXU_NOTIFY] Failed to parse param JSON: {}", e);
            return false;
        }
    };

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("MXU")
        .to_string();

    let body = json
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    info!(
        "[MXU_NOTIFY] Sending notification: title={}, body={}",
        title, body
    );

    match notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .show()
    {
        Ok(_) => {
            info!("[MXU_NOTIFY] Notification sent successfully");
            true
        }
        Err(e) => {
            log::error!("[MXU_NOTIFY] Failed to send notification: {}", e);
            false
        }
    }
}

// ============================================================================
// MXU_KILLPROC Custom Action
// ============================================================================

/// MXU_KILLPROC 动作名称常量
const MXU_KILLPROC_ACTION: &str = "MXU_KILLPROC_ACTION";

/// MXU_KILLPROC custom action 回调函数
/// 从 custom_action_param 中读取 kill_self, process_name，结束进程
fn mxu_killproc_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_KILLPROC] Received param: {}", param_str);

    let json: serde_json::Value = match serde_json::from_str(param_str) {
        Ok(v) => v,
        Err(e) => {
            warn!("[MXU_KILLPROC] Failed to parse param JSON: {}", e);
            return false;
        }
    };

    let kill_self = json
        .get("kill_self")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if kill_self {
        info!("[MXU_KILLPROC] Killing self process");
        // 获取当前可执行文件名
        let exe_name = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()));

        if let Some(name) = exe_name {
            info!("[MXU_KILLPROC] Current exe: {}", name);
            kill_process_by_name(&name)
        } else {
            warn!("[MXU_KILLPROC] Could not determine current exe name, using process::exit");
            std::process::exit(0);
        }
    } else {
        let process_name = match json.get("process_name").and_then(|v| v.as_str()) {
            Some(p) if !p.trim().is_empty() => p.to_string(),
            _ => {
                warn!("[MXU_KILLPROC] Missing or empty 'process_name' parameter");
                return false;
            }
        };

        info!("[MXU_KILLPROC] Killing process: {}", process_name);
        kill_process_by_name(&process_name)
    }
}

/// 按名称结束进程
fn kill_process_by_name(name: &str) -> bool {
    use std::process::Command;

    #[cfg(windows)]
    {
        match Command::new("taskkill").args(["/F", "/IM", name]).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                if output.status.success() {
                    info!("[MXU_KILLPROC] taskkill succeeded: {}", stdout.trim());
                    true
                } else {
                    warn!(
                        "[MXU_KILLPROC] taskkill failed: stdout={}, stderr={}",
                        stdout.trim(),
                        stderr.trim()
                    );
                    false
                }
            }
            Err(e) => {
                log::error!("[MXU_KILLPROC] Failed to execute taskkill: {}", e);
                false
            }
        }
    }

    #[cfg(not(windows))]
    {
        // macOS / Linux: 使用 killall，失败则 fallback 到 pkill
        match Command::new("killall").arg(name).output() {
            Ok(output) => {
                if output.status.success() {
                    info!("[MXU_KILLPROC] killall succeeded");
                    true
                } else {
                    match Command::new("pkill").arg("-f").arg(name).output() {
                        Ok(o) if o.status.success() => {
                            info!("[MXU_KILLPROC] pkill succeeded");
                            true
                        }
                        _ => {
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            warn!("[MXU_KILLPROC] killall/pkill failed: {}", stderr.trim());
                            false
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("[MXU_KILLPROC] Failed to execute killall: {}", e);
                false
            }
        }
    }
}

// ============================================================================
// MXU_POWER Custom Action
// ============================================================================

/// MXU_POWER 动作名称常量
const MXU_POWER_ACTION: &str = "MXU_POWER_ACTION";

/// MXU_POWER custom action 回调函数
/// 从 custom_action_param 中读取 power_action，执行关机/重启/息屏/睡眠操作
fn mxu_power_action_fn(
    _ctx: &maa_framework::context::Context,
    args: &maa_framework::custom::ActionArgs,
) -> bool {
    let param_str = args.param;
    info!("[MXU_POWER] Received param: {}", param_str);

    let json: serde_json::Value = match serde_json::from_str(param_str) {
        Ok(v) => v,
        Err(e) => {
            warn!("[MXU_POWER] Failed to parse param JSON: {}", e);
            return false;
        }
    };

    let action = json
        .get("power_action")
        .and_then(|v| v.as_str())
        .unwrap_or("shutdown");

    info!("[MXU_POWER] Executing power action: {}", action);

    match action {
        "shutdown" => execute_power_shutdown(),
        "restart" => execute_power_restart(),
        "screenoff" => execute_power_screenoff(),
        "sleep" => execute_power_sleep(),
        _ => {
            warn!("[MXU_POWER] Unknown power action: {}", action);
            false
        }
    }
}

fn execute_power_shutdown() -> bool {
    use std::process::Command;

    #[cfg(windows)]
    {
        match Command::new("shutdown")
            .args(["/s", "/f", "/t", "0"])
            .spawn()
        {
            Ok(_) => {
                info!("[MXU_POWER] Shutdown command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Shutdown failed: {}", e);
                false
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        match Command::new("osascript")
            .args(["-e", "tell app \"System Events\" to shut down"])
            .spawn()
        {
            Ok(_) => {
                info!("[MXU_POWER] Shutdown command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Shutdown failed: {}", e);
                false
            }
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        match Command::new("systemctl").arg("poweroff").spawn() {
            Ok(_) => {
                info!("[MXU_POWER] Shutdown command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Shutdown failed: {}", e);
                false
            }
        }
    }
}

fn execute_power_restart() -> bool {
    use std::process::Command;

    #[cfg(windows)]
    {
        match Command::new("shutdown")
            .args(["/r", "/f", "/t", "0"])
            .spawn()
        {
            Ok(_) => {
                info!("[MXU_POWER] Restart command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Restart failed: {}", e);
                false
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        match Command::new("osascript")
            .args(["-e", "tell app \"System Events\" to restart"])
            .spawn()
        {
            Ok(_) => {
                info!("[MXU_POWER] Restart command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Restart failed: {}", e);
                false
            }
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        match Command::new("systemctl").arg("reboot").spawn() {
            Ok(_) => {
                info!("[MXU_POWER] Restart command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Restart failed: {}", e);
                false
            }
        }
    }
}

fn execute_power_screenoff() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::SendMessageW;

        // WM_SYSCOMMAND = 0x0112, SC_MONITORPOWER = 0xF170, LPARAM(2) = turn off
        const WM_SYSCOMMAND: u32 = 0x0112;
        const SC_MONITORPOWER: usize = 0xF170;

        unsafe {
            SendMessageW(
                HWND(0xFFFF as *mut std::ffi::c_void), // HWND_BROADCAST
                WM_SYSCOMMAND,
                windows::Win32::Foundation::WPARAM(SC_MONITORPOWER),
                windows::Win32::Foundation::LPARAM(2), // 2 = turn off monitor
            );
        }
        info!("[MXU_POWER] Screen off command issued (Windows)");
        true
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        match Command::new("pmset").arg("displaysleepnow").spawn() {
            Ok(_) => {
                info!("[MXU_POWER] Screen off command issued (macOS)");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Screen off failed: {}", e);
                false
            }
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        use std::process::Command;
        match Command::new("xset").args(["dpms", "force", "off"]).spawn() {
            Ok(_) => {
                info!("[MXU_POWER] Screen off command issued (Linux)");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Screen off failed: {}", e);
                false
            }
        }
    }
}

fn execute_power_sleep() -> bool {
    use std::process::Command;

    #[cfg(windows)]
    {
        match Command::new("rundll32.exe")
            .args(["powrprof.dll,SetSuspendState", "0,1,0"])
            .spawn()
        {
            Ok(_) => {
                info!("[MXU_POWER] Sleep command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Sleep failed: {}", e);
                false
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        match Command::new("pmset").arg("sleepnow").spawn() {
            Ok(_) => {
                info!("[MXU_POWER] Sleep command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Sleep failed: {}", e);
                false
            }
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        match Command::new("systemctl").arg("suspend").spawn() {
            Ok(_) => {
                info!("[MXU_POWER] Sleep command issued");
                true
            }
            Err(e) => {
                log::error!("[MXU_POWER] Sleep failed: {}", e);
                false
            }
        }
    }
}

// ============================================================================
// 注册入口
// ============================================================================

/// 为资源注册所有 MXU 内置 custom actions
/// 在资源创建后调用此函数
pub fn register_all_mxu_actions(resource: &Resource) -> Result<(), String> {
    let mut failed_count = 0;

    // 定义一个局部宏打印日志并统计失败
    macro_rules! reg_action {
        ($name:expr, $fn_name:expr) => {
            if let Err(e) =
                resource.register_custom_action($name, Box::new(FnAction::new($fn_name)))
            {
                warn!("[MXU] Failed to register {}: {:?}", $name, e);
                failed_count += 1;
            } else {
                info!("[MXU] Custom action {} registered successfully", $name);
            }
        };
    }

    reg_action!(MXU_SLEEP_ACTION, mxu_sleep_action_fn);
    reg_action!(MXU_WAITUNTIL_ACTION, mxu_waituntil_action_fn);
    reg_action!(MXU_LAUNCH_ACTION, mxu_launch_action_fn);
    reg_action!(MXU_WEBHOOK_ACTION, mxu_webhook_action_fn);
    reg_action!(MXU_NOTIFY_ACTION, mxu_notify_action_fn);
    reg_action!(MXU_KILLPROC_ACTION, mxu_killproc_action_fn);
    reg_action!(MXU_POWER_ACTION, mxu_power_action_fn);

    if failed_count > 0 {
        return Err(format!(
            "Failed to register {} custom actions",
            failed_count
        ));
    }

    Ok(())
}
