//! Tauri 命令实现
//!
//! 提供前端调用的 MaaFramework 功能接口

use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::os::raw::c_void;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::maa_ffi::{
    emit_agent_output, from_cstr, get_event_callback, get_maa_version, get_maa_version_standalone,
    init_maa_library, to_cstring, MaaAgentClient, MaaController, MaaImageBuffer, MaaLibrary,
    MaaResource, MaaTasker, MaaToolkitAdbDeviceList, MaaToolkitDesktopWindowList, SendPtr,
    MAA_CTRL_OPTION_SCREENSHOT_TARGET_SHORT_SIDE, MAA_GAMEPAD_TYPE_DUALSHOCK4,
    MAA_GAMEPAD_TYPE_XBOX360, MAA_INVALID_ID, MAA_LIBRARY, MAA_STATUS_PENDING, MAA_STATUS_RUNNING,
    MAA_STATUS_SUCCEEDED, MAA_WIN32_SCREENCAP_DXGI_DESKTOPDUP,
};

// ============================================================================
// 辅助函数
// ============================================================================

/// 规范化路径：移除冗余的 `.`、处理 `..`、统一分隔符
/// 使用 Path::components() 解析，不需要路径实际存在
fn normalize_path(path: &str) -> PathBuf {
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
    components.iter().collect()
}

/// 获取 exe 所在目录下的 debug/logs 子目录
fn get_logs_dir() -> PathBuf {
    let exe_path = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or(std::path::Path::new("."));
    exe_dir.join("debug")
}

// ============================================================================
// 数据类型定义
// ============================================================================

/// ADB 设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdbDevice {
    pub name: String,
    pub adb_path: String,
    pub address: String,
    #[serde(with = "u64_as_string")]
    pub screencap_methods: u64,
    #[serde(with = "u64_as_string")]
    pub input_methods: u64,
    pub config: String,
}

/// 将 u64 序列化/反序列化为字符串，避免 JavaScript 精度丢失
mod u64_as_string {
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.parse::<u64>().map_err(serde::de::Error::custom)
    }
}

/// Win32 窗口信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Win32Window {
    pub handle: u64,
    pub class_name: String,
    pub window_name: String,
}

/// 控制器类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControllerConfig {
    Adb {
        adb_path: String,
        address: String,
        screencap_methods: String, // u64 作为字符串传递，避免 JS 精度丢失
        input_methods: String,     // u64 作为字符串传递
        config: String,
    },
    Win32 {
        handle: u64,
        screencap_method: u64,
        mouse_method: u64,
        keyboard_method: u64,
    },
    Gamepad {
        handle: u64,
        #[serde(default)]
        gamepad_type: Option<String>,
        #[serde(default)]
        screencap_method: Option<u64>,
    },
    PlayCover {
        address: String,
    },
}

/// 连接状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed(String),
}

/// 任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
}

/// 实例运行时状态（用于前端查询）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceState {
    /// 控制器是否已连接（通过 MaaControllerConnected API 查询）
    pub connected: bool,
    /// 资源是否已加载（通过 MaaResourceLoaded API 查询）
    pub resource_loaded: bool,
    /// Tasker 是否已初始化
    pub tasker_inited: bool,
    /// 是否有任务正在运行（通过 MaaTaskerRunning API 查询）
    pub is_running: bool,
    /// 当前运行的任务 ID 列表
    pub task_ids: Vec<i64>,
}

/// 所有实例状态的快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllInstanceStates {
    pub instances: HashMap<String, InstanceState>,
    pub cached_adb_devices: Vec<AdbDevice>,
    pub cached_win32_windows: Vec<Win32Window>,
}

/// 实例运行时状态（持有 MaaFramework 对象句柄）
pub struct InstanceRuntime {
    pub resource: Option<*mut MaaResource>,
    pub controller: Option<*mut MaaController>,
    pub tasker: Option<*mut MaaTasker>,
    pub agent_client: Option<*mut MaaAgentClient>,
    pub agent_child: Option<Child>,
    /// 当前运行的任务 ID 列表（用于刷新后恢复状态）
    pub task_ids: Vec<i64>,
}

// 为原始指针实现 Send 和 Sync
// MaaFramework 的 API 是线程安全的
unsafe impl Send for InstanceRuntime {}
unsafe impl Sync for InstanceRuntime {}

impl Default for InstanceRuntime {
    fn default() -> Self {
        Self {
            resource: None,
            controller: None,
            tasker: None,
            agent_client: None,
            agent_child: None,
            task_ids: Vec::new(),
        }
    }
}

impl Drop for InstanceRuntime {
    fn drop(&mut self) {
        if let Ok(guard) = MAA_LIBRARY.lock() {
            if let Some(lib) = guard.as_ref() {
                unsafe {
                    // 断开并销毁 agent
                    if let Some(agent) = self.agent_client.take() {
                        (lib.maa_agent_client_disconnect)(agent);
                        (lib.maa_agent_client_destroy)(agent);
                    }
                    // 终止 agent 子进程
                    if let Some(mut child) = self.agent_child.take() {
                        let _ = child.kill();
                    }
                    if let Some(tasker) = self.tasker.take() {
                        (lib.maa_tasker_destroy)(tasker);
                    }
                    if let Some(controller) = self.controller.take() {
                        (lib.maa_controller_destroy)(controller);
                    }
                    if let Some(resource) = self.resource.take() {
                        (lib.maa_resource_destroy)(resource);
                    }
                }
            }
        }
    }
}

/// MaaFramework 运行时状态
pub struct MaaState {
    pub lib_dir: Mutex<Option<PathBuf>>,
    pub resource_dir: Mutex<Option<PathBuf>>,
    pub instances: Mutex<HashMap<String, InstanceRuntime>>,
    /// 缓存的 ADB 设备列表（全局共享，避免重复搜索）
    pub cached_adb_devices: Mutex<Vec<AdbDevice>>,
    /// 缓存的 Win32 窗口列表（全局共享）
    pub cached_win32_windows: Mutex<Vec<Win32Window>>,
}

