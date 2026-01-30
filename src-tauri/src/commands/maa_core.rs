//! Maa 核心命令
//!
//! 提供 MaaFramework 初始化、版本检查、设备搜索、控制器、资源和任务管理

use log::{debug, error, info, warn};
use std::sync::Arc;

use tauri::State;

use crate::maa_ffi::{
    from_cstr, get_event_callback, get_maa_version, get_maa_version_standalone, init_maa_library,
    to_cstring, MaaImageBuffer, MaaLibrary, MaaToolkitAdbDeviceList, MaaToolkitDesktopWindowList,
    MAA_CTRL_OPTION_SCREENSHOT_TARGET_SHORT_SIDE, MAA_GAMEPAD_TYPE_DUALSHOCK4,
    MAA_GAMEPAD_TYPE_XBOX360, MAA_INVALID_ID, MAA_LIBRARY, MAA_STATUS_PENDING, MAA_STATUS_RUNNING,
    MAA_STATUS_SUCCEEDED, MAA_WIN32_SCREENCAP_DXGI_DESKTOPDUP,
};

use super::types::{
    AdbDevice, ConnectionStatus, ControllerConfig, MaaState, TaskStatus, VersionCheckResult,
    Win32Window,
};
use super::utils::{get_maafw_dir, normalize_path};

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

    // 先设置 lib_dir，即使后续加载失败也能用于版本检查
    *state.lib_dir.lock().map_err(|e| e.to_string())? = Some(lib_path.clone());

    info!("maa_init loading library...");
    init_maa_library(&lib_path).map_err(|e| e.to_string())?;

    let version = get_maa_version().unwrap_or_default();
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
    let version = get_maa_version().ok_or_else(|| "MaaFramework not initialized".to_string())?;
    info!("maa_get_version result: {}", version);
    Ok(version)
}

/// 检查 MaaFramework 版本是否满足最小要求
/// 使用独立的版本获取，不依赖完整库加载成功
#[tauri::command]
pub fn maa_check_version(state: State<Arc<MaaState>>) -> Result<VersionCheckResult, String> {
    debug!("maa_check_version called");

    // 获取 lib_dir
    let lib_dir = state
        .lib_dir
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "lib_dir not set".to_string())?;

    // 使用独立的版本获取函数，不依赖完整库加载
    let current_str = get_maa_version_standalone(&lib_dir)
        .ok_or_else(|| "Failed to get MaaFramework version".to_string())?;

    // 去掉版本号前缀 'v'（如 "v5.5.0-beta.1" -> "5.5.0-beta.1"）
    let current_clean = current_str.trim_start_matches('v');
    let min_clean = MIN_MAAFW_VERSION.trim_start_matches('v');

    // 解析最小版本（这个应该总是成功的）
    let minimum = semver::Version::parse(min_clean).map_err(|e| {
        error!("Failed to parse minimum version '{}': {}", min_clean, e);
        format!("Failed to parse minimum version '{}': {}", min_clean, e)
    })?;

    // 尝试解析当前版本，如果解析失败（如 "DEBUG_VERSION"），视为不兼容
    let is_compatible = match semver::Version::parse(current_clean) {
        Ok(current) => {
            let compatible = current >= minimum;
            info!(
                "maa_check_version: current={}, minimum={}, compatible={}",
                current, minimum, compatible
            );
            compatible
        }
        Err(e) => {
            // 无法解析的版本号（如 DEBUG_VERSION）视为不兼容
            warn!(
                "Failed to parse current version '{}': {} - treating as incompatible",
                current_clean, e
            );
            false
        }
    };

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
pub fn maa_find_adb_devices(state: State<Arc<MaaState>>) -> Result<Vec<AdbDevice>, String> {
    info!("maa_find_adb_devices called");

    let guard = MAA_LIBRARY.lock().map_err(|e| {
        error!("Failed to lock MAA_LIBRARY: {}", e);
        e.to_string()
    })?;

    let lib = guard.as_ref().ok_or_else(|| {
        error!("MaaFramework not initialized");
        "MaaFramework not initialized".to_string()
    })?;

    debug!("MaaFramework library loaded");

    let devices = unsafe {
        debug!("Creating ADB device list...");
        let list = (lib.maa_toolkit_adb_device_list_create)();
        if list.is_null() {
            error!("Failed to create device list (null pointer)");
            return Err("Failed to create device list".to_string());
        }
        debug!("Device list created successfully");

        // 确保清理
        struct ListGuard<'a> {
            list: *mut MaaToolkitAdbDeviceList,
            lib: &'a MaaLibrary,
        }
        impl Drop for ListGuard<'_> {
            fn drop(&mut self) {
                log::debug!("Destroying ADB device list...");
                unsafe {
                    (self.lib.maa_toolkit_adb_device_list_destroy)(self.list);
                }
            }
        }
        let _guard = ListGuard { list, lib };

        debug!("Calling MaaToolkitAdbDeviceFind...");
        let found = (lib.maa_toolkit_adb_device_find)(list);
        debug!("MaaToolkitAdbDeviceFind returned: {}", found);

        // MaaToolkitAdbDeviceFind 只在 buffer 为 null 时返回 false
        // 即使没找到设备也会返回 true，所以不应该用返回值判断是否找到设备
        if found == 0 {
            warn!("MaaToolkitAdbDeviceFind returned false (unexpected)");
            // 继续执行而不是直接返回，检查 list size
        }

        let size = (lib.maa_toolkit_adb_device_list_size)(list);
        info!("Found {} ADB device(s)", size);

        let mut devices = Vec::with_capacity(size as usize);

        for i in 0..size {
            let device = (lib.maa_toolkit_adb_device_list_at)(list, i);
            if device.is_null() {
                warn!("Device at index {} is null, skipping", i);
                continue;
            }

            let name = from_cstr((lib.maa_toolkit_adb_device_get_name)(device));
            let adb_path = from_cstr((lib.maa_toolkit_adb_device_get_adb_path)(device));
            let address = from_cstr((lib.maa_toolkit_adb_device_get_address)(device));

            debug!(
                "Device {}: name='{}', adb_path='{}', address='{}'",
                i, name, adb_path, address
            );

            devices.push(AdbDevice {
                name,
                adb_path,
                address,
                screencap_methods: (lib.maa_toolkit_adb_device_get_screencap_methods)(device),
                input_methods: (lib.maa_toolkit_adb_device_get_input_methods)(device),
                config: from_cstr((lib.maa_toolkit_adb_device_get_config)(device)),
            });
        }

        devices
    };

    // 缓存搜索结果
    if let Ok(mut cached) = state.cached_adb_devices.lock() {
        *cached = devices.clone();
    }

    info!("Returning {} device(s)", devices.len());
    Ok(devices)
}

