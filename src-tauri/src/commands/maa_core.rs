//! Maa 核心命令
//!
//! 提供 MaaFramework 初始化、版本检查、设备搜索、控制器、资源和任务管理

use log::{debug, error, info, warn};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::State;

use maa_framework::controller::{AdbControllerBuilder, Controller};
use maa_framework::resource::Resource;
use maa_framework::tasker::Tasker;
use maa_framework::toolkit::Toolkit;
use maa_framework::MaaStatus;

use super::types::{
    AdbDevice, ConnectionStatus, ControllerConfig, MaaState, TaskStatus, VersionCheckResult,
    Win32Window,
};
use super::utils::{emit_callback_event, get_maafw_dir, handle_task_callback, normalize_path};

/// MaaFramework 最小支持版本
const MIN_MAAFW_VERSION: &str = "5.5.0-beta.1";

/// ControllerPool 复用时的合成 conn_id（负数，避免与 MaaFramework 正数 ID 冲突）
static SYNTHETIC_CONN_ID: AtomicI64 = AtomicI64::new(-1);

fn next_synthetic_conn_id() -> i64 {
    SYNTHETIC_CONN_ID.fetch_sub(1, Ordering::Relaxed)
}

/// 更新实例的 Controller 并清理不再使用的旧 Pool 条目
fn update_instance_controller(
    state: &super::types::MaaState,
    instance_id: &str,
    controller: maa_framework::controller::Controller,
    new_config: super::types::ControllerConfig,
) -> Result<(), String> {
    let cleanup_config = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get_mut(instance_id).ok_or("Instance not found")?;

        let old_config = instance.controller_config.clone();
        instance.controller = Some(controller);
        instance.controller_config = Some(new_config.clone());
        instance.tasker = None;

        old_config.filter(|old| {
            *old != new_config
                && !instances
                    .values()
                    .any(|inst| inst.controller_config.as_ref() == Some(old))
        })
    };

    if let Some(old_cfg) = cleanup_config {
        if let Ok(mut pool) = state.controller_pool.lock() {
            pool.remove(&old_cfg);
            info!("ControllerPool: removed unused entry for old config");
        }
    }

    Ok(())
}

// ============================================================================
// 初始化和版本命令
// ============================================================================

/// 初始化 MaaFramework
/// 如果提供 lib_dir 则使用该路径，否则自动从 exe 目录/maafw 加载
#[tauri::command]
pub fn maa_init(state: State<Arc<MaaState>>, lib_dir: Option<String>) -> Result<String, String> {
    info!("maa_init called, lib_dir: {:?}", lib_dir);

    let lib_path = match lib_dir {
        Some(dir) if !dir.is_empty() => std::path::PathBuf::from(&dir),
        _ => get_maafw_dir()?,
    };

    info!("maa_init using path: {:?}", lib_path);

    if !lib_path.exists() {
        let err = format!(
            "MaaFramework library directory not found: {}",
            lib_path.display()
        );
        error!("{}", err);
        return Err(err);
    }

    // Windows: 将 lib_dir 添加到 DLL 搜索路径，确保依赖 DLL 能被找到
    #[cfg(windows)]
    {
        let dll_dir = if lib_path.is_file() {
            lib_path.parent().unwrap_or(&lib_path)
        } else {
            &lib_path
        };

        debug!("SetDllDirectoryW set to {:?}", dll_dir);
        let result = winsafe::SetDllDirectory(Some(&dll_dir.to_string_lossy()));
        if result.is_err() {
            warn!("SetDllDirectoryW failed");
        }
    }

    // 先设置 lib_dir
    let effective_dir = if lib_path.is_file() {
        lib_path
            .parent()
            .unwrap_or(lib_path.as_path())
            .to_path_buf()
    } else {
        lib_path.clone()
    };
    *state.lib_dir.lock().map_err(|e| e.to_string())? = Some(effective_dir);

    // 加载库
    // 允许用户指定具体的文件路径，或者只指定目录
    let dll_path = if lib_path.is_file() {
        lib_path.clone()
    } else {
        #[cfg(windows)]
        let name = "MaaFramework.dll";
        #[cfg(target_os = "macos")]
        let name = "libMaaFramework.dylib";
        #[cfg(target_os = "linux")]
        let name = "libMaaFramework.so";
        lib_path.join(name)
    };

    match maa_framework::load_library(&dll_path) {
        Ok(()) => info!("maa_init library loaded successfully"),
        Err(e) if e.contains("already loaded") => {
            info!("maa_init library already loaded, skipping");
        }
        Err(e) => return Err(e),
    }

    // 初始化 Toolkit
    // 初始化 Toolkit 配置，user_path 指向应用数据目录
    let data_dir = crate::commands::utils::get_app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let user_path_str = data_dir.to_string_lossy();
    // 确保数据目录存在
    let _ = std::fs::create_dir_all(&data_dir);

    if let Err(e) = Toolkit::init_option(&user_path_str, "{}") {
        warn!("Failed to init toolkit option: {}", e);
    }

    let version = maa_framework::maa_version().to_string();
    info!("maa_init success, version: {}", version);

    Ok(version)
}

