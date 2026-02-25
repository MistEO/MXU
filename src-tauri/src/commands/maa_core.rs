//! Maa 核心命令
//!
//! 提供 MaaFramework 初始化、版本检查、设备搜索、控制器、资源和任务管理

use log::{debug, error, info, warn};
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
use super::utils::{emit_callback_event, get_maafw_dir, normalize_path};

/// MaaFramework 最小支持版本
const MIN_MAAFW_VERSION: &str = "5.5.0-beta.1";

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
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn SetDllDirectoryW(path: *const u16) -> i32;
        }

        let dll_dir = if lib_path.is_file() {
            lib_path.parent().unwrap_or(&lib_path)
        } else {
            &lib_path
        };

        let wide_path: Vec<u16> = dll_dir
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let result = unsafe { SetDllDirectoryW(wide_path.as_ptr()) };
        if result == 0 {
            warn!("SetDllDirectoryW failed");
        } else {
            debug!("SetDllDirectoryW set to {:?}", dll_dir);
        }
    }

    // 先设置 lib_dir
    *state.lib_dir.lock().map_err(|e| e.to_string())? = Some(lib_path.clone());

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

    info!("maa_init loading library from {:?}...", dll_path);
    maa_framework::load_library(&dll_path).map_err(|e| e.to_string())?;

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
    let version = maa_framework::maa_version().to_string();
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
            error!(
                "Failed to load MaaFramework library from {:?}: {:?}",
                dll_path, e
            );
        }
    }

    let current_str = maa_framework::maa_version().to_string();

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
#[tauri::command]
pub async fn maa_find_adb_devices(
    state: State<'_, Arc<MaaState>>,
) -> Result<Vec<AdbDevice>, String> {
    info!("maa_find_adb_devices called");

    let state_arc = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
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

        // 缓存搜索结果
        if let Ok(mut cached) = state_arc.cached_adb_devices.lock() {
            *cached = result_devices.clone();
        }

        info!("Returning {} device(s)", result_devices.len());
        Ok(result_devices)
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

    let state_arc = state.inner().clone();
    let class_re_str = class_regex.clone();
    let window_re_str = window_regex.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let windows = Toolkit::find_desktop_windows().map_err(|e| e.to_string())?;

        // 编译正则表达式
        let class_re = class_re_str
            .as_ref()
            .and_then(|r| regex::Regex::new(r).ok());
        let window_re = window_re_str
            .as_ref()
            .and_then(|r| regex::Regex::new(r).ok());

        let mut result_windows = Vec::new();

        for w in windows {
            // 过滤
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

        // 缓存搜索结果
        if let Ok(mut cached) = state_arc.cached_win32_windows.lock() {
            *cached = result_windows.clone();
        }

        info!("Returning {} filtered window(s)", result_windows.len());
        Ok(result_windows)
    })
    .await
    .map_err(|e| e.to_string())?
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