impl Default for MaaState {
    fn default() -> Self {
        Self {
            lib_dir: Mutex::new(None),
            resource_dir: Mutex::new(None),
            instances: Mutex::new(HashMap::new()),
            cached_adb_devices: Mutex::new(Vec::new()),
            cached_win32_windows: Mutex::new(Vec::new()),
        }
    }
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 获取可执行文件所在目录下的 maafw 子目录
pub fn get_maafw_dir() -> Result<PathBuf, String> {
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Failed to get executable directory".to_string())?;

    // macOS app bundle 需要特殊处理：exe 在 Contents/MacOS 下，maafw 应在 Contents/Resources 下
    #[cfg(target_os = "macos")]
    {
        if exe_dir.ends_with("Contents/MacOS") {
            let resources_dir = exe_dir.parent().unwrap().join("Resources").join("maafw");
            if resources_dir.exists() {
                return Ok(resources_dir);
            }
        }
    }

    Ok(exe_dir.join("maafw"))
}

/// 初始化 MaaFramework
/// 如果提供 lib_dir 则使用该路径，否则自动从 exe 目录/maafw 加载
#[tauri::command]
pub fn maa_init(state: State<Arc<MaaState>>, lib_dir: Option<String>) -> Result<String, String> {
    info!("maa_init called, lib_dir: {:?}", lib_dir);

    let lib_path = match lib_dir {
        Some(dir) if !dir.is_empty() => PathBuf::from(&dir),
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
    *state.resource_dir.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(&resource_dir));
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

/// MaaFramework 最小支持版本
const MIN_MAAFW_VERSION: &str = "5.5.0-beta.1";

/// 版本检查结果
#[derive(Serialize)]
pub struct VersionCheckResult {
    /// 当前 MaaFramework 版本
    pub current: String,
    /// 最小支持版本
    pub minimum: String,
    /// 是否满足最小版本要求
    pub is_compatible: bool,
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

/// 创建实例（幂等操作，实例已存在时直接返回成功）
#[tauri::command]
pub fn maa_create_instance(state: State<Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    info!("maa_create_instance called, instance_id: {}", instance_id);

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;

    if instances.contains_key(&instance_id) {
        debug!("maa_create_instance: instance already exists, returning success");
        return Ok(());
    }

    instances.insert(instance_id.clone(), InstanceRuntime::default());
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
    // debug!("maa_is_running called, instance_id: {}", instance_id);

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let tasker = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(&instance_id).ok_or("Instance not found")?;
        match instance.tasker {
            Some(t) => t,
            None => {
                // debug!("maa_is_running: no tasker, returning false");
                return Ok(false);
            }
        }
    };

    let running = unsafe { (lib.maa_tasker_running)(tasker) };
    let result = running != 0;
    // debug!("maa_is_running result: {} (raw: {})", result, running);
    Ok(result)
}

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

/// Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub child_exec: String,
    pub child_args: Option<Vec<String>>,
    pub identifier: Option<String>,
    /// 连接超时时间（毫秒），-1 表示无限等待
    pub timeout: Option<i64>,
}

/// 任务配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    pub entry: String,
    pub pipeline_override: String,
}