/// 设置资源目录
#[tauri::command]
pub fn maa_set_resource_dir(
    state: State<Arc<MaaState>>,
    resource_dir: String,
) -> Result<(), String> {
    info!(
        "maa_set_resource_dir called, resource_dir: {}",
        resource_dir
    );
    *state.resource_dir.lock().map_err(|e| e.to_string())? =
        Some(std::path::PathBuf::from(&resource_dir));
    info!("maa_set_resource_dir success");
    Ok(())
}

/// 获取 MaaFramework 版本
#[tauri::command]
pub fn maa_get_version() -> Result<String, String> {
    debug!("maa_get_version called");
    let version = std::panic::catch_unwind(|| maa_framework::maa_version().to_string())
        .map_err(|_| "MaaFramework library not loaded".to_string())?;
    info!("maa_get_version result: {}", version);
    Ok(version)
}

/// 检查 MaaFramework 版本是否满足最小要求
#[tauri::command]
pub fn maa_check_version(state: State<Arc<MaaState>>) -> Result<VersionCheckResult, String> {
    debug!("maa_check_version called");

    let lib_dir = state.lib_dir.lock().map_err(|e| e.to_string())?.clone();

    if let Some(dir) = lib_dir {
        #[cfg(windows)]
        let dll_path = dir.join("MaaFramework.dll");
        #[cfg(target_os = "macos")]
        let dll_path = dir.join("libMaaFramework.dylib");
        #[cfg(target_os = "linux")]
        let dll_path = dir.join("libMaaFramework.so");

        if let Err(e) = maa_framework::load_library(&dll_path) {
            if !e.contains("already loaded") {
                error!(
                    "Failed to load MaaFramework library from {:?}: {:?}",
                    dll_path, e
                );
                return Err(format!("MaaFramework library failed to load: {}", e));
            }
        }
    }

    let current_str = std::panic::catch_unwind(|| maa_framework::maa_version().to_string())
        .map_err(|_| "MaaFramework library not loaded (panic in maa_version)".to_string())?;

    if current_str == "unknown" || current_str.is_empty() {
        return Err("MaaFramework not initialized".to_string());
    }

    // 去掉版本号前缀 'v'（如 "v5.5.0-beta.1" -> "5.5.0-beta.1"）
    let current_clean = current_str.trim_start_matches('v');
    let min_clean = MIN_MAAFW_VERSION.trim_start_matches('v');

    // 解析最小版本（这个应该总是成功的）
    let minimum = semver::Version::parse(min_clean)
        .map_err(|e| format!("Failed to parse minimum version '{}': {}", min_clean, e))?;

    // 尝试解析当前版本，如果解析失败（如 "DEBUG_VERSION"），视为不兼容
    let is_compatible = semver::Version::parse(current_clean).is_ok_and(|v| v >= minimum);

    Ok(VersionCheckResult {
        current: current_str,
        minimum: format!("v{}", MIN_MAAFW_VERSION),
        is_compatible,
    })
}

// ============================================================================
// 设备搜索命令
// ============================================================================