/// 销毁实例
#[tauri::command]
pub fn maa_destroy_instance(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<(), String> {
    info!("maa_destroy_instance called, instance_id: {}", instance_id);

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let removed = instances.remove(&instance_id).is_some();

    if removed {
        info!("maa_destroy_instance success, instance_id: {}", instance_id);
    } else {
        warn!(
            "maa_destroy_instance: instance not found, instance_id: {}",
            instance_id
        );
    }
    Ok(())
}

// ============================================================================
// 控制器命令
// ============================================================================

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

    let state_arc = state.inner().clone();
    let app_handle = app.clone();

    // Move blocking controller creation and connection to spawn_blocking
    tauri::async_runtime::spawn_blocking(move || {
        let controller = match &config {
            ControllerConfig::Adb {
                adb_path,
                address,
                screencap_methods,
                input_methods,
                config,
            } => {
                // 将字符串解析为 u64
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
                // bitflags
                let screencap = screencap_method
                    .map(|v| maa_framework::common::Win32ScreencapMethod::from_bits_truncate(v))
                    .unwrap_or(maa_framework::common::Win32ScreencapMethod::DXGI_DESKTOP_DUP);

                Controller::new_gamepad(hwnd, gp_type, screencap).map_err(|e| e.to_string())?
            }
        };

        // 注册回调
        let app_handle_clone = app_handle.clone();
        controller
            .add_sink(move |msg, detail| {
                emit_callback_event(&app_handle_clone, msg, detail);
            })
            .map_err(|e| e.to_string())?;

        // 设置默认参数
        if let Err(e) = controller.set_screenshot_target_short_side(720) {
            warn!("Failed to set screenshot target short side to 720: {}", e);
        }

        // 发起连接
        let conn_id = controller.post_connection().map_err(|e| e.to_string())?;

        // 更新实例状态
        debug!("Updating instance state...");
        {
            let mut instances = state_arc.instances.lock().map_err(|e| e.to_string())?;
            let instance = instances
                .get_mut(&instance_id)
                .ok_or("Instance not found")?;

            instance.controller = Some(controller);
            instance.tasker = None;
        }

        Ok(conn_id)
    })
    .await
    .map_err(|e| e.to_string())?
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

/// 加载资源（异步，通过回调通知完成状态）
/// 返回资源加载请求 ID 列表，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub fn maa_load_resource(
    app: tauri::AppHandle,
    state: State<Arc<MaaState>>,
    instance_id: String,
    paths: Vec<String>,
) -> Result<Vec<i64>, String> {
    info!(
        "maa_load_resource called, instance: {}, paths: {:?}",
        instance_id, paths
    );

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    // 创建或获取资源
    if instance.resource.is_none() {
        let res = Resource::new().map_err(|e| e.to_string())?;

        // 注册回调
        let app_handle = app.clone();
        res.add_sink(move |msg, detail| {
            emit_callback_event(&app_handle, msg, detail);
        })
        .map_err(|e| e.to_string())?;

        // 注册 MXU Custom Actions
        crate::mxu_actions::register_all_mxu_actions(&res)?;

        instance.resource = Some(res);
    }

    let resource = instance.resource.as_ref().unwrap();
    let mut res_ids = Vec::new();

    for path in paths {
        let normalized = normalize_path(&path).to_string_lossy().to_string();
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
/// 返回任务 ID，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub fn maa_run_task(
    app: tauri::AppHandle,
    state: State<Arc<MaaState>>,
    instance_id: String,
    entry: String,
    pipeline_override: String,
) -> Result<i64, String> {
    info!("maa_run_task called, entry: {}", entry);

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    let resource = instance.resource.as_ref().ok_or("Resource not loaded")?;
    let controller = instance
        .controller
        .as_ref()
        .ok_or("Controller not connected")?;

    // 创建或获取 tasker
    if instance.tasker.is_none() {
        let tasker = Tasker::new().map_err(|e| e.to_string())?;

        // 添加回调 Sink，用于接收任务状态通知
        let app_handle = app.clone();
        tasker
            .add_sink(move |msg, detail| {
                emit_callback_event(&app_handle, msg, detail);
            })
            .map_err(|e| e.to_string())?;

        // 添加 Context Sink，用于接收 Node 级别的通知（包含 focus 消息）
        let app_handle = app.clone();
        tasker
            .add_context_sink(move |msg, detail| {
                emit_callback_event(&app_handle, msg, detail);
            })
            .map_err(|e| e.to_string())?;

        // 绑定资源和控制器
        tasker
            .bind(resource, controller)
            .map_err(|e| e.to_string())?;

        instance.tasker = Some(tasker);
    }

    let tasker = instance.tasker.as_ref().unwrap();

    // 检查初始化状态
    if !tasker.inited() {
        return Err("Tasker not initialized".to_string());
    }

    let job = tasker
        .post_task(&entry, &pipeline_override)
        .map_err(|e| e.to_string())?;
    let task_id = job.id;

    instance.task_ids.push(task_id);

    Ok(task_id)
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
#[tauri::command]
pub fn maa_stop_task(state: State<Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;
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
    // 清空缓存的 task_ids
    instance.task_ids.clear();

    tasker.post_stop().map_err(|e| e.to_string())?;
    Ok(())
}

/// 覆盖已提交任务的 Pipeline 配置（用于运行中修改尚未执行的任务选项）
#[tauri::command]
pub fn maa_override_pipeline(
    state: State<Arc<MaaState>>,
    instance_id: String,
    task_id: i64,
    pipeline_override: String,
) -> Result<bool, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;
    let tasker = instance.tasker.as_ref().ok_or("Tasker not created")?;

    tasker
        .override_pipeline(task_id, &pipeline_override)
        .map_err(|e| e.to_string())
}

/// 检查是否正在运行
#[tauri::command]
pub fn maa_is_running(state: State<Arc<MaaState>>, instance_id: String) -> Result<bool, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    Ok(instance.tasker.as_ref().is_some_and(|t| t.running()))
}

// ============================================================================
// 截图命令
// ============================================================================

/// 发起截图请求
#[tauri::command]
pub fn maa_post_screencap(state: State<Arc<MaaState>>, instance_id: String) -> Result<i64, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;
    let controller = instance
        .controller
        .as_ref()
        .ok_or("Controller not connected")?;

    controller.post_screencap().map_err(|e| e.to_string())
}

/// 获取缓存的截图（返回 base64 编码的 PNG 图像）
#[tauri::command]
pub fn maa_get_cached_image(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<String, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;
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

    // 复制数据并转换为 base64
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let base64_str = STANDARD.encode(&data);

    // 返回带 data URL 前缀的 base64 字符串
    Ok(format!("data:image/png;base64,{}", base64_str))
}