/// 启动任务（支持 Agent）
#[tauri::command]
pub async fn maa_start_tasks(
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    tasks: Vec<TaskConfig>,
    agent_config: Option<AgentConfig>,
    cwd: String,
) -> Result<Vec<i64>, String> {
    info!("maa_start_tasks called");
    info!(
        "instance_id: {}, tasks: {}, cwd: {}",
        instance_id,
        tasks.len(),
        cwd
    );

    // 使用 SendPtr 包装原始指针，以便跨越 await 边界
    let (resource, tasker) = {
        debug!("[start_tasks] Acquiring MAA_LIBRARY lock...");
        let guard = MAA_LIBRARY
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        debug!("[start_tasks] MAA_LIBRARY lock acquired");
        let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

        debug!("[start_tasks] Acquiring instances lock...");
        let mut instances = state
            .instances
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        debug!("[start_tasks] Instances lock acquired");
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;
        debug!("[start_tasks] Instance found: {}", instance_id);

        let resource = instance.resource.ok_or("Resource not loaded")?;
        debug!("[start_tasks] Resource pointer: {:?}", resource);
        let controller = instance.controller.ok_or("Controller not connected")?;
        debug!("[start_tasks] Controller pointer: {:?}", controller);

        // 创建或获取 tasker
        if instance.tasker.is_none() {
            debug!("[start_tasks] Creating new tasker...");
            let tasker = unsafe { (lib.maa_tasker_create)() };
            debug!("[start_tasks] maa_tasker_create returned: {:?}", tasker);
            if tasker.is_null() {
                return Err("Failed to create tasker".to_string());
            }

            // 添加回调 Sink，用于接收任务状态通知
            debug!("[start_tasks] Adding tasker sink...");
            unsafe {
                (lib.maa_tasker_add_sink)(tasker, get_event_callback(), std::ptr::null_mut());
            }
            debug!("[start_tasks] Tasker sink added");

            // 添加 Context Sink，用于接收 Node 级别的通知（包含 focus 消息）
            debug!("[start_tasks] Adding tasker context sink...");
            unsafe {
                (lib.maa_tasker_add_context_sink)(
                    tasker,
                    get_event_callback(),
                    std::ptr::null_mut(),
                );
            }
            debug!("[start_tasks] Tasker context sink added");

            // 绑定资源和控制器
            debug!("[start_tasks] Binding resource...");
            unsafe {
                (lib.maa_tasker_bind_resource)(tasker, resource);
            }
            debug!("[start_tasks] Resource bound");
            debug!("[start_tasks] Binding controller...");
            unsafe {
                (lib.maa_tasker_bind_controller)(tasker, controller);
            }
            debug!("[start_tasks] Controller bound");

            instance.tasker = Some(tasker);
            debug!("[start_tasks] Tasker created and stored");
        } else {
            debug!("[start_tasks] Using existing tasker: {:?}", instance.tasker);
        }

        let tasker_ptr = instance.tasker.unwrap();
        debug!("[start_tasks] Tasker pointer for SendPtr: {:?}", tasker_ptr);
        (SendPtr::new(resource), SendPtr::new(tasker_ptr))
    };
    debug!("[start_tasks] Resource and tasker acquired, proceeding...");

    // 启动 Agent（如果配置了）
    // agent_client 用 SendPtr 包装，可跨 await 边界
    debug!("[start_tasks] Checking agent config...");
    let agent_client: Option<SendPtr<MaaAgentClient>> = if let Some(agent) = &agent_config {
        info!("[start_tasks] Starting agent: {:?}", agent);

        // 创建 AgentClient 并获取 socket_id（在 guard 作用域内完成同步操作）
        debug!("[agent] Acquiring MAA_LIBRARY lock for agent creation...");
        let (agent_client, socket_id) = {
            let guard = MAA_LIBRARY
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            debug!("[agent] MAA_LIBRARY lock acquired");
            let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

            debug!("[agent] Calling maa_agent_client_create_v2...");
            let agent_client = unsafe { (lib.maa_agent_client_create_v2)(std::ptr::null()) };
            debug!(
                "[agent] maa_agent_client_create_v2 returned: {:?}",
                agent_client
            );
            if agent_client.is_null() {
                error!("[agent] Failed to create agent client (null pointer)");
                return Err("Failed to create agent client".to_string());
            }

            // 绑定资源
            debug!(
                "[agent] Binding resource to agent client, resource ptr: {:?}",
                resource.as_ptr()
            );
            unsafe {
                (lib.maa_agent_client_bind_resource)(agent_client, resource.as_ptr());
            }
            debug!("[agent] Resource bound to agent client");

            // 获取 socket identifier
            debug!("[agent] Getting socket identifier...");
            let socket_id = unsafe {
                debug!("[agent] Creating string buffer...");
                let id_buffer = (lib.maa_string_buffer_create)();
                debug!("[agent] String buffer created: {:?}", id_buffer);
                if id_buffer.is_null() {
                    error!("[agent] Failed to create string buffer (null pointer)");
                    (lib.maa_agent_client_destroy)(agent_client);
                    return Err("Failed to create string buffer".to_string());
                }

                debug!("[agent] Calling maa_agent_client_identifier...");
                let success = (lib.maa_agent_client_identifier)(agent_client, id_buffer);
                debug!("[agent] maa_agent_client_identifier returned: {}", success);
                if success == 0 {
                    error!("[agent] Failed to get agent identifier");
                    (lib.maa_string_buffer_destroy)(id_buffer);
                    (lib.maa_agent_client_destroy)(agent_client);
                    return Err("Failed to get agent identifier".to_string());
                }

                debug!("[agent] Getting string from buffer...");
                let id = from_cstr((lib.maa_string_buffer_get)(id_buffer));
                debug!("[agent] Got socket_id: {}", id);
                (lib.maa_string_buffer_destroy)(id_buffer);
                debug!("[agent] String buffer destroyed");
                id
            };

            debug!("[agent] AgentClient created successfully, wrapping in SendPtr");
            (SendPtr::new(agent_client), socket_id)
        };
        debug!("[agent] MAA_LIBRARY lock released");

        info!("[agent] Agent socket_id: {}", socket_id);

        // 构建子进程参数
        let mut args = agent.child_args.clone().unwrap_or_default();
        args.push(socket_id);

        info!(
            "Starting child process: {} {:?} in {}",
            agent.child_exec, args, cwd
        );

        // 拼接并规范化路径（处理 ./ 等冗余组件，不依赖路径存在）
        let joined = std::path::Path::new(&cwd).join(&agent.child_exec);
        let exec_path = normalize_path(&joined.to_string_lossy());
        debug!(
            "Resolved executable path: {:?}, exists: {}",
            exec_path,
            exec_path.exists()
        );

        // 启动子进程，捕获 stdout 和 stderr
        // 设置 PYTHONIOENCODING 强制 Python 以 UTF-8 编码输出，避免 Windows 系统代码页乱码
        debug!("Spawning child process...");

        // Windows 平台使用 CREATE_NO_WINDOW 标志避免弹出控制台窗口
        #[cfg(windows)]
        let spawn_result = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            Command::new(&exec_path)
                .args(&args)
                .current_dir(&cwd)
                .env("PYTHONIOENCODING", "utf-8")
                .env("PYTHONUTF8", "1")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        };

        #[cfg(not(windows))]
        let spawn_result = Command::new(&exec_path)
            .args(&args)
            .current_dir(&cwd)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match spawn_result {
            Ok(c) => {
                info!("Spawn succeeded!");
                c
            }
            Err(e) => {
                let err_msg = format!(
                    "Failed to start agent process: {} (exec: {:?}, cwd: {})",
                    e, exec_path, cwd
                );
                error!("{}", err_msg);
                return Err(err_msg);
            }
        };

        info!("Agent child process started, pid: {:?}", child.id());

        // 创建 agent 日志文件（写入到 exe/debug/logs/mxu-agent.log）
        let agent_log_file = get_logs_dir().join("mxu-agent.log");
        let log_file = Arc::new(Mutex::new(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&agent_log_file)
                .ok(),
        ));
        info!("Agent log file: {:?}", agent_log_file);

        // 在单独线程中读取 stdout（使用有损转换处理非UTF-8输出）
        if let Some(stdout) = child.stdout.take() {
            let log_file_clone = Arc::clone(&log_file);
            let instance_id_clone = instance_id.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            // 移除末尾换行符后使用有损转换
                            if buffer.ends_with(&[b'\n']) {
                                buffer.pop();
                            }
                            if buffer.ends_with(&[b'\r']) {
                                buffer.pop();
                            }
                            let line = String::from_utf8_lossy(&buffer);
                            // 写入日志文件
                            if let Ok(mut guard) = log_file_clone.lock() {
                                if let Some(ref mut file) = *guard {
                                    let timestamp =
                                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                                    let _ = writeln!(file, "{} [stdout] {}", timestamp, line);
                                }
                            }
                            // 同时输出到控制台
                            log::info!(target: "agent", "[stdout] {}", line);
                            // 发送事件到前端
                            emit_agent_output(&instance_id_clone, "stdout", &line);
                        }
                        Err(e) => {
                            log::error!(target: "agent", "[stdout error] {}", e);
                            break;
                        }
                    }
                }
            });
        }

        // 在单独线程中读取 stderr（使用有损转换处理非UTF-8输出）
        if let Some(stderr) = child.stderr.take() {
            let log_file_clone = Arc::clone(&log_file);
            let instance_id_clone = instance_id.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            if buffer.ends_with(&[b'\n']) {
                                buffer.pop();
                            }
                            if buffer.ends_with(&[b'\r']) {
                                buffer.pop();
                            }
                            let line = String::from_utf8_lossy(&buffer);
                            // 写入日志文件
                            if let Ok(mut guard) = log_file_clone.lock() {
                                if let Some(ref mut file) = *guard {
                                    let timestamp =
                                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                                    let _ = writeln!(file, "{} [stderr] {}", timestamp, line);
                                }
                            }
                            // 同时输出到控制台
                            log::warn!(target: "agent", "[stderr] {}", line);
                            // 发送事件到前端
                            emit_agent_output(&instance_id_clone, "stderr", &line);
                        }
                        Err(e) => {
                            log::error!(target: "agent", "[stderr error] {}", e);
                            break;
                        }
                    }
                }
            });
        }

        // 设置连接超时并获取 connect 函数指针（在 guard 作用域内）
        let timeout_ms = agent.timeout.unwrap_or(-1);
        debug!("[agent] Setting up connection timeout and getting connect_fn...");
        let connect_fn = {
            debug!("[agent] Acquiring MAA_LIBRARY lock for timeout setup...");
            let guard = MAA_LIBRARY
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            debug!("[agent] MAA_LIBRARY lock acquired for timeout setup");
            let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

            info!("[agent] Setting agent connect timeout: {} ms", timeout_ms);
            debug!(
                "[agent] Calling maa_agent_client_set_timeout, agent_client ptr: {:?}",
                agent_client.as_ptr()
            );
            unsafe {
                (lib.maa_agent_client_set_timeout)(agent_client.as_ptr(), timeout_ms);
            }
            debug!("[agent] Timeout set, getting connect function pointer");
            lib.maa_agent_client_connect
        };
        debug!("[agent] MAA_LIBRARY lock released after timeout setup");

        // 等待连接（在独立线程池中执行，避免阻塞 UI 线程）
        let agent_ptr = agent_client.as_ptr() as usize;
        debug!("[agent] Agent pointer for connect: 0x{:x}", agent_ptr);

        info!("[agent] Waiting for agent connection (non-blocking)...");
        debug!("[agent] Spawning blocking task for maa_agent_client_connect...");
        let connected = tokio::task::spawn_blocking(move || {
            debug!(
                "[agent] Inside spawn_blocking: calling connect_fn with ptr 0x{:x}",
                agent_ptr
            );
            let result = unsafe { connect_fn(agent_ptr as *mut MaaAgentClient) };
            debug!(
                "[agent] Inside spawn_blocking: connect_fn returned {}",
                result
            );
            result
        })
        .await
        .map_err(|e| format!("Agent connect task panicked: {}", e))?;
        debug!("[agent] spawn_blocking completed, connected: {}", connected);

        if connected == 0 {
            // 连接失败，清理资源
            error!("[agent] Agent connection failed (connected=0), cleaning up...");
            debug!("[agent] Acquiring MAA_LIBRARY lock for cleanup...");
            let guard = MAA_LIBRARY
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

            debug!("[agent] Acquiring instances lock for cleanup...");
            let mut instances = state
                .instances
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            if let Some(instance) = instances.get_mut(&instance_id) {
                instance.agent_child = Some(child);
            }
            debug!("[agent] Destroying agent_client...");
            unsafe {
                (lib.maa_agent_client_destroy)(agent_client.as_ptr());
            }
            debug!("[agent] Agent cleanup complete");
            return Err("Failed to connect to agent".to_string());
        }

        info!("[agent] Agent connected successfully!");

        // 保存 agent 状态
        debug!("[agent] Saving agent state to instance...");
        {
            let mut instances = state
                .instances
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            if let Some(instance) = instances.get_mut(&instance_id) {
                instance.agent_client = Some(agent_client.as_ptr());
                instance.agent_child = Some(child);
            }
        }
        debug!("[agent] Agent state saved");

        debug!("[start_tasks] Agent setup complete, returning agent_client");
        Some(agent_client)
    } else {
        debug!("[start_tasks] No agent config, skipping agent setup");
        None
    };

    // 检查初始化状态并提交任务（重新获取 guard）
    debug!("[start_tasks] Re-acquiring MAA_LIBRARY lock for task submission...");
    let guard = MAA_LIBRARY
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    debug!("[start_tasks] MAA_LIBRARY lock re-acquired");
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    debug!(
        "[start_tasks] Checking tasker inited status, tasker ptr: {:?}",
        tasker.as_ptr()
    );
    let inited = unsafe { (lib.maa_tasker_inited)(tasker.as_ptr()) };
    info!("[start_tasks] Tasker inited status: {}", inited);
    if inited == 0 {
        error!(
            "[start_tasks] Tasker not properly initialized, inited: {}",
            inited
        );
        return Err("Tasker not properly initialized".to_string());
    }

    // 提交所有任务
    debug!("[start_tasks] Submitting {} tasks...", tasks.len());
    let mut task_ids = Vec::new();
    for (idx, task) in tasks.iter().enumerate() {
        debug!("[start_tasks] Preparing task {}: entry={}", idx, task.entry);
        let entry_c = to_cstring(&task.entry);
        let override_c = to_cstring(&task.pipeline_override);
        debug!("[start_tasks] CStrings created for task {}", idx);

        info!(
            "[start_tasks] Calling MaaTaskerPostTask: entry={}, override={}",
            task.entry, task.pipeline_override
        );
        let task_id = unsafe {
            (lib.maa_tasker_post_task)(tasker.as_ptr(), entry_c.as_ptr(), override_c.as_ptr())
        };

        info!(
            "[start_tasks] MaaTaskerPostTask returned task_id: {}",
            task_id
        );

        if task_id == MAA_INVALID_ID {
            warn!("[start_tasks] Failed to post task: {}", task.entry);
            continue;
        }

        task_ids.push(task_id);
        debug!(
            "[start_tasks] Task {} submitted successfully, task_id: {}",
            idx, task_id
        );
    }

    debug!(
        "[start_tasks] All tasks submitted, total: {} task_ids",
        task_ids.len()
    );

    // 释放 guard 后再访问 instances
    debug!("[start_tasks] Releasing MAA_LIBRARY lock...");
    drop(guard);

    // 缓存 task_ids，用于刷新后恢复状态
    debug!("[start_tasks] Caching task_ids...");
    {
        let mut instances = state
            .instances
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        if let Some(instance) = instances.get_mut(&instance_id) {
            instance.task_ids = task_ids.clone();
        }
    }
    debug!("[start_tasks] Task_ids cached");

    // agent_client 用于表示是否启动了 agent（用于调试日志）
    if agent_client.is_some() {
        info!("[start_tasks] Tasks started with agent");
    }

    info!(
        "[start_tasks] maa_start_tasks completed successfully, returning {} task_ids",
        task_ids.len()
    );
    Ok(task_ids)
}