/// 查找 ADB 设备（结果会缓存到 MaaState）
/// 查找 ADB 设备的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub async fn find_adb_devices_impl(state: Arc<MaaState>) -> Result<Vec<AdbDevice>, String> {
    tokio::task::spawn_blocking(move || {
        let devices = Toolkit::find_adb_devices().map_err(|e| e.to_string())?;

        let result_devices: Vec<AdbDevice> = devices
            .into_iter()
            .map(|d| AdbDevice {
                name: d.name,
                adb_path: d.adb_path.to_string_lossy().to_string(),
                address: d.address,
                screencap_methods: d.screencap_methods,
                input_methods: d.input_methods,
                config: d.config.to_string(),
            })
            .collect();

        if let Ok(mut cached) = state.cached_adb_devices.lock() {
            *cached = result_devices.clone();
        }

        info!("find_adb_devices_impl: {} device(s)", result_devices.len());
        Ok(result_devices)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn maa_find_adb_devices(
    state: State<'_, Arc<MaaState>>,
) -> Result<Vec<AdbDevice>, String> {
    info!("maa_find_adb_devices called");
    find_adb_devices_impl(state.inner().clone()).await
}

/// 查找 Win32 窗口的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub async fn find_win32_windows_impl(
    state: Arc<MaaState>,
    class_regex: Option<String>,
    window_regex: Option<String>,
) -> Result<Vec<Win32Window>, String> {
    tokio::task::spawn_blocking(move || {
        let windows = Toolkit::find_desktop_windows().map_err(|e| e.to_string())?;

        let class_re = class_regex.as_ref().and_then(|r| regex::Regex::new(r).ok());
        let window_re = window_regex
            .as_ref()
            .and_then(|r| regex::Regex::new(r).ok());

        let mut result_windows = Vec::new();

        for w in windows {
            if let Some(re) = &class_re {
                if !re.is_match(&w.class_name) {
                    continue;
                }
            }
            if let Some(re) = &window_re {
                if !re.is_match(&w.window_name) {
                    continue;
                }
            }

            result_windows.push(Win32Window {
                handle: w.hwnd as u64,
                class_name: w.class_name,
                window_name: w.window_name,
            });
        }

        if let Ok(mut cached) = state.cached_win32_windows.lock() {
            *cached = result_windows.clone();
        }

        info!(
            "find_win32_windows_impl: {} window(s)",
            result_windows.len()
        );
        Ok(result_windows)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 查找 WlRoots 可用的 Wayland socket（结果会缓存到 MaaState）
/// 内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub async fn find_wlroots_sockets_impl(state: Arc<MaaState>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        // Linux 平台上，Toolkit::find_desktop_windows 返回项中的 window_name
        // 即为可用的 wayland socket 名称。
        let windows = Toolkit::find_desktop_windows().map_err(|e| e.to_string())?;

        let mut result_sockets = Vec::new();
        for w in windows {
            let socket = w.window_name.trim();
            if !socket.is_empty() {
                result_sockets.push(socket.to_string());
            }
        }

        if let Ok(mut cached) = state.cached_wlroots_sockets.lock() {
            *cached = result_sockets.clone();
        }

        info!(
            "find_wlroots_sockets_impl: {} wlroots socket(s)",
            result_sockets.len()
        );
        Ok(result_sockets)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 查找 Win32 窗口（结果会缓存到 MaaState）
#[tauri::command]
pub async fn maa_find_win32_windows(
    state: State<'_, Arc<MaaState>>,
    class_regex: Option<String>,
    window_regex: Option<String>,
) -> Result<Vec<Win32Window>, String> {
    info!(
        "maa_find_win32_windows called, class_regex: {:?}, window_regex: {:?}",
        class_regex, window_regex
    );
    find_win32_windows_impl(state.inner().clone(), class_regex, window_regex).await
}

/// 查找 WlRoots 可用的 Wayland socket（结果会缓存到 MaaState）
#[tauri::command]
pub async fn maa_find_wlroots_sockets(
    state: State<'_, Arc<MaaState>>,
) -> Result<Vec<String>, String> {
    info!("maa_find_wlroots_sockets called");
    find_wlroots_sockets_impl(state.inner().clone()).await
}

// ============================================================================
// 实例管理命令
// ============================================================================

/// 创建实例（幂等操作，实例已存在时直接返回成功）
#[tauri::command]
pub fn maa_create_instance(state: State<Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    info!("maa_create_instance called, instance_id: {}", instance_id);

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;

    if instances.contains_key(&instance_id) {
        debug!("maa_create_instance: instance already exists, returning success");
        return Ok(());
    }

    instances.insert(
        instance_id.clone(),
        super::types::InstanceRuntime::default(),
    );
    info!("maa_create_instance success, instance_id: {}", instance_id);
    Ok(())
}

/// 销毁实例的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub fn destroy_instance_impl(state: &Arc<MaaState>, instance_id: &str) -> Result<(), String> {
    info!("destroy_instance_impl called, instance_id: {}", instance_id);

    let cleanup_config = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let old_config = instances
            .get(instance_id)
            .and_then(|inst| inst.controller_config.clone());
        let removed = instances.remove(instance_id).is_some();

        if removed {
            info!(
                "destroy_instance_impl success, instance_id: {}",
                instance_id
            );
            old_config.filter(|cfg| {
                !instances
                    .values()
                    .any(|inst| inst.controller_config.as_ref() == Some(cfg))
            })
        } else {
            warn!(
                "destroy_instance_impl: instance not found, instance_id: {}",
                instance_id
            );
            None
        }
    };

    // ControllerPool: 清理不再被任何实例使用的条目
    if let Some(cfg) = cleanup_config {
        if let Ok(mut pool) = state.controller_pool.lock() {
            pool.remove(&cfg);
            info!("ControllerPool: cleaned up entry after instance destroy");
        }
    }

    Ok(())
}

/// 销毁实例
#[tauri::command]
pub fn maa_destroy_instance(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<(), String> {
    info!("maa_destroy_instance called, instance_id: {}", instance_id);
    destroy_instance_impl(&state, &instance_id)
}

// ============================================================================
// 控制器命令
// ============================================================================

/// 连接控制器的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
///
/// `on_event(message, details)` 用于向客户端推送 Maa 回调事件。
pub async fn connect_controller_impl(
    state_arc: Arc<MaaState>,
    instance_id: String,
    config: ControllerConfig,
    on_event: Arc<dyn Fn(&str, &str) + Send + Sync + 'static>,
) -> Result<i64, String> {
    tokio::task::spawn_blocking(move || {
        // ControllerPool: 检查是否有可复用的已连接控制器
        let pooled = {
            let pool = state_arc
                .controller_pool
                .lock()
                .map_err(|e| e.to_string())?;
            pool.get(&config).filter(|c| c.connected()).cloned()
        };

        if let Some(pooled_ctrl) = pooled {
            info!(
                "ControllerPool hit: reusing connected controller for {:?}",
                config
            );

            let conn_id = next_synthetic_conn_id();

            update_instance_controller(&state_arc, &instance_id, pooled_ctrl, config)?;

            // 发送合成回调事件，前端无感知
            let details = format!(r#"{{"ctrl_id":{},"action":"Connect"}}"#, conn_id);
            on_event("Controller.Action.Starting", &details);
            on_event("Controller.Action.Succeeded", &details);

            return Ok(conn_id);
        }

        // Pool 中无可用控制器（不存在或已断连），移除过期条目
        {
            let mut pool = state_arc
                .controller_pool
                .lock()
                .map_err(|e| e.to_string())?;
            pool.remove(&config);
        }

        info!(
            "ControllerPool miss: creating new controller for {:?}",
            config
        );

        let controller = match &config {
            ControllerConfig::Adb {
                adb_path,
                address,
                screencap_methods,
                input_methods,
                config,
            } => {
                let screencap = screencap_methods.parse::<u64>().map_err(|e| {
                    format!("Invalid screencap_methods '{}': {}", screencap_methods, e)
                })?;
                let input = input_methods
                    .parse::<u64>()
                    .map_err(|e| format!("Invalid input_methods '{}': {}", input_methods, e))?;
                let agent_path = get_maafw_dir()
                    .map(|p| p.join("MaaAgentBinary").to_string_lossy().to_string())
                    .unwrap_or_else(|_| "./MaaAgentBinary".to_string());

                AdbControllerBuilder::new(adb_path, address)
                    .screencap_methods(
                        maa_framework::common::AdbScreencapMethod::from_bits_truncate(screencap)
                            .bits(),
                    )
                    .input_methods(
                        maa_framework::common::AdbInputMethod::from_bits_truncate(input).bits(),
                    )
                    .config(config)
                    .agent_path(&agent_path)
                    .build()
                    .map_err(|e| e.to_string())?
            }
            ControllerConfig::Win32 {
                handle,
                screencap_method,
                mouse_method,
                keyboard_method,
            } => {
                let hwnd = *handle as *mut std::ffi::c_void;
                Controller::new_win32(
                    hwnd,
                    maa_framework::common::Win32ScreencapMethod::from_bits_truncate(
                        *screencap_method,
                    )
                    .bits(),
                    maa_framework::common::Win32InputMethod::from_bits_truncate(*mouse_method)
                        .bits(),
                    maa_framework::common::Win32InputMethod::from_bits_truncate(*keyboard_method)
                        .bits(),
                )
                .map_err(|e| e.to_string())?
            }
            ControllerConfig::WlRoots { wlr_socket_path } => {
                Controller::new_wlroots(wlr_socket_path).map_err(|e| e.to_string())?
            }
            ControllerConfig::PlayCover { address, uuid } => {
                let uuid_str = uuid.as_deref().unwrap_or("");
                Controller::new_playcover(address, uuid_str).map_err(|e| e.to_string())?
            }
            ControllerConfig::Gamepad {
                handle,
                gamepad_type,
                screencap_method,
            } => {
                let hwnd = *handle as *mut std::ffi::c_void;
                let gp_type = match gamepad_type.as_deref() {
                    Some("DualShock4") | Some("DS4") => {
                        maa_framework::common::GamepadType::DualShock4
                    }
                    _ => maa_framework::common::GamepadType::Xbox360,
                };
                let screencap = screencap_method
                    .map(|v| maa_framework::common::Win32ScreencapMethod::from_bits_truncate(v))
                    .unwrap_or(maa_framework::common::Win32ScreencapMethod::DXGI_DESKTOP_DUP);

                Controller::new_gamepad(hwnd, gp_type, screencap).map_err(|e| e.to_string())?
            }
        };

        // 注册回调（使用 on_event 抽象，Tauri 命令传入 emit_callback_event，HTTP 处理器传入无操作或 WebSocket 推送）
        let on_event_clone = on_event.clone();
        controller
            .add_sink(move |msg, detail| {
                on_event_clone(msg, detail);
            })
            .map_err(|e| e.to_string())?;

        // 设置默认参数
        if let Err(e) = controller.set_screenshot_target_short_side(720) {
            warn!("Failed to set screenshot target short side to 720: {}", e);
        }

        // 发起连接
        let conn_id = controller.post_connection().map_err(|e| e.to_string())?;

        // 存入 ControllerPool
        {
            let mut pool = state_arc
                .controller_pool
                .lock()
                .map_err(|e| e.to_string())?;
            pool.insert(config.clone(), controller.clone());
        }

        // 更新实例状态
        debug!("Updating instance state...");
        update_instance_controller(&state_arc, &instance_id, controller, config)?;

        Ok(conn_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 连接控制器（异步，通过回调通知完成状态）
/// 返回连接请求 ID，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub async fn maa_connect_controller(
    app: tauri::AppHandle,
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    config: ControllerConfig,
) -> Result<i64, String> {
    info!(
        "maa_connect_controller called, instance_id: {}",
        instance_id
    );

    let app_clone = app.clone();
    let result = connect_controller_impl(
        state.inner().clone(),
        instance_id.clone(),
        config,
        Arc::new(move |msg, detail| emit_callback_event(&app, msg, detail)),
    )
    .await;
    if result.is_ok() {
        super::utils::emit_state_changed(&app_clone, &instance_id, "connected");
    }
    result
}

/// 获取连接状态（通过 MaaControllerConnected API 查询）
#[tauri::command]
pub fn maa_get_connection_status(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<ConnectionStatus, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    if instance.controller.as_ref().is_some_and(|c| c.connected()) {
        Ok(ConnectionStatus::Connected)
    } else {
        Ok(ConnectionStatus::Disconnected)
    }
}

// ============================================================================
// 资源命令
// ============================================================================

/// 加载资源的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub fn load_resource_impl(
    state: &MaaState,
    instance_id: &str,
    paths: &[String],
    on_event: Arc<dyn Fn(&str, &str) + Send + Sync + 'static>,
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<i64>, String> {
    info!(
        "load_resource_impl called, instance: {}, paths: {:?}",
        instance_id, paths
    );

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get_mut(instance_id).ok_or("Instance not found")?;

    // 创建或获取资源
    if instance.resource.is_none() {
        let res = Resource::new().map_err(|e| e.to_string())?;

        // 注册回调
        let on_event_clone = on_event.clone();
        res.add_sink(move |msg, detail| {
            on_event_clone(msg, detail);
        })
        .map_err(|e| e.to_string())?;

        // 注册 MXU Custom Actions
        if let Some(app_handle) = app {
            if let Err(e) =
                crate::mxu_actions::register_all_mxu_actions(&res, app_handle, instance_id)
            {
                warn!("Failed to register MXU custom actions: {}", e);
            }
        }

        instance.resource = Some(res);
    }

    let resource = instance.resource.as_ref().unwrap();
    let mut res_ids = Vec::new();

    for path in paths {
        let normalized = normalize_path(path).to_string_lossy().to_string();
        match resource.post_bundle(&normalized) {
            Ok(job) => {
                info!("Posted resource bundle: {} -> id: {}", normalized, job.id);
                res_ids.push(job.id);
            }
            Err(e) => {
                warn!("Failed to post resource bundle {}: {}", normalized, e);
            }
        }
    }

    Ok(res_ids)
}

/// 加载资源（异步，通过回调通知完成状态）
/// 返回资源加载请求 ID 列表，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub fn maa_load_resource(
    app: tauri::AppHandle,
    state: State<Arc<MaaState>>,
    instance_id: String,
    paths: Vec<String>,
) -> Result<Vec<i64>, String> {
    let res_ids = load_resource_impl(
        &state,
        &instance_id,
        &paths,
        Arc::new({
            let app = app.clone();
            move |msg, detail| emit_callback_event(&app, msg, detail)
        }),
        Some(&app),
    )?;

    super::utils::emit_state_changed(&app, &instance_id, "resource-loading");

    Ok(res_ids)
}

/// 检查资源是否已加载（通过 MaaResourceLoaded API 查询）
#[tauri::command]
pub fn maa_is_resource_loaded(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<bool, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    Ok(instance.resource.as_ref().is_some_and(|r| r.loaded()))
}

/// 销毁资源（用于切换资源时重新创建）
#[tauri::command]
pub fn maa_destroy_resource(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    // 销毁旧的资源
    instance.resource = None;
    instance.tasker = None;

    Ok(())
}

// ============================================================================
// 任务命令
// ============================================================================

/// 运行任务（异步，通过回调通知完成状态）
/// 运行单个任务的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub fn run_task_impl(
    app: &tauri::AppHandle,
    state: &Arc<MaaState>,
    instance_id: &str,
    entry: &str,
    pipeline_override: &str,
    selected_task_id: Option<&str>,
) -> Result<i64, String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get_mut(instance_id).ok_or("Instance not found")?;

    let resource = instance.resource.as_ref().ok_or("Resource not loaded")?;
    let controller = instance
        .controller
        .as_ref()
        .ok_or("Controller not connected")?;

    // 创建或获取 tasker
    let needs_new_tasker = match instance.tasker.as_ref() {
        None => true,
        Some(t) => !t.inited(),
    };
    if needs_new_tasker {
        if instance.tasker.is_some() {
            warn!("[run_task] Existing tasker is not initialized, discarding and rebuilding...");
            instance.tasker = None;
        }

        let tasker = Tasker::new().map_err(|e| e.to_string())?;

        let app_for_sink = app.clone();
        let maa_state_for_sink = Arc::clone(state);
        let instance_id_for_sink = instance_id.to_string();
        tasker
            .add_sink(move |msg, detail| {
                handle_task_callback(
                    &maa_state_for_sink,
                    &app_for_sink,
                    &instance_id_for_sink,
                    msg,
                    detail,
                );
                emit_callback_event(&app_for_sink, msg, detail);
            })
            .map_err(|e| e.to_string())?;

        let app_for_context_sink = app.clone();
        tasker
            .add_context_sink(move |msg, detail| {
                emit_callback_event(&app_for_context_sink, msg, detail);
            })
            .map_err(|e| e.to_string())?;

        tasker
            .bind(resource, controller)
            .map_err(|e| e.to_string())?;

        instance.tasker = Some(tasker);
    }

    let tasker = instance.tasker.as_ref().unwrap();

    if !tasker.inited() {
        return Err("Tasker not initialized even after rebuild".to_string());
    }

    let job = tasker
        .post_task(entry, pipeline_override)
        .map_err(|e| e.to_string())?;
    let task_id = job.id;

    if !instance.task_ids.contains(&task_id) {
        instance.task_ids.push(task_id);
    }

    if let Some(selected_task_id) = selected_task_id {
        let task_run_state = &mut instance.task_run_state;
        if !task_run_state.pending_task_ids.contains(&task_id) {
            task_run_state.pending_task_ids.push(task_id);
        }
        task_run_state
            .mappings
            .insert(task_id, selected_task_id.to_string());
        task_run_state
            .statuses
            .insert(selected_task_id.to_string(), "pending".to_string());
        task_run_state.overall_status = Some("Running".to_string());
    }

    Ok(task_id)
}

/// 运行单个任务
/// 返回任务 ID，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub fn maa_run_task(
    app: tauri::AppHandle,
    state: State<Arc<MaaState>>,
    instance_id: String,
    entry: String,
    pipeline_override: String,
    selected_task_id: Option<String>,
) -> Result<i64, String> {
    info!("maa_run_task called, entry: {}", entry);
    let app_clone = app.clone();
    let result = run_task_impl(
        &app,
        &state,
        &instance_id,
        &entry,
        &pipeline_override,
        selected_task_id.as_deref(),
    );
    if result.is_ok() {
        super::utils::emit_state_changed(&app_clone, &instance_id, "task-started");
    }
    result
}

/// 获取任务状态
#[tauri::command]
pub fn maa_get_task_status(
    state: State<Arc<MaaState>>,
    instance_id: String,
    task_id: i64,
) -> Result<TaskStatus, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;
    let tasker = instance.tasker.as_ref().ok_or("Tasker not created")?;

    let status = tasker
        .get_task_detail(task_id)
        .map_err(|e| e.to_string())?
        .map(|d| d.status)
        .unwrap_or(MaaStatus::INVALID);

    let result = match status {
        MaaStatus::PENDING => TaskStatus::Pending,
        MaaStatus::RUNNING => TaskStatus::Running,
        MaaStatus::SUCCEEDED => TaskStatus::Succeeded,
        _ => TaskStatus::Failed,
    };

    Ok(result)
}

/// 停止任务
/// 停止任务的内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub fn stop_task_impl(state: &MaaState, instance_id: &str) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get_mut(instance_id).ok_or("Instance not found")?;
    let tasker = instance.tasker.as_ref().ok_or("Tasker not created")?;

    if instance.stop_in_progress {
        if !tasker.running() {
            instance.stop_in_progress = false;
            instance.stop_started_at = None;
            return Ok(());
        }
        let elapsed = instance
            .stop_started_at
            .map(|t| t.elapsed())
            .unwrap_or(Duration::from_secs(0));
        if elapsed < Duration::from_millis(500) {
            return Ok(());
        }
    }

    instance.stop_in_progress = true;
    instance.stop_started_at = Some(Instant::now());
    instance.task_ids.clear();

    // 将剩余 pending 任务标记为 failed，更新整体状态
    {
        let state = &mut instance.task_run_state;
        for status in state.statuses.values_mut() {
            if status == "pending" || status == "running" {
                *status = "failed".to_string();
            }
        }
        state.overall_status = Some("Failed".to_string());
    }

    tasker.post_stop().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn maa_stop_task(
    app: tauri::AppHandle,
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<(), String> {
    let result = stop_task_impl(&state, &instance_id);
    if result.is_ok() {
        super::utils::emit_state_changed(&app, &instance_id, "task-stopped");
    }
    result
}

/// 覆盖已提交任务的 Pipeline 配置（用于运行中修改尚未执行的任务选项）
/// 内部实现（可从 Tauri 命令和 HTTP 处理器共享调用）
pub fn override_pipeline_impl(
    state: &Arc<MaaState>,
    instance_id: &str,
    task_id: i64,
    pipeline_override: &str,
) -> Result<bool, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(instance_id).ok_or("Instance not found")?;
    let tasker = instance.tasker.as_ref().ok_or("Tasker not created")?;

    tasker
        .override_pipeline(task_id, pipeline_override)
        .map_err(|e| e.to_string())
}

/// 覆盖已提交任务的 Pipeline 配置（用于运行中修改尚未执行的任务选项）
#[tauri::command]
pub fn maa_override_pipeline(
    state: State<Arc<MaaState>>,
    instance_id: String,
    task_id: i64,
    pipeline_override: String,
) -> Result<bool, String> {
    override_pipeline_impl(&state, &instance_id, task_id, &pipeline_override)
}

/// 检查是否正在运行
#[tauri::command]
pub fn maa_is_running(state: State<Arc<MaaState>>, instance_id: String) -> Result<bool, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    Ok(instance.tasker.as_ref().is_some_and(|t| t.running()))
}

// ============================================================================
// 控制器输入命令
// ============================================================================

/// 发起点击请求（内部实现）
pub fn post_click_impl(state: &MaaState, instance_id: &str, x: i32, y: i32) -> Result<i64, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(instance_id).ok_or("Instance not found")?;
    let controller = instance
        .controller
        .as_ref()
        .ok_or("Controller not connected")?;
    controller.post_click(x, y).map_err(|e| e.to_string())
}

