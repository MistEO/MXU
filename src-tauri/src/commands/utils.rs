//! 辅助函数
//!
//! 提供路径处理和其他通用工具函数

use super::types::{MaaCallbackEvent, StateChangedEvent};
use crate::ws_broadcast::{WsBroadcast, WsEvent};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// 发送回调事件到前端（Tauri WebView + WebSocket 浏览器客户端）
pub fn emit_callback_event<S: Into<String>>(app: &AppHandle, message: S, details: S) {
    let message = message.into();
    let details = details.into();

    // 广播到所有 WebSocket 客户端
    if let Some(ws) = app.try_state::<Arc<WsBroadcast>>() {
        ws.send(WsEvent::MaaCallback {
            message: message.clone(),
            details: details.clone(),
        });
    }

    // 发送到 Tauri WebView
    let event = MaaCallbackEvent { message, details };
    if let Err(e) = app.emit("maa-callback", event) {
        log::error!("Failed to emit maa-callback: {}", e);
    }
}

/// 发送实例状态变更事件（双通道：WS 浏览器客户端 + Tauri WebView）
///
/// Tauri 端和 WebUI 端都会收到此事件，用于刷新 `isRunning`、连接状态等运行时信息。
pub fn emit_state_changed(app: &AppHandle, instance_id: &str, kind: &str) {
    // 广播到所有 WebSocket 客户端
    if let Some(ws) = app.try_state::<Arc<WsBroadcast>>() {
        ws.send(WsEvent::StateChanged {
            instance_id: instance_id.to_string(),
            kind: kind.to_string(),
        });
    }

    // 发送到 Tauri WebView
    let event = StateChangedEvent {
        instance_id: instance_id.to_string(),
        kind: kind.to_string(),
    };
    if let Err(e) = app.emit("state-changed", event) {
        log::error!("Failed to emit state-changed: {}", e);
    }
}

/// 发送配置变更事件（双通道：WS 浏览器客户端 + Tauri WebView）
///
/// 各客户端收到后应重新拉取配置并 `importConfig`（需配合 `consumeSelfSave` 跳过自身触发）。
pub fn emit_config_changed(app: &AppHandle) {
    // 广播到所有 WebSocket 客户端
    if let Some(ws) = app.try_state::<Arc<WsBroadcast>>() {
        ws.send(WsEvent::ConfigChanged);
    }

    // 发送到 Tauri WebView
    if let Err(e) = app.emit("config-changed-external", ()) {
        log::error!("Failed to emit config-changed-external: {}", e);
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

/// 构建启动程序的 Command
///
/// - 子进程的 stdout/stderr 设为 null，避免继承父进程的标准流。
/// - 当 `use_cmd` 为 true 时（仅 Windows），通过 `cmd /c` 启动并设置
///   `CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB` 标志，隐藏控制台窗口
///   且使子进程脱离父进程 job 对象。
pub fn build_launch_command(
    program: &str,
    args: &[String],
    use_cmd: bool,
) -> std::process::Command {
    use std::process::Stdio;

    let mut cmd = if cfg!(target_os = "windows") && use_cmd {
        let mut c = std::process::Command::new("cmd.exe");
        c.arg("/c").arg(program);
        if !args.is_empty() {
            c.args(args);
        }
        c
    } else {
        let mut c = std::process::Command::new(program);
        if !args.is_empty() {
            c.args(args);
        }
        c
    };

    // 不继承父进程的标准流
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    if use_cmd {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
    }

    cmd
}
