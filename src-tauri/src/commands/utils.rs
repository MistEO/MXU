//! 辅助函数
//!
//! 提供路径处理和其他通用工具函数

use super::types::MaaCallbackEvent;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

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
/// - Android: /data/data/<package>/files/ (通过环境变量或回退路径)
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

    #[cfg(target_os = "android")]
    {
        get_android_data_dir()
    }

    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    {
        // Windows/Linux 保持便携式，使用 exe 所在目录
        get_exe_directory()
    }
}

/// Android 数据目录获取
/// 优先使用 TAURI_ANDROID_DATA_DIR (由 Tauri 框架在启动时设置),
/// 回退到 /data/data/com.misteo.mxu/files
#[cfg(target_os = "android")]
fn get_android_data_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("TAURI_ANDROID_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    // 回退路径：Android app 内部存储
    let fallback = PathBuf::from("/data/data/com.misteo.mxu/files");
    if fallback.exists() {
        return Ok(fallback);
    }
    // 最终回退：使用 Android 标准 app data 目录模式
    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home));
    }
    Err("无法确定 Android 数据目录".to_string())
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
/// Android 上回退到数据目录
pub fn get_exe_directory() -> Result<PathBuf, String> {
    #[cfg(not(target_os = "android"))]
    {
        let exe_path =
            std::env::current_exe().map_err(|e| format!("获取 exe 路径失败: {}", e))?;
        exe_path
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法获取 exe 所在目录".to_string())
    }

    #[cfg(target_os = "android")]
    {
        get_app_data_dir()
    }
}

/// 获取 MaaFramework 库目录
/// - 桌面端: exe 目录下的 maafw 子目录
/// - Android: native library 目录 (jniLibs 解压后的路径)
pub fn get_maafw_dir() -> Result<PathBuf, String> {
    #[cfg(not(target_os = "android"))]
    {
        Ok(get_exe_directory()?.join("maafw"))
    }

    #[cfg(target_os = "android")]
    {
        // Android 上 .so 库打包在 APK 的 jniLibs 中，
        // 安装后位于 nativeLibraryDir
        if let Ok(lib_dir) = std::env::var("TAURI_ANDROID_NATIVE_LIB_DIR") {
            return Ok(PathBuf::from(lib_dir));
        }
        // 回退：尝试从 /proc/self/maps 中推断 native lib 路径
        if let Ok(maps) = std::fs::read_to_string("/proc/self/maps") {
            for line in maps.lines() {
                if line.contains("libmxu_lib.so") {
                    if let Some(path) = line.split_whitespace().last() {
                        if let Some(parent) = std::path::Path::new(path).parent() {
                            return Ok(parent.to_path_buf());
                        }
                    }
                }
            }
        }
        // 最终回退：应用数据目录下的 maafw
        Ok(get_app_data_dir()?.join("maafw"))
    }
}

/// 构建 User-Agent 字符串
pub fn build_user_agent() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let tauri_version = tauri::VERSION;
    format!(
        "MXU/{} ({}; {}) Tauri/{}",
        version, os, arch, tauri_version
    )
}