/// 发起点击请求
#[tauri::command]
pub fn maa_post_click(
    state: State<Arc<MaaState>>,
    instance_id: String,
    x: i32,
    y: i32,
) -> Result<i64, String> {
    post_click_impl(&state, &instance_id, x, y)
}

// ============================================================================
// 截图命令
// ============================================================================

/// 发起截图请求（内部实现）
pub fn post_screencap_impl(state: &MaaState, instance_id: &str) -> Result<i64, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(instance_id).ok_or("Instance not found")?;
    let controller = instance
        .controller
        .as_ref()
        .ok_or("Controller not connected")?;
    controller.post_screencap().map_err(|e| e.to_string())
}

/// 发起截图请求
#[tauri::command]
pub fn maa_post_screencap(state: State<Arc<MaaState>>, instance_id: String) -> Result<i64, String> {
    post_screencap_impl(&state, &instance_id)
}

/// 获取缓存的截图（内部实现，返回 base64 编码的 PNG 图像）
pub fn get_cached_image_impl(state: &MaaState, instance_id: &str) -> Result<String, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(instance_id).ok_or("Instance not found")?;
    let controller = instance
        .controller
        .as_ref()
        .ok_or("Controller not connected")?;

    let buffer = controller.cached_image().map_err(|e| e.to_string())?;
    let data = buffer
        .to_vec()
        .ok_or("Failed to convert image buffer".to_string())?;

    if data.is_empty() {
        return Err("No image data available".to_string());
    }

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let base64_str = STANDARD.encode(&data);
    Ok(format!("data:image/png;base64,{}", base64_str))
}