/// 停止 Agent 并断开连接（异步执行，避免阻塞 UI）
/// 不强制 kill 子进程，等待 MaaTaskerPostStop 触发子进程自行退出
#[tauri::command]
pub fn maa_stop_agent(state: State<Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    info!("maa_stop_agent called for instance: {}", instance_id);

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    // 取出 agent 和 child，准备在后台线程清理
    let agent_opt = instance.agent_client.take();
    let child_opt = instance.agent_child.take();

    // 在后台线程执行阻塞的清理操作（disconnect 和 wait 可能阻塞）
    // 不 kill 子进程，依赖 MaaTaskerPostStop 让子进程自行结束
    if agent_opt.is_some() || child_opt.is_some() {
        let agent_ptr = agent_opt.map(SendPtr::new);
        thread::spawn(move || {
            // 断开并销毁 agent（disconnect 会发送 ShutDown 请求，等待子进程响应）
            if let Some(agent) = agent_ptr {
                let guard = MAA_LIBRARY.lock();
                if let Ok(guard) = guard {
                    if let Some(lib) = guard.as_ref() {
                        info!("Background: Disconnecting agent...");
                        unsafe {
                            (lib.maa_agent_client_disconnect)(agent.as_ptr());
                            (lib.maa_agent_client_destroy)(agent.as_ptr());
                        }
                        info!("Background: Agent disconnected and destroyed");
                    }
                }
            }

            // 等待子进程自行退出，避免僵尸进程
            if let Some(mut child) = child_opt {
                info!("Background: Waiting for agent child process to exit...");
                let _ = child.wait();
                info!("Background: Agent child process exited");
            }
        });
    }

    Ok(())
}

// ============================================================================
// 文件读取
// ============================================================================

/// 获取 exe 所在目录路径
fn get_exe_directory() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取 exe 路径失败: {}", e))?;
    exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法获取 exe 所在目录".to_string())
}