/// 查找 Win32 窗口（结果会缓存到 MaaState）
#[tauri::command]
pub fn maa_find_win32_windows(
    state: State<Arc<MaaState>>,
    class_regex: Option<String>,
    window_regex: Option<String>,
) -> Result<Vec<Win32Window>, String> {
    info!(
        "maa_find_win32_windows called, class_regex: {:?}, window_regex: {:?}",
        class_regex, window_regex
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| {
        error!("Failed to lock MAA_LIBRARY: {}", e);
        e.to_string()
    })?;
    let lib = guard.as_ref().ok_or_else(|| {
        error!("MaaFramework not initialized");
        "MaaFramework not initialized".to_string()
    })?;

    let windows = unsafe {
        debug!("Creating desktop window list...");
        let list = (lib.maa_toolkit_desktop_window_list_create)();
        if list.is_null() {
            error!("Failed to create window list (null pointer)");
            return Err("Failed to create window list".to_string());
        }

        struct ListGuard<'a> {
            list: *mut MaaToolkitDesktopWindowList,
            lib: &'a MaaLibrary,
        }
        impl Drop for ListGuard<'_> {
            fn drop(&mut self) {
                log::debug!("Destroying desktop window list...");
                unsafe {
                    (self.lib.maa_toolkit_desktop_window_list_destroy)(self.list);
                }
            }
        }
        let _guard = ListGuard { list, lib };

        debug!("Calling MaaToolkitDesktopWindowFindAll...");
        let found = (lib.maa_toolkit_desktop_window_find_all)(list);
        debug!("MaaToolkitDesktopWindowFindAll returned: {}", found);

        if found == 0 {
            info!("No windows found");
            Vec::new()
        } else {
            let size = (lib.maa_toolkit_desktop_window_list_size)(list);
            debug!("Found {} total window(s)", size);

            let mut windows = Vec::with_capacity(size as usize);

            // 编译正则表达式
            let class_re = class_regex.as_ref().and_then(|r| regex::Regex::new(r).ok());
            let window_re = window_regex
                .as_ref()
                .and_then(|r| regex::Regex::new(r).ok());

            for i in 0..size {
                let window = (lib.maa_toolkit_desktop_window_list_at)(list, i);
                if window.is_null() {
                    continue;
                }

                let class_name = from_cstr((lib.maa_toolkit_desktop_window_get_class_name)(window));
                let window_name =
                    from_cstr((lib.maa_toolkit_desktop_window_get_window_name)(window));

                // 过滤
                if let Some(re) = &class_re {
                    if !re.is_match(&class_name) {
                        continue;
                    }
                }
                if let Some(re) = &window_re {
                    if !re.is_match(&window_name) {
                        continue;
                    }
                }

                let handle = (lib.maa_toolkit_desktop_window_get_handle)(window);

                debug!(
                    "Window {}: handle={}, class='{}', name='{}'",
                    i, handle as u64, class_name, window_name
                );

                windows.push(Win32Window {
                    handle: handle as u64,
                    class_name,
                    window_name,
                });
            }

            windows
        }
    };

    // 缓存搜索结果
    if let Ok(mut cached) = state.cached_win32_windows.lock() {
        *cached = windows.clone();
    }

    info!("Returning {} filtered window(s)", windows.len());
    Ok(windows)
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
pub fn maa_connect_controller(
    state: State<Arc<MaaState>>,
    instance_id: String,
    config: ControllerConfig,
) -> Result<i64, String> {
    info!("maa_connect_controller called");
    info!("instance_id: {}", instance_id);
    info!("config: {:?}", config);

    let guard = MAA_LIBRARY.lock().map_err(|e| {
        error!("Failed to lock MAA_LIBRARY: {}", e);
        e.to_string()
    })?;
    let lib = guard.as_ref().ok_or_else(|| {
        error!("MaaFramework not initialized");
        "MaaFramework not initialized".to_string()
    })?;

    debug!("MaaFramework library loaded, creating controller...");

    let controller = unsafe {
        match &config {
            ControllerConfig::Adb {
                adb_path,
                address,
                screencap_methods,
                input_methods,
                config,
            } => {
                // 将字符串解析为 u64
                let screencap_methods_u64 = screencap_methods.parse::<u64>().map_err(|e| {
                    format!("Invalid screencap_methods '{}': {}", screencap_methods, e)
                })?;
                let input_methods_u64 = input_methods
                    .parse::<u64>()
                    .map_err(|e| format!("Invalid input_methods '{}': {}", input_methods, e))?;

                info!("Creating ADB controller:");
                info!("  adb_path: {}", adb_path);
                info!("  address: {}", address);
                debug!(
                    "  screencap_methods: {} (parsed: {})",
                    screencap_methods, screencap_methods_u64
                );
                debug!(
                    "  input_methods: {} (parsed: {})",
                    input_methods, input_methods_u64
                );
                debug!("  config: {}", config);

                let adb_path_c = to_cstring(adb_path);
                let address_c = to_cstring(address);
                let config_c = to_cstring(config);
                let agent_path = get_maafw_dir()
                    .map(|p| p.join("MaaAgentBinary").to_string_lossy().to_string())
                    .unwrap_or_default();
                let agent_path_c = to_cstring(&agent_path);

                debug!("Calling MaaAdbControllerCreate...");
                let ctrl = (lib.maa_adb_controller_create)(
                    adb_path_c.as_ptr(),
                    address_c.as_ptr(),
                    screencap_methods_u64,
                    input_methods_u64,
                    config_c.as_ptr(),
                    agent_path_c.as_ptr(),
                );
                debug!("MaaAdbControllerCreate returned: {:?}", ctrl);
                ctrl
            }
            ControllerConfig::Win32 {
                handle,
                screencap_method,
                mouse_method,
                keyboard_method,
            } => (lib.maa_win32_controller_create)(
                *handle as *mut std::ffi::c_void,
                *screencap_method,
                *mouse_method,
                *keyboard_method,
            ),
            ControllerConfig::Gamepad {
                handle,
                gamepad_type,
                screencap_method,
            } => {
                // 解析 gamepad_type，默认为 Xbox360
                let gp_type = match gamepad_type.as_deref() {
                    Some("DualShock4") | Some("DS4") => MAA_GAMEPAD_TYPE_DUALSHOCK4,
                    _ => MAA_GAMEPAD_TYPE_XBOX360,
                };
                // 截图方法，默认为 DXGI_DesktopDup
                let screencap = screencap_method.unwrap_or(MAA_WIN32_SCREENCAP_DXGI_DESKTOPDUP);

                (lib.maa_gamepad_controller_create)(
                    *handle as *mut std::ffi::c_void,
                    gp_type,
                    screencap,
                )
            }
            ControllerConfig::PlayCover { .. } => {
                // PlayCover 仅支持 macOS
                return Err("PlayCover controller is only supported on macOS".to_string());
            }
        }
    };

    if controller.is_null() {
        error!("Controller creation failed (null pointer)");
        return Err("Failed to create controller".to_string());
    }

    debug!("Controller created successfully: {:?}", controller);

    // 添加回调 Sink，用于接收连接状态通知
    debug!("Adding controller sink...");
    unsafe {
        (lib.maa_controller_add_sink)(controller, get_event_callback(), std::ptr::null_mut());
    }

    // 设置默认截图分辨率
    debug!("Setting screenshot target short side to 720...");
    unsafe {
        let short_side: i32 = 720;
        (lib.maa_controller_set_option)(
            controller,
            MAA_CTRL_OPTION_SCREENSHOT_TARGET_SHORT_SIDE,
            &short_side as *const i32 as *const std::ffi::c_void,
            std::mem::size_of::<i32>() as u64,
        );
    }

    // 发起连接（不等待，通过回调通知完成）
    debug!("Calling MaaControllerPostConnection...");
    let conn_id = unsafe { (lib.maa_controller_post_connection)(controller) };
    info!("MaaControllerPostConnection returned conn_id: {}", conn_id);

    if conn_id == MAA_INVALID_ID {
        error!("Failed to post connection");
        unsafe {
            (lib.maa_controller_destroy)(controller);
        }
        return Err("Failed to post connection".to_string());
    }

    // 更新实例状态
    debug!("Updating instance state...");
    {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;

        // 清理旧的控制器
        if let Some(old_controller) = instance.controller.take() {
            debug!("Destroying old controller...");
            unsafe {
                (lib.maa_controller_destroy)(old_controller);
            }
        }

        instance.controller = Some(controller);
    }

    Ok(conn_id)
}