/// 获取缓存的截图（返回 base64 编码的 PNG 图像）
#[tauri::command]
pub fn maa_get_cached_image(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<String, String> {
    get_cached_image_impl(&state, &instance_id)
}

/// 订阅实例的实时截图（后端统一驱动截图循环）
///
/// 多个客户端可同时订阅同一实例，后端按最快订阅者的帧率驱动唯一一份截图循环。
/// 前端通过 `maa_get_cached_image` 获取最新缓存截图，无需自行调用 `maa_post_screencap`。
///
/// 必须为 async command：确保在 tokio 上下文中运行，以便获取 Handle 用于 spawn 截图循环。
#[tauri::command]
pub async fn maa_screenshot_subscribe(
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    subscriber_id: String,
    interval_ms: u64,
) -> Result<(), String> {
    let handle = tokio::runtime::Handle::current();
    state.screenshot_service.subscribe(
        state.inner().clone(),
        instance_id,
        subscriber_id,
        interval_ms,
        handle,
    );
    Ok(())
}

/// 取消实例的实时截图订阅
#[tauri::command]
pub async fn maa_screenshot_unsubscribe(
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    subscriber_id: String,
) -> Result<(), String> {
    state
        .screenshot_service
        .unsubscribe(&instance_id, &subscriber_id);
    Ok(())
}