/// 读取 exe 同目录下的文本文件
#[tauri::command]
pub fn read_local_file(filename: String) -> Result<String, String> {
    let exe_dir = get_exe_directory()?;
    let file_path = normalize_path(&exe_dir.join(&filename).to_string_lossy());
    debug!("Reading local file: {:?}", file_path);

    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("读取文件失败 [{}]: {}", file_path.display(), e))
}

/// 读取 exe 同目录下的二进制文件，返回 base64 编码
#[tauri::command]
pub fn read_local_file_base64(filename: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let exe_dir = get_exe_directory()?;
    let file_path = normalize_path(&exe_dir.join(&filename).to_string_lossy());
    debug!("Reading local file (base64): {:?}", file_path);

    let data = std::fs::read(&file_path)
        .map_err(|e| format!("读取文件失败 [{}]: {}", file_path.display(), e))?;

    Ok(STANDARD.encode(&data))
}

/// 检查 exe 同目录下的文件是否存在
#[tauri::command]
pub fn local_file_exists(filename: String) -> Result<bool, String> {
    let exe_dir = get_exe_directory()?;
    let file_path = normalize_path(&exe_dir.join(&filename).to_string_lossy());
    Ok(file_path.exists())
}

/// 获取 exe 所在目录路径
#[tauri::command]
pub fn get_exe_dir() -> Result<String, String> {
    let exe_dir = get_exe_directory()?;
    Ok(exe_dir.to_string_lossy().to_string())
}

/// 获取当前工作目录
#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get current directory: {}", e))
}

/// 检查 exe 路径是否存在问题
/// 返回: None 表示正常, Some("root") 表示在磁盘根目录, Some("temp") 表示在临时目录
#[tauri::command]
pub fn check_exe_path() -> Option<String> {
    let exe_dir = match get_exe_directory() {
        Ok(dir) => dir,
        Err(_) => return None,
    };

    let path_str = exe_dir.to_string_lossy().to_lowercase();

    // 检查是否在磁盘根目录（如 C:\, D:\ 等）
    // Windows 根目录特征：路径只有盘符和反斜杠，如 "c:\" 或 "d:\"
    if exe_dir.parent().is_none() || exe_dir.parent() == Some(std::path::Path::new("")) {
        return Some("root".to_string());
    }

    // Windows 下额外检查：盘符根目录（如 C:\）
    #[cfg(target_os = "windows")]
    {
        let components: Vec<_> = exe_dir.components().collect();
        // 根目录只有一个组件（盘符前缀）
        if components.len() == 1 {
            return Some("root".to_string());
        }
    }

    // 检查是否在临时目录
    // 常见的临时目录特征
    let temp_indicators = [
        "\\temp\\",
        "/temp/",
        "\\tmp\\",
        "/tmp/",
        "\\appdata\\local\\temp",
        "/appdata/local/temp",
        // Windows 压缩包临时解压目录
        "\\temporary internet files\\",
        "\\7zocab",
        "\\7zo",
        // 一些压缩软件的临时目录
        "\\wz",
        "\\rar$",
        "\\temp_",
    ];

    for indicator in &temp_indicators {
        if path_str.contains(indicator) {
            return Some("temp".to_string());
        }
    }

    // 检查系统临时目录
    if let Ok(temp_dir) = std::env::var("TEMP") {
        let temp_lower = temp_dir.to_lowercase();
        if path_str.starts_with(&temp_lower) {
            return Some("temp".to_string());
        }
    }
    if let Ok(tmp_dir) = std::env::var("TMP") {
        let tmp_lower = tmp_dir.to_lowercase();
        if path_str.starts_with(&tmp_lower) {
            return Some("temp".to_string());
        }
    }

    None
}

// ============================================================================
// 状态查询命令
// ============================================================================

/// 获取单个实例的运行时状态
#[tauri::command]
pub fn maa_get_instance_state(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<InstanceState, String> {
    debug!(
        "maa_get_instance_state called, instance_id: {}",
        instance_id
    );

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    // 通过 Maa API 查询真实状态
    let connected = instance.controller.map_or(false, |ctrl| unsafe {
        (lib.maa_controller_connected)(ctrl) != 0
    });

    let resource_loaded = instance
        .resource
        .map_or(false, |res| unsafe { (lib.maa_resource_loaded)(res) != 0 });

    let tasker_inited = instance.tasker.map_or(false, |tasker| unsafe {
        (lib.maa_tasker_inited)(tasker) != 0
    });

    let is_running = instance.tasker.map_or(false, |tasker| unsafe {
        (lib.maa_tasker_running)(tasker) != 0
    });

    Ok(InstanceState {
        connected,
        resource_loaded,
        tasker_inited,
        is_running,
        task_ids: instance.task_ids.clone(),
    })
}

/// 获取所有实例的状态快照（用于前端启动时恢复状态）
#[tauri::command]
pub fn maa_get_all_states(state: State<Arc<MaaState>>) -> Result<AllInstanceStates, String> {
    debug!("maa_get_all_states called");

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref();

    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let cached_adb = state.cached_adb_devices.lock().map_err(|e| e.to_string())?;
    let cached_win32 = state
        .cached_win32_windows
        .lock()
        .map_err(|e| e.to_string())?;

    let mut instance_states = HashMap::new();

    // 如果 MaaFramework 未初始化，返回空状态
    if let Some(lib) = lib {
        for (id, instance) in instances.iter() {
            // 通过 Maa API 查询真实状态
            let connected = instance.controller.map_or(false, |ctrl| unsafe {
                (lib.maa_controller_connected)(ctrl) != 0
            });

            let resource_loaded = instance
                .resource
                .map_or(false, |res| unsafe { (lib.maa_resource_loaded)(res) != 0 });

            let tasker_inited = instance.tasker.map_or(false, |tasker| unsafe {
                (lib.maa_tasker_inited)(tasker) != 0
            });

            let is_running = instance.tasker.map_or(false, |tasker| unsafe {
                (lib.maa_tasker_running)(tasker) != 0
            });

            instance_states.insert(
                id.clone(),
                InstanceState {
                    connected,
                    resource_loaded,
                    tasker_inited,
                    is_running,
                    task_ids: instance.task_ids.clone(),
                },
            );
        }
    }

    Ok(AllInstanceStates {
        instances: instance_states,
        cached_adb_devices: cached_adb.clone(),
        cached_win32_windows: cached_win32.clone(),
    })
}

/// 获取缓存的 ADB 设备列表
#[tauri::command]
pub fn maa_get_cached_adb_devices(state: State<Arc<MaaState>>) -> Result<Vec<AdbDevice>, String> {
    debug!("maa_get_cached_adb_devices called");
    let cached = state.cached_adb_devices.lock().map_err(|e| e.to_string())?;
    Ok(cached.clone())
}

/// 获取缓存的 Win32 窗口列表
#[tauri::command]
pub fn maa_get_cached_win32_windows(
    state: State<Arc<MaaState>>,
) -> Result<Vec<Win32Window>, String> {
    debug!("maa_get_cached_win32_windows called");
    let cached = state
        .cached_win32_windows
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(cached.clone())
}

// ============================================================================
// 更新安装相关命令
// ============================================================================

/// 解压压缩文件到指定目录，支持 zip 和 tar.gz/tgz 格式
#[tauri::command]
pub fn extract_zip(zip_path: String, dest_dir: String) -> Result<(), String> {
    info!("extract_zip called: {} -> {}", zip_path, dest_dir);

    let path_lower = zip_path.to_lowercase();

    // 根据文件扩展名判断格式
    if path_lower.ends_with(".tar.gz") || path_lower.ends_with(".tgz") {
        extract_tar_gz(&zip_path, &dest_dir)
    } else {
        extract_zip_file(&zip_path, &dest_dir)
    }
}

/// 解压 ZIP 文件
fn extract_zip_file(zip_path: &str, dest_dir: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("无法打开 ZIP 文件 [{}]: {}", zip_path, e))?;

    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("无法解析 ZIP 文件: {}", e))?;

    // 确保目标目录存在
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("无法创建目录 [{}]: {}", dest_dir, e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("无法读取 ZIP 条目 {}: {}", i, e))?;

        let outpath = match file.enclosed_name() {
            Some(path) => std::path::Path::new(dest_dir).join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            // 目录
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("无法创建目录 [{}]: {}", outpath.display(), e))?;
        } else {
            // 文件
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p)
                        .map_err(|e| format!("无法创建父目录 [{}]: {}", p.display(), e))?;
                }
            }
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("无法创建文件 [{}]: {}", outpath.display(), e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("无法写入文件 [{}]: {}", outpath.display(), e))?;
        }
    }

    info!("extract_zip success");
    Ok(())
}