/// 获取连接状态（通过 MaaControllerConnected API 查询）
#[tauri::command]
pub fn maa_get_connection_status(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<ConnectionStatus, String> {
    debug!(
        "maa_get_connection_status called, instance_id: {}",
        instance_id
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    let status = match instance.controller {
        Some(ctrl) => {
            let connected = unsafe { (lib.maa_controller_connected)(ctrl) != 0 };
            if connected {
                ConnectionStatus::Connected
            } else {
                ConnectionStatus::Disconnected
            }
        }
        None => ConnectionStatus::Disconnected,
    };

    debug!("maa_get_connection_status result: {:?}", status);
    Ok(status)
}

// ============================================================================
// 资源命令
// ============================================================================

/// 加载资源（异步，通过回调通知完成状态）
/// 返回资源加载请求 ID 列表，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub fn maa_load_resource(
    state: State<Arc<MaaState>>,
    instance_id: String,
    paths: Vec<String>,
) -> Result<Vec<i64>, String> {
    info!(
        "maa_load_resource called, instance: {}, paths: {:?}",
        instance_id, paths
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    // 创建或获取资源
    let resource = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;

        if instance.resource.is_none() {
            let res = unsafe { (lib.maa_resource_create)() };
            if res.is_null() {
                return Err("Failed to create resource".to_string());
            }

            // 添加回调 Sink，用于接收资源加载状态通知
            debug!("Adding resource sink...");
            unsafe {
                (lib.maa_resource_add_sink)(res, get_event_callback(), std::ptr::null_mut());
            }

            instance.resource = Some(res);
        }

        instance.resource.unwrap()
    };

    // 加载资源（不等待，通过回调通知完成）
    let mut res_ids = Vec::new();
    for path in &paths {
        let normalized = normalize_path(path);
        let normalized_str = normalized.to_string_lossy();
        let path_c = to_cstring(&normalized_str);
        let res_id = unsafe { (lib.maa_resource_post_bundle)(resource, path_c.as_ptr()) };
        info!(
            "Posted resource bundle: {} -> id: {}",
            normalized_str, res_id
        );

        if res_id == MAA_INVALID_ID {
            warn!("Failed to post resource bundle: {}", normalized_str);
            continue;
        }

        res_ids.push(res_id);
    }

    Ok(res_ids)
}

/// 检查资源是否已加载（通过 MaaResourceLoaded API 查询）
#[tauri::command]
pub fn maa_is_resource_loaded(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<bool, String> {
    debug!(
        "maa_is_resource_loaded called, instance_id: {}",
        instance_id
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    let loaded = instance
        .resource
        .map_or(false, |res| unsafe { (lib.maa_resource_loaded)(res) != 0 });

    debug!("maa_is_resource_loaded result: {}", loaded);
    Ok(loaded)
}

/// 销毁资源（用于切换资源时重新创建）
#[tauri::command]
pub fn maa_destroy_resource(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<(), String> {
    info!("maa_destroy_resource called, instance_id: {}", instance_id);

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    // 销毁旧的资源
    if let Some(resource) = instance.resource.take() {
        debug!("Destroying old resource...");
        unsafe {
            (lib.maa_resource_destroy)(resource);
        }
    }

    // 如果有 tasker，也需要销毁（因为 tasker 绑定了旧的 resource）
    if let Some(tasker) = instance.tasker.take() {
        debug!("Destroying old tasker (bound to old resource)...");
        unsafe {
            (lib.maa_tasker_destroy)(tasker);
        }
    }

    info!("maa_destroy_resource success, instance_id: {}", instance_id);
    Ok(())
}

// ============================================================================
// 任务命令
// ============================================================================

/// 运行任务（异步，通过回调通知完成状态）
/// 返回任务 ID，前端通过监听 maa-callback 事件获取完成状态
#[tauri::command]
pub fn maa_run_task(
    state: State<Arc<MaaState>>,
    instance_id: String,
    entry: String,
    pipeline_override: String,
) -> Result<i64, String> {
    info!(
        "maa_run_task called, instance_id: {}, entry: {}, pipeline_override: {}",
        instance_id, entry, pipeline_override
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let (_resource, _controller, tasker) = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;

        let resource = instance.resource.ok_or("Resource not loaded")?;
        let controller = instance.controller.ok_or("Controller not connected")?;

        // 创建或获取 tasker
        if instance.tasker.is_none() {
            let tasker = unsafe { (lib.maa_tasker_create)() };
            if tasker.is_null() {
                return Err("Failed to create tasker".to_string());
            }

            // 添加回调 Sink，用于接收任务状态通知
            debug!("Adding tasker sink...");
            unsafe {
                (lib.maa_tasker_add_sink)(tasker, get_event_callback(), std::ptr::null_mut());
            }

            // 添加 Context Sink，用于接收 Node 级别的通知（包含 focus 消息）
            debug!("Adding tasker context sink...");
            unsafe {
                (lib.maa_tasker_add_context_sink)(
                    tasker,
                    get_event_callback(),
                    std::ptr::null_mut(),
                );
            }

            // 绑定资源和控制器
            unsafe {
                (lib.maa_tasker_bind_resource)(tasker, resource);
                (lib.maa_tasker_bind_controller)(tasker, controller);
            }

            instance.tasker = Some(tasker);
        }

        (resource, controller, instance.tasker.unwrap())
    };

    // 检查初始化状态
    let inited = unsafe { (lib.maa_tasker_inited)(tasker) };
    info!("Tasker inited status: {}", inited);
    if inited == 0 {
        error!("Tasker not properly initialized, inited: {}", inited);
        return Err("Tasker not properly initialized".to_string());
    }

    // 提交任务（不等待，通过回调通知完成）
    let entry_c = to_cstring(&entry);
    let override_c = to_cstring(&pipeline_override);

    info!(
        "Calling MaaTaskerPostTask: entry={}, override={}",
        entry, pipeline_override
    );
    let task_id =
        unsafe { (lib.maa_tasker_post_task)(tasker, entry_c.as_ptr(), override_c.as_ptr()) };

    info!("MaaTaskerPostTask returned task_id: {}", task_id);

    if task_id == MAA_INVALID_ID {
        return Err("Failed to post task".to_string());
    }

    // 缓存 task_id，用于刷新后恢复状态
    {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        if let Some(instance) = instances.get_mut(&instance_id) {
            instance.task_ids.push(task_id);
        }
    }

    Ok(task_id)
}

/// 获取任务状态
#[tauri::command]
pub fn maa_get_task_status(
    state: State<Arc<MaaState>>,
    instance_id: String,
    task_id: i64,
) -> Result<TaskStatus, String> {
    debug!(
        "maa_get_task_status called, instance_id: {}, task_id: {}",
        instance_id, task_id
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let tasker = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(&instance_id).ok_or("Instance not found")?;
        instance.tasker.ok_or("Tasker not created")?
    };

    let status = unsafe { (lib.maa_tasker_status)(tasker, task_id) };

    let result = match status {
        MAA_STATUS_PENDING => TaskStatus::Pending,
        MAA_STATUS_RUNNING => TaskStatus::Running,
        MAA_STATUS_SUCCEEDED => TaskStatus::Succeeded,
        _ => TaskStatus::Failed,
    };

    debug!("maa_get_task_status result: {:?} (raw: {})", result, status);
    Ok(result)
}

/// 停止任务
#[tauri::command]
pub fn maa_stop_task(state: State<Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    info!("maa_stop_task called, instance_id: {}", instance_id);

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let tasker = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;
        // 清空缓存的 task_ids
        instance.task_ids.clear();
        instance.tasker.ok_or("Tasker not created")?
    };

    debug!("Calling MaaTaskerPostStop...");
    let stop_id = unsafe { (lib.maa_tasker_post_stop)(tasker) };
    info!("MaaTaskerPostStop returned: {}", stop_id);

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
    info!(
        "maa_override_pipeline called, instance_id: {}, task_id: {}, pipeline_override: {}",
        instance_id, task_id, pipeline_override
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let tasker = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(&instance_id).ok_or("Instance not found")?;
        instance.tasker.ok_or("Tasker not created")?
    };

    let override_fn = lib
        .maa_tasker_override_pipeline
        .ok_or("MaaTaskerOverridePipeline not available in this MaaFramework version")?;

    let override_c = to_cstring(&pipeline_override);
    let success = unsafe { (override_fn)(tasker, task_id, override_c.as_ptr()) };

    info!("MaaTaskerOverridePipeline returned: {}", success);
    Ok(success != 0)
}

/// 检查是否正在运行
#[tauri::command]
pub fn maa_is_running(state: State<Arc<MaaState>>, instance_id: String) -> Result<bool, String> {
    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let tasker = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(&instance_id).ok_or("Instance not found")?;
        match instance.tasker {
            Some(t) => t,
            None => {
                return Ok(false);
            }
        }
    };

    let running = unsafe { (lib.maa_tasker_running)(tasker) };
    let result = running != 0;
    Ok(result)
}

// ============================================================================
// 截图命令
// ============================================================================

/// 发起截图请求
#[tauri::command]
pub fn maa_post_screencap(state: State<Arc<MaaState>>, instance_id: String) -> Result<i64, String> {
    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let controller = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(&instance_id).ok_or("Instance not found")?;
        instance.controller.ok_or("Controller not connected")?
    };

    let screencap_id = unsafe { (lib.maa_controller_post_screencap)(controller) };

    if screencap_id == MAA_INVALID_ID {
        return Err("Failed to post screencap".to_string());
    }

    Ok(screencap_id)
}

/// 获取缓存的截图（返回 base64 编码的 PNG 图像）
#[tauri::command]
pub fn maa_get_cached_image(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<String, String> {
    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let controller = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(&instance_id).ok_or("Instance not found")?;
        instance.controller.ok_or("Controller not connected")?
    };

    unsafe {
        // 创建图像缓冲区
        let image_buffer = (lib.maa_image_buffer_create)();
        if image_buffer.is_null() {
            return Err("Failed to create image buffer".to_string());
        }

        // 确保缓冲区被释放
        struct ImageBufferGuard<'a> {
            buffer: *mut MaaImageBuffer,
            lib: &'a MaaLibrary,
        }
        impl Drop for ImageBufferGuard<'_> {
            fn drop(&mut self) {
                unsafe {
                    (self.lib.maa_image_buffer_destroy)(self.buffer);
                }
            }
        }
        let _guard = ImageBufferGuard {
            buffer: image_buffer,
            lib,
        };

        // 获取缓存的图像
        let success = (lib.maa_controller_cached_image)(controller, image_buffer);
        if success == 0 {
            return Err("Failed to get cached image".to_string());
        }

        // 获取编码后的图像数据
        let encoded_ptr = (lib.maa_image_buffer_get_encoded)(image_buffer);
        let encoded_size = (lib.maa_image_buffer_get_encoded_size)(image_buffer);

        if encoded_ptr.is_null() || encoded_size == 0 {
            return Err("No image data available".to_string());
        }

        // 复制数据并转换为 base64
        let data = std::slice::from_raw_parts(encoded_ptr, encoded_size as usize);
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let base64_str = STANDARD.encode(data);

        // 返回带 data URL 前缀的 base64 字符串
        Ok(format!("data:image/png;base64,{}", base64_str))
    }
}