/// 解压 tar.gz/tgz 文件
fn extract_tar_gz(tar_path: &str, dest_dir: &str) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = std::fs::File::open(tar_path)
        .map_err(|e| format!("无法打开 tar.gz 文件 [{}]: {}", tar_path, e))?;

    let gz = GzDecoder::new(file);
    let mut archive = Archive::new(gz);

    // 确保目标目录存在
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("无法创建目录 [{}]: {}", dest_dir, e))?;

    archive
        .unpack(dest_dir)
        .map_err(|e| format!("解压 tar.gz 失败: {}", e))?;

    info!("extract_tar_gz success");
    Ok(())
}

/// 检查解压目录中是否存在 changes.json（增量包标识）
#[tauri::command]
pub fn check_changes_json(extract_dir: String) -> Result<Option<ChangesJson>, String> {
    let changes_path = std::path::Path::new(&extract_dir).join("changes.json");

    if !changes_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&changes_path)
        .map_err(|e| format!("无法读取 changes.json: {}", e))?;

    let changes: ChangesJson =
        serde_json::from_str(&content).map_err(|e| format!("无法解析 changes.json: {}", e))?;

    Ok(Some(changes))
}

/// changes.json 结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangesJson {
    #[serde(default)]
    pub added: Vec<String>,
    #[serde(default)]
    pub deleted: Vec<String>,
    #[serde(default)]
    pub modified: Vec<String>,
}

/// 递归清理目录内容，逐个删除文件和空目录，返回 (成功数, 失败数)
pub(crate) fn cleanup_dir_contents(dir: &std::path::Path) -> (usize, usize) {
    let mut deleted = 0;
    let mut failed = 0;

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // 递归清理子目录
                let (d, f) = cleanup_dir_contents(&path);
                deleted += d;
                failed += f;
                // 尝试删除空目录
                if std::fs::remove_dir(&path).is_ok() {
                    deleted += 1;
                }
            } else {
                // 删除文件
                match std::fs::remove_file(&path) {
                    Ok(()) => deleted += 1,
                    Err(_) => failed += 1,
                }
            }
        }
    }

    // 尝试删除根目录本身
    let _ = std::fs::remove_dir(dir);

    (deleted, failed)
}

/// 将文件或目录移动到程序目录下的 cache/old 文件夹，处理重名冲突
/// 供前端调用，统一文件移动逻辑
#[tauri::command]
pub fn move_file_to_old(file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    move_to_old_folder(path)
}

/// 将文件或目录移动到程序目录下的 cache/old 文件夹，处理重名冲突（内部函数）
fn move_to_old_folder(source: &std::path::Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    // 统一移动到 exe_dir/cache/old
    let exe_dir = get_exe_dir()?;
    let old_dir = std::path::Path::new(&exe_dir).join("cache").join("old");

    // 在移动前先尝试清理 old 目录，避免同名文件冲突
    if old_dir.exists() {
        // 1. 尝试删除整个目录
        if std::fs::remove_dir_all(&old_dir).is_err() {
            // 2. 如果失败，遍历删除里面每个文件/子目录
            let (deleted, failed) = cleanup_dir_contents(&old_dir);
            if deleted > 0 || failed > 0 {
                info!(
                    "Cleanup cache/old before move: {} deleted, {} failed",
                    deleted, failed
                );
            }
        }
    }

    // 确保目录存在（刚删掉的话需要重新创建）
    std::fs::create_dir_all(&old_dir)
        .map_err(|e| format!("无法创建 old 目录 [{}]: {}", old_dir.display(), e))?;

    let file_name = source
        .file_name()
        .ok_or_else(|| format!("无法获取文件名: {}", source.display()))?;

    let mut dest = old_dir.join(file_name);

    // 如果目标仍然存在（清理没删掉），添加 .bak001 等后缀
    if dest.exists() {
        let base_name = file_name.to_string_lossy();
        for i in 1..=999 {
            let new_name = format!("{}.bak{:03}", base_name, i);
            dest = old_dir.join(&new_name);
            if !dest.exists() {
                break;
            }
        }
        // 如果 999 个备份都存在，覆盖最后的
    }

    // 执行移动（重命名）
    std::fs::rename(source, &dest).map_err(|e| {
        format!(
            "无法移动 [{}] -> [{}]: {}",
            source.display(),
            dest.display(),
            e
        )
    })?;

    info!("Moved to old: {} -> {}", source.display(), dest.display());
    Ok(())
}

/// 应用增量更新：将 deleted 中的文件移动到 old 文件夹，然后复制新文件
/// 即使移动旧文件失败，也会继续复制新文件，确保程序可用
#[tauri::command]
pub fn apply_incremental_update(
    extract_dir: String,
    target_dir: String,
    deleted_files: Vec<String>,
) -> Result<(), String> {
    info!("apply_incremental_update called");
    info!("extract_dir: {}, target_dir: {}", extract_dir, target_dir);
    info!("deleted_files: {:?}", deleted_files);

    let target_path = std::path::Path::new(&target_dir);
    let mut move_errors: Vec<String> = Vec::new();

    // 1. 尝试将 deleted 中列出的文件移动到 old 文件夹（失败不阻断）
    for file in &deleted_files {
        let file_path = target_path.join(file);
        if file_path.exists() {
            if let Err(e) = move_to_old_folder(&file_path) {
                warn!("移动旧文件失败（将继续更新）: {}", e);
                move_errors.push(e);
            }
        }
    }

    // 2. 复制新包内容到目标目录（覆盖）- 这一步必须执行
    copy_dir_contents(&extract_dir, &target_dir, None)?;

    if !move_errors.is_empty() {
        info!(
            "apply_incremental_update completed with {} move warnings",
            move_errors.len()
        );
    } else {
        info!("apply_incremental_update success");
    }
    Ok(())
}

/// 应用全量更新：将与新包根目录同名的文件夹/文件移动到 old 文件夹，然后复制新文件
/// 即使移动旧文件失败，也会继续复制新文件，确保程序可用
#[tauri::command]
pub fn apply_full_update(extract_dir: String, target_dir: String) -> Result<(), String> {
    info!("apply_full_update called");
    info!("extract_dir: {}, target_dir: {}", extract_dir, target_dir);

    let extract_path = std::path::Path::new(&extract_dir);
    let target_path = std::path::Path::new(&target_dir);
    let mut move_errors: Vec<String> = Vec::new();

    // 1. 获取解压目录中的根级条目
    let entries: Vec<_> = std::fs::read_dir(extract_path)
        .map_err(|e| format!("无法读取解压目录: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    // 2. 尝试将目标目录中与新包同名的文件/文件夹移动到 old 文件夹（失败不阻断）
    for entry in &entries {
        let name = entry.file_name();
        let target_item = target_path.join(&name);

        // 跳过 changes.json
        if name == "changes.json" {
            continue;
        }

        if target_item.exists() {
            if let Err(e) = move_to_old_folder(&target_item) {
                warn!("移动旧文件失败（将继续更新）: {}", e);
                move_errors.push(e);
            }
        }
    }

    // 3. 复制新包内容到目标目录 - 这一步必须执行
    copy_dir_contents(&extract_dir, &target_dir, Some(&["changes.json"]))?;

    if !move_errors.is_empty() {
        info!(
            "apply_full_update completed with {} move warnings",
            move_errors.len()
        );
    } else {
        info!("apply_full_update success");
    }
    Ok(())
}

/// 复制单个文件，先尝试将目标文件移动到 old 目录再复制
/// 如果移动失败，直接尝试覆盖（确保新文件能被复制）
fn copy_file_with_move_old(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    // 如果目标文件存在，先尝试移动到 old 目录
    if dst.exists() {
        if let Err(e) = move_to_old_folder(dst) {
            warn!("移动旧文件到 old 目录失败，将直接覆盖: {}", e);
            // 移动失败时，尝试直接删除旧文件以便覆盖
            if let Err(del_err) = std::fs::remove_file(dst) {
                warn!("删除旧文件也失败: {}，尝试直接覆盖", del_err);
            }
        }
    }

    // 复制新文件
    std::fs::copy(src, dst).map_err(|e| {
        format!(
            "无法复制文件 [{}] -> [{}]: {}",
            src.display(),
            dst.display(),
            e
        )
    })?;

    Ok(())
}

/// 递归复制目录内容（不包含根目录本身）
fn copy_dir_contents(src: &str, dst: &str, skip_files: Option<&[&str]>) -> Result<(), String> {
    let src_path = std::path::Path::new(src);
    let dst_path = std::path::Path::new(dst);

    // 确保目标目录存在
    std::fs::create_dir_all(dst_path).map_err(|e| format!("无法创建目录 [{}]: {}", dst, e))?;

    for entry in
        std::fs::read_dir(src_path).map_err(|e| format!("无法读取目录 [{}]: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("无法读取目录条目: {}", e))?;
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // 检查是否需要跳过
        if let Some(skip) = skip_files {
            if skip.iter().any(|s| *s == file_name_str) {
                continue;
            }
        }

        let src_item = entry.path();
        let dst_item = dst_path.join(&file_name);

        if src_item.is_dir() {
            copy_dir_recursive(&src_item, &dst_item)?;
        } else {
            copy_file_with_move_old(&src_item, &dst_item)?;
        }
    }

    Ok(())
}

/// 递归复制整个目录
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("无法创建目录 [{}]: {}", dst.display(), e))?;

    for entry in
        std::fs::read_dir(src).map_err(|e| format!("无法读取目录 [{}]: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("无法读取目录条目: {}", e))?;
        let src_item = entry.path();
        let dst_item = dst.join(entry.file_name());

        if src_item.is_dir() {
            copy_dir_recursive(&src_item, &dst_item)?;
        } else {
            copy_file_with_move_old(&src_item, &dst_item)?;
        }
    }

    Ok(())
}

/// 清理临时解压目录
#[tauri::command]
pub fn cleanup_extract_dir(extract_dir: String) -> Result<(), String> {
    info!("cleanup_extract_dir: {}", extract_dir);

    let path = std::path::Path::new(&extract_dir);
    if path.exists() {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("无法清理目录 [{}]: {}", extract_dir, e))?;
    }

    Ok(())
}

/// 兜底更新：当正常更新失败时，将新文件解压到 v版本号 文件夹
/// 并复制 config 文件夹，让用户可以临时使用新版本
#[tauri::command]
pub fn fallback_update(
    extract_dir: String,
    target_dir: String,
    new_version: String,
) -> Result<String, String> {
    info!(
        "fallback_update called: extract_dir={}, target_dir={}, new_version={}",
        extract_dir, target_dir, new_version
    );

    let target_path = std::path::Path::new(&target_dir);

    // 创建 v版本号 文件夹（如 v1.2.3）
    let version_folder_name = format!("v{}", new_version.trim_start_matches('v'));
    let fallback_dir = target_path.join(&version_folder_name);

    // 如果已存在同名文件夹，加后缀
    let mut final_fallback_dir = fallback_dir.clone();
    let mut suffix = 0;
    while final_fallback_dir.exists() {
        suffix += 1;
        final_fallback_dir = target_path.join(format!("{}-{}", version_folder_name, suffix));
    }

    info!("创建兜底目录: {}", final_fallback_dir.display());

    // 创建兜底目录
    std::fs::create_dir_all(&final_fallback_dir).map_err(|e| format!("无法创建兜底目录: {}", e))?;

    // 复制解压的新文件到兜底目录
    copy_dir_contents(
        &extract_dir,
        final_fallback_dir.to_str().unwrap_or(""),
        Some(&["changes.json"]),
    )?;

    // 复制 config 文件夹（如果存在）
    let config_src = target_path.join("config");
    if config_src.exists() {
        let config_dst = final_fallback_dir.join("config");
        if let Err(e) = copy_dir_recursive(&config_src, &config_dst) {
            warn!("复制 config 文件夹失败: {}", e);
        } else {
            info!("已复制 config 文件夹到兜底目录");
        }
    }

    let result_path = final_fallback_dir.to_str().unwrap_or("").to_string();
    info!("fallback_update success: {}", result_path);

    Ok(result_path)
}

// ============================================================================
// 下载相关命令
// ============================================================================

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// 全局下载取消标志
static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
/// 当前下载的 session ID，用于区分不同的下载任务
static CURRENT_DOWNLOAD_SESSION: AtomicU64 = AtomicU64::new(0);

/// 下载进度事件数据
#[derive(Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub session_id: u64,
    pub downloaded_size: u64,
    pub total_size: u64,
    pub speed: u64,
    pub progress: f64,
}

/// 流式下载文件，支持进度回调和取消
///
/// 使用 reqwest 进行流式下载，直接写入文件而不经过内存缓冲，
/// 解决 JavaScript 下载大文件时的性能问题
///
/// 返回值包含 session_id，前端用于匹配进度事件
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    save_path: String,
    total_size: Option<u64>,
    proxy_url: Option<String>,
) -> Result<u64, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    info!("download_file: {} -> {}", url, save_path);

    // 生成新的 session ID，使旧下载的进度事件无效
    let session_id = CURRENT_DOWNLOAD_SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    info!("download_file session_id: {}", session_id);

    // 重置取消标志
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);

    let save_path_obj = std::path::Path::new(&save_path);

    // 确保目录存在
    if let Some(parent) = save_path_obj.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }

    // 使用临时文件名下载
    let temp_path = format!("{}.downloading", save_path);

    // 构建 HTTP 客户端和请求
    let mut client_builder = reqwest::Client::builder()
        .user_agent(build_user_agent())
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10));

    // 配置代理（如果提供）
    if let Some(ref proxy) = proxy_url {
        if !proxy.is_empty() {
            info!("[下载] 使用代理: {}", proxy);
            info!("[下载] 目标: {}", url);
            let reqwest_proxy = reqwest::Proxy::all(proxy).map_err(|e| {
                error!("代理配置失败: {} (代理地址: {})", e, proxy);
                format!(
                    "代理配置失败: {}。请检查代理格式是否正确（支持 http:// 或 socks5://）",
                    e
                )
            })?;
            client_builder = client_builder.proxy(reqwest_proxy);
        } else {
            info!("[下载] 直连（无代理）: {}", url);
        }
    } else {
        info!("[下载] 直连（无代理）: {}", url);
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP 错误: {}", response.status()));
    }

    // 获取文件大小
    let content_length = response.content_length();
    let total = total_size.or(content_length).unwrap_or(0);

    // 创建临时文件
    let mut file = std::fs::File::create(&temp_path).map_err(|e| format!("无法创建文件: {}", e))?;

    // 流式下载
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_progress_time = std::time::Instant::now();
    let mut last_downloaded: u64 = 0;

    // 使用较大的缓冲区减少写入次数
    let mut buffer = Vec::with_capacity(256 * 1024); // 256KB 缓冲

    while let Some(chunk) = stream.next().await {
        // 检查取消标志或 session 是否已过期
        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst)
            || CURRENT_DOWNLOAD_SESSION.load(Ordering::SeqCst) != session_id
        {
            info!("download_file cancelled (session {})", session_id);
            drop(file);
            // 清理临时文件
            let _ = std::fs::remove_file(&temp_path);
            return Err("下载已取消".to_string());
        }

        let chunk = chunk.map_err(|e| format!("下载数据失败: {}", e))?;

        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        // 当缓冲区达到一定大小时写入磁盘
        if buffer.len() >= 256 * 1024 {
            file.write_all(&buffer)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            buffer.clear();
        }

        // 每 100ms 发送一次进度更新
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(last_progress_time);
        if elapsed.as_millis() >= 100 {
            let bytes_in_interval = downloaded - last_downloaded;
            let speed = (bytes_in_interval as f64 / elapsed.as_secs_f64()) as u64;
            let progress = if total > 0 {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };

            let _ = app.emit(
                "download-progress",
                DownloadProgressEvent {
                    session_id,
                    downloaded_size: downloaded,
                    total_size: total,
                    speed,
                    progress,
                },
            );

            last_progress_time = now;
            last_downloaded = downloaded;
        }
    }

    // 最后再检查一次取消标志
    if DOWNLOAD_CANCELLED.load(Ordering::SeqCst)
        || CURRENT_DOWNLOAD_SESSION.load(Ordering::SeqCst) != session_id
    {
        info!(
            "download_file cancelled before finalization (session {})",
            session_id
        );
        drop(file);
        let _ = std::fs::remove_file(&temp_path);
        return Err("下载已取消".to_string());
    }

    // 写入剩余缓冲区
    if !buffer.is_empty() {
        file.write_all(&buffer)
            .map_err(|e| format!("写入文件失败: {}", e))?;
    }

    // 确保数据写入磁盘
    file.sync_all()
        .map_err(|e| format!("同步文件失败: {}", e))?;
    drop(file);

    // 发送最终进度
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            session_id,
            downloaded_size: downloaded,
            total_size: if total > 0 { total } else { downloaded },
            speed: 0,
            progress: 100.0,
        },
    );

    // 将可能存在的旧文件移动到 old 文件夹
    if save_path_obj.exists() {
        let _ = move_to_old_folder(save_path_obj);
    }

    // 重命名临时文件
    std::fs::rename(&temp_path, &save_path).map_err(|e| format!("重命名文件失败: {}", e))?;

    info!(
        "download_file completed: {} bytes (session {})",
        downloaded, session_id
    );
    Ok(session_id)
}

/// 取消下载
#[tauri::command]
pub fn cancel_download(save_path: String) -> Result<(), String> {
    info!("cancel_download called for: {}", save_path);

    // 设置取消标志，让下载循环退出
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);

    // 同时尝试删除临时文件（如果已经创建）
    let temp_path = format!("{}.downloading", save_path);
    let path = std::path::Path::new(&temp_path);

    if path.exists() {
        if let Err(e) = std::fs::remove_file(path) {
            // 文件可能正在被写入，记录警告但不报错
            warn!("cancel_download: failed to remove {}: {}", temp_path, e);
        } else {
            info!("cancel_download: removed {}", temp_path);
        }
    }

    Ok(())
}

/// 构建 User-Agent 字符串
fn build_user_agent() -> String {
    let version = env!("CARGO_PKG_VERSION");
    format!(
        "MXU/{} (Windows NT 10.0; Win64; x64; amd64) Tauri/2.0",
        version
    )
}

// ============================================================================
// 权限检查相关命令
// ============================================================================

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

    use std::process::Command;

    #[cfg(windows)]
    {
        let status = Command::new(&file_path)
            .status()
            .map_err(|e| format!("Failed to run file: {}", e))?;

        let exit_code = status.code().unwrap_or(-1);
        info!("run_and_wait finished with exit code: {}", exit_code);
        Ok(exit_code)
    }

    #[cfg(not(windows))]
    {
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
