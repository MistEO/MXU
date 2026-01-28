//! MaaFramework FFI bindings
//!
//! 通过 libloading 动态加载 MaaFramework 库，实现运行时绑定
//! 不同平台的动态库文件：
//! - Windows: MaaFramework.dll, MaaToolkit.dll
//! - macOS: libMaaFramework.dylib, libMaaToolkit.dylib
//! - Linux: libMaaFramework.so, libMaaToolkit.so

// 这是纯 FFI 绑定模块：符号/常量/字段会随着上层功能逐步启用。
// 若严格开启 dead_code，会在开发期产生大量无意义 warning，反而干扰排查真正问题。
#![allow(dead_code)]

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use libloading::Library;
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// 类型定义 (对应 MaaDef.h)
pub type MaaBool = u8;
pub type MaaSize = u64;
pub type MaaId = i64;
pub type MaaStatus = i32;

pub const MAA_STATUS_INVALID: MaaStatus = 0;
pub const MAA_STATUS_PENDING: MaaStatus = 1000;
pub const MAA_STATUS_RUNNING: MaaStatus = 2000;
pub const MAA_STATUS_SUCCEEDED: MaaStatus = 3000;
pub const MAA_STATUS_FAILED: MaaStatus = 4000;

pub const MAA_INVALID_ID: MaaId = 0;

// ADB 截图方法
pub type MaaAdbScreencapMethod = u64;
pub const MAA_ADB_SCREENCAP_DEFAULT: MaaAdbScreencapMethod = 0xFFFFFFFFFFFFFFFF
    & !(1 << 3)  // RawByNetcat
    & !(1 << 4)  // MinicapDirect
    & !(1 << 5); // MinicapStream

// ADB 输入方法
pub type MaaAdbInputMethod = u64;
pub const MAA_ADB_INPUT_DEFAULT: MaaAdbInputMethod = 0xFFFFFFFFFFFFFFFF & !(1 << 3); // EmulatorExtras

// Win32 截图方法
pub type MaaWin32ScreencapMethod = u64;
pub const MAA_WIN32_SCREENCAP_GDI: MaaWin32ScreencapMethod = 1;
pub const MAA_WIN32_SCREENCAP_FRAMEPOOL: MaaWin32ScreencapMethod = 1 << 1;
pub const MAA_WIN32_SCREENCAP_DXGI_DESKTOPDUP: MaaWin32ScreencapMethod = 1 << 2;

// Win32 输入方法
pub type MaaWin32InputMethod = u64;
pub const MAA_WIN32_INPUT_SEIZE: MaaWin32InputMethod = 1;
pub const MAA_WIN32_INPUT_SENDMESSAGE: MaaWin32InputMethod = 1 << 1;

// Gamepad 类型
pub type MaaGamepadType = i32;
pub const MAA_GAMEPAD_TYPE_XBOX360: MaaGamepadType = 1;
pub const MAA_GAMEPAD_TYPE_DUALSHOCK4: MaaGamepadType = 2;

// 选项
pub type MaaCtrlOption = i32;
pub const MAA_CTRL_OPTION_SCREENSHOT_TARGET_SHORT_SIDE: MaaCtrlOption = 2;

// 全局选项
pub type MaaGlobalOption = i32;
pub const MAA_GLOBAL_OPTION_SAVE_DRAW: MaaGlobalOption = 2;

// 不透明句柄类型
pub enum MaaResource {}
pub enum MaaController {}
pub enum MaaTasker {}
pub enum MaaStringBuffer {}
pub enum MaaImageBuffer {}
pub enum MaaToolkitAdbDeviceList {}
pub enum MaaToolkitAdbDevice {}
pub enum MaaToolkitDesktopWindowList {}
pub enum MaaToolkitDesktopWindow {}
pub enum MaaAgentClient {}

/// MaaFramework 原始指针的 Send 包装器
/// MaaFramework API 是线程安全的，可以安全地在线程间传递
#[derive(Clone, Copy)]
pub struct SendPtr<T>(pub *mut T);

unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

impl<T> SendPtr<T> {
    pub fn new(ptr: *mut T) -> Self {
        SendPtr(ptr)
    }

    pub fn as_ptr(&self) -> *mut T {
        self.0
    }

    pub fn is_null(&self) -> bool {
        self.0.is_null()
    }
}

// 回调类型
pub type MaaEventCallback = Option<
    extern "C" fn(
        handle: *mut c_void,
        message: *const c_char,
        details_json: *const c_char,
        trans_arg: *mut c_void,
    ),
>;

// 函数指针类型定义
type FnMaaVersion = unsafe extern "C" fn() -> *const c_char;
type FnMaaGlobalSetOption =
    unsafe extern "C" fn(MaaGlobalOption, *const c_void, MaaSize) -> MaaBool;
type FnMaaStringBufferCreate = unsafe extern "C" fn() -> *mut MaaStringBuffer;
type FnMaaStringBufferDestroy = unsafe extern "C" fn(*mut MaaStringBuffer);
type FnMaaStringBufferGet = unsafe extern "C" fn(*const MaaStringBuffer) -> *const c_char;

type FnMaaResourceCreate = unsafe extern "C" fn() -> *mut MaaResource;
type FnMaaResourceDestroy = unsafe extern "C" fn(*mut MaaResource);
type FnMaaResourcePostBundle = unsafe extern "C" fn(*mut MaaResource, *const c_char) -> MaaId;
type FnMaaResourceStatus = unsafe extern "C" fn(*mut MaaResource, MaaId) -> MaaStatus;
type FnMaaResourceWait = unsafe extern "C" fn(*mut MaaResource, MaaId) -> MaaStatus;
type FnMaaResourceLoaded = unsafe extern "C" fn(*mut MaaResource) -> MaaBool;
type FnMaaResourceAddSink =
    unsafe extern "C" fn(*mut MaaResource, MaaEventCallback, *mut c_void) -> MaaId;

type FnMaaAdbControllerCreate = unsafe extern "C" fn(
    *const c_char,
    *const c_char,
    MaaAdbScreencapMethod,
    MaaAdbInputMethod,
    *const c_char,
    *const c_char,
) -> *mut MaaController;
type FnMaaWin32ControllerCreate = unsafe extern "C" fn(
    *mut c_void,
    MaaWin32ScreencapMethod,
    MaaWin32InputMethod,
    MaaWin32InputMethod,
) -> *mut MaaController;
type FnMaaGamepadControllerCreate = unsafe extern "C" fn(
    *mut c_void,
    MaaGamepadType,
    MaaWin32ScreencapMethod,
) -> *mut MaaController;
type FnMaaControllerDestroy = unsafe extern "C" fn(*mut MaaController);
type FnMaaControllerPostConnection = unsafe extern "C" fn(*mut MaaController) -> MaaId;
type FnMaaControllerStatus = unsafe extern "C" fn(*mut MaaController, MaaId) -> MaaStatus;
type FnMaaControllerWait = unsafe extern "C" fn(*mut MaaController, MaaId) -> MaaStatus;
type FnMaaControllerConnected = unsafe extern "C" fn(*mut MaaController) -> MaaBool;
type FnMaaControllerSetOption =
    unsafe extern "C" fn(*mut MaaController, MaaCtrlOption, *const c_void, MaaSize) -> MaaBool;
type FnMaaControllerPostScreencap = unsafe extern "C" fn(*mut MaaController) -> MaaId;
type FnMaaControllerCachedImage =
    unsafe extern "C" fn(*mut MaaController, *mut MaaImageBuffer) -> MaaBool;
type FnMaaControllerAddSink =
    unsafe extern "C" fn(*mut MaaController, MaaEventCallback, *mut c_void) -> MaaId;

// ImageBuffer
type FnMaaImageBufferCreate = unsafe extern "C" fn() -> *mut MaaImageBuffer;
type FnMaaImageBufferDestroy = unsafe extern "C" fn(*mut MaaImageBuffer);
type FnMaaImageBufferGetEncoded = unsafe extern "C" fn(*const MaaImageBuffer) -> *const u8;
type FnMaaImageBufferGetEncodedSize = unsafe extern "C" fn(*const MaaImageBuffer) -> MaaSize;

type FnMaaTaskerCreate = unsafe extern "C" fn() -> *mut MaaTasker;
type FnMaaTaskerDestroy = unsafe extern "C" fn(*mut MaaTasker);
type FnMaaTaskerBindResource = unsafe extern "C" fn(*mut MaaTasker, *mut MaaResource) -> MaaBool;
type FnMaaTaskerBindController =
    unsafe extern "C" fn(*mut MaaTasker, *mut MaaController) -> MaaBool;
type FnMaaTaskerInited = unsafe extern "C" fn(*mut MaaTasker) -> MaaBool;
type FnMaaTaskerPostTask =
    unsafe extern "C" fn(*mut MaaTasker, *const c_char, *const c_char) -> MaaId;
type FnMaaTaskerStatus = unsafe extern "C" fn(*mut MaaTasker, MaaId) -> MaaStatus;
type FnMaaTaskerWait = unsafe extern "C" fn(*mut MaaTasker, MaaId) -> MaaStatus;
type FnMaaTaskerRunning = unsafe extern "C" fn(*mut MaaTasker) -> MaaBool;
type FnMaaTaskerPostStop = unsafe extern "C" fn(*mut MaaTasker) -> MaaId;
type FnMaaTaskerAddSink =
    unsafe extern "C" fn(*mut MaaTasker, MaaEventCallback, *mut c_void) -> MaaId;
type FnMaaTaskerAddContextSink =
    unsafe extern "C" fn(*mut MaaTasker, MaaEventCallback, *mut c_void) -> MaaId;
type FnMaaTaskerOverridePipeline =
    unsafe extern "C" fn(*mut MaaTasker, MaaId, *const c_char) -> MaaBool;

type FnMaaToolkitAdbDeviceListCreate = unsafe extern "C" fn() -> *mut MaaToolkitAdbDeviceList;
type FnMaaToolkitAdbDeviceListDestroy = unsafe extern "C" fn(*mut MaaToolkitAdbDeviceList);
type FnMaaToolkitAdbDeviceFind = unsafe extern "C" fn(*mut MaaToolkitAdbDeviceList) -> MaaBool;
type FnMaaToolkitAdbDeviceListSize =
    unsafe extern "C" fn(*const MaaToolkitAdbDeviceList) -> MaaSize;
type FnMaaToolkitAdbDeviceListAt =
    unsafe extern "C" fn(*const MaaToolkitAdbDeviceList, MaaSize) -> *const MaaToolkitAdbDevice;
type FnMaaToolkitAdbDeviceGetName =
    unsafe extern "C" fn(*const MaaToolkitAdbDevice) -> *const c_char;
type FnMaaToolkitAdbDeviceGetAdbPath =
    unsafe extern "C" fn(*const MaaToolkitAdbDevice) -> *const c_char;
type FnMaaToolkitAdbDeviceGetAddress =
    unsafe extern "C" fn(*const MaaToolkitAdbDevice) -> *const c_char;
type FnMaaToolkitAdbDeviceGetScreencapMethods =
    unsafe extern "C" fn(*const MaaToolkitAdbDevice) -> MaaAdbScreencapMethod;
type FnMaaToolkitAdbDeviceGetInputMethods =
    unsafe extern "C" fn(*const MaaToolkitAdbDevice) -> MaaAdbInputMethod;
type FnMaaToolkitAdbDeviceGetConfig =
    unsafe extern "C" fn(*const MaaToolkitAdbDevice) -> *const c_char;

type FnMaaToolkitDesktopWindowListCreate =
    unsafe extern "C" fn() -> *mut MaaToolkitDesktopWindowList;
type FnMaaToolkitDesktopWindowListDestroy = unsafe extern "C" fn(*mut MaaToolkitDesktopWindowList);
type FnMaaToolkitDesktopWindowFindAll =
    unsafe extern "C" fn(*mut MaaToolkitDesktopWindowList) -> MaaBool;
type FnMaaToolkitDesktopWindowListSize =
    unsafe extern "C" fn(*const MaaToolkitDesktopWindowList) -> MaaSize;
type FnMaaToolkitDesktopWindowListAt = unsafe extern "C" fn(
    *const MaaToolkitDesktopWindowList,
    MaaSize,
) -> *const MaaToolkitDesktopWindow;
type FnMaaToolkitDesktopWindowGetHandle =
    unsafe extern "C" fn(*const MaaToolkitDesktopWindow) -> *mut c_void;
type FnMaaToolkitDesktopWindowGetClassName =
    unsafe extern "C" fn(*const MaaToolkitDesktopWindow) -> *const c_char;
type FnMaaToolkitDesktopWindowGetWindowName =
    unsafe extern "C" fn(*const MaaToolkitDesktopWindow) -> *const c_char;

// Toolkit - Config
type FnMaaToolkitConfigInitOption = unsafe extern "C" fn(*const c_char, *const c_char) -> MaaBool;

// AgentClient
type FnMaaAgentClientCreateV2 = unsafe extern "C" fn(*const MaaStringBuffer) -> *mut MaaAgentClient;
type FnMaaAgentClientCreateTcp = unsafe extern "C" fn(u16) -> *mut MaaAgentClient;
type FnMaaAgentClientDestroy = unsafe extern "C" fn(*mut MaaAgentClient);
type FnMaaAgentClientIdentifier =
    unsafe extern "C" fn(*mut MaaAgentClient, *mut MaaStringBuffer) -> MaaBool;
type FnMaaAgentClientBindResource =
    unsafe extern "C" fn(*mut MaaAgentClient, *mut MaaResource) -> MaaBool;
type FnMaaAgentClientConnect = unsafe extern "C" fn(*mut MaaAgentClient) -> MaaBool;
type FnMaaAgentClientDisconnect = unsafe extern "C" fn(*mut MaaAgentClient) -> MaaBool;
type FnMaaAgentClientSetTimeout = unsafe extern "C" fn(*mut MaaAgentClient, i64) -> MaaBool;

/// MaaFramework 库包装器
pub struct MaaLibrary {
    _framework_lib: Library,
    _toolkit_lib: Library,
    _agent_client_lib: Library,

    // MaaFramework 函数
    pub maa_version: FnMaaVersion,
    pub maa_set_global_option: FnMaaGlobalSetOption,

    // StringBuffer
    pub maa_string_buffer_create: FnMaaStringBufferCreate,
    pub maa_string_buffer_destroy: FnMaaStringBufferDestroy,
    pub maa_string_buffer_get: FnMaaStringBufferGet,

    // Resource
    pub maa_resource_create: FnMaaResourceCreate,
    pub maa_resource_destroy: FnMaaResourceDestroy,
    pub maa_resource_post_bundle: FnMaaResourcePostBundle,
    pub maa_resource_status: FnMaaResourceStatus,
    pub maa_resource_wait: FnMaaResourceWait,
    pub maa_resource_loaded: FnMaaResourceLoaded,
    pub maa_resource_add_sink: FnMaaResourceAddSink,

    // Controller
    pub maa_adb_controller_create: FnMaaAdbControllerCreate,
    pub maa_win32_controller_create: FnMaaWin32ControllerCreate,
    pub maa_gamepad_controller_create: FnMaaGamepadControllerCreate,
    pub maa_controller_destroy: FnMaaControllerDestroy,
    pub maa_controller_post_connection: FnMaaControllerPostConnection,
    pub maa_controller_status: FnMaaControllerStatus,
    pub maa_controller_wait: FnMaaControllerWait,
    pub maa_controller_connected: FnMaaControllerConnected,
    pub maa_controller_set_option: FnMaaControllerSetOption,
    pub maa_controller_post_screencap: FnMaaControllerPostScreencap,
    pub maa_controller_cached_image: FnMaaControllerCachedImage,
    pub maa_controller_add_sink: FnMaaControllerAddSink,

    // ImageBuffer
    pub maa_image_buffer_create: FnMaaImageBufferCreate,
    pub maa_image_buffer_destroy: FnMaaImageBufferDestroy,
    pub maa_image_buffer_get_encoded: FnMaaImageBufferGetEncoded,
    pub maa_image_buffer_get_encoded_size: FnMaaImageBufferGetEncodedSize,

    // Tasker
    pub maa_tasker_create: FnMaaTaskerCreate,
    pub maa_tasker_destroy: FnMaaTaskerDestroy,
    pub maa_tasker_bind_resource: FnMaaTaskerBindResource,
    pub maa_tasker_bind_controller: FnMaaTaskerBindController,
    pub maa_tasker_inited: FnMaaTaskerInited,
    pub maa_tasker_post_task: FnMaaTaskerPostTask,
    pub maa_tasker_status: FnMaaTaskerStatus,
    pub maa_tasker_wait: FnMaaTaskerWait,
    pub maa_tasker_running: FnMaaTaskerRunning,
    pub maa_tasker_post_stop: FnMaaTaskerPostStop,
    pub maa_tasker_add_sink: FnMaaTaskerAddSink,
    pub maa_tasker_add_context_sink: FnMaaTaskerAddContextSink,
    /// 可选函数：旧版本 MaaFramework 可能不支持
    pub maa_tasker_override_pipeline: Option<FnMaaTaskerOverridePipeline>,

    // Toolkit - ADB Device
    pub maa_toolkit_adb_device_list_create: FnMaaToolkitAdbDeviceListCreate,
    pub maa_toolkit_adb_device_list_destroy: FnMaaToolkitAdbDeviceListDestroy,
    pub maa_toolkit_adb_device_find: FnMaaToolkitAdbDeviceFind,
    pub maa_toolkit_adb_device_list_size: FnMaaToolkitAdbDeviceListSize,
    pub maa_toolkit_adb_device_list_at: FnMaaToolkitAdbDeviceListAt,
    pub maa_toolkit_adb_device_get_name: FnMaaToolkitAdbDeviceGetName,
    pub maa_toolkit_adb_device_get_adb_path: FnMaaToolkitAdbDeviceGetAdbPath,
    pub maa_toolkit_adb_device_get_address: FnMaaToolkitAdbDeviceGetAddress,
    pub maa_toolkit_adb_device_get_screencap_methods: FnMaaToolkitAdbDeviceGetScreencapMethods,
    pub maa_toolkit_adb_device_get_input_methods: FnMaaToolkitAdbDeviceGetInputMethods,
    pub maa_toolkit_adb_device_get_config: FnMaaToolkitAdbDeviceGetConfig,

    // Toolkit - Desktop Window
    pub maa_toolkit_desktop_window_list_create: FnMaaToolkitDesktopWindowListCreate,
    pub maa_toolkit_desktop_window_list_destroy: FnMaaToolkitDesktopWindowListDestroy,
    pub maa_toolkit_desktop_window_find_all: FnMaaToolkitDesktopWindowFindAll,
    pub maa_toolkit_desktop_window_list_size: FnMaaToolkitDesktopWindowListSize,
    pub maa_toolkit_desktop_window_list_at: FnMaaToolkitDesktopWindowListAt,
    pub maa_toolkit_desktop_window_get_handle: FnMaaToolkitDesktopWindowGetHandle,
    pub maa_toolkit_desktop_window_get_class_name: FnMaaToolkitDesktopWindowGetClassName,
    pub maa_toolkit_desktop_window_get_window_name: FnMaaToolkitDesktopWindowGetWindowName,

    // Toolkit - Config
    pub maa_toolkit_config_init_option: FnMaaToolkitConfigInitOption,

    // AgentClient
    pub maa_agent_client_create_v2: FnMaaAgentClientCreateV2,
    /// 可选函数：旧版本 MaaFramework 可能不支持 TCP 模式
    pub maa_agent_client_create_tcp: Option<FnMaaAgentClientCreateTcp>,
    pub maa_agent_client_destroy: FnMaaAgentClientDestroy,
    pub maa_agent_client_identifier: FnMaaAgentClientIdentifier,
    pub maa_agent_client_bind_resource: FnMaaAgentClientBindResource,
    pub maa_agent_client_connect: FnMaaAgentClientConnect,
    pub maa_agent_client_disconnect: FnMaaAgentClientDisconnect,
    pub maa_agent_client_set_timeout: FnMaaAgentClientSetTimeout,
}

// 注意：函数指针是 Send 和 Sync 的
unsafe impl Send for MaaLibrary {}
unsafe impl Sync for MaaLibrary {}

impl MaaLibrary {
    pub fn load(lib_dir: &Path) -> Result<Self, String> {
        // Windows: 将 lib_dir 添加到 DLL 搜索路径，确保依赖 DLL 能被找到
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            #[link(name = "kernel32")]
            extern "system" {
                fn SetDllDirectoryW(path: *const u16) -> i32;
            }
            let wide_path: Vec<u16> = lib_dir
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let result = unsafe { SetDllDirectoryW(wide_path.as_ptr()) };
            if result == 0 {
                warn!("SetDllDirectoryW failed");
            } else {
                debug!("SetDllDirectoryW set to {:?}", lib_dir);
            }
        }

        unsafe {
            // 加载库
            #[cfg(windows)]
            let framework_path = lib_dir.join("MaaFramework.dll");
            #[cfg(target_os = "macos")]
            let framework_path = lib_dir.join("libMaaFramework.dylib");
            #[cfg(target_os = "linux")]
            let framework_path = lib_dir.join("libMaaFramework.so");

            #[cfg(windows)]
            let toolkit_path = lib_dir.join("MaaToolkit.dll");
            #[cfg(target_os = "macos")]
            let toolkit_path = lib_dir.join("libMaaToolkit.dylib");
            #[cfg(target_os = "linux")]
            let toolkit_path = lib_dir.join("libMaaToolkit.so");

            #[cfg(windows)]
            let agent_client_path = lib_dir.join("MaaAgentClient.dll");
            #[cfg(target_os = "macos")]
            let agent_client_path = lib_dir.join("libMaaAgentClient.dylib");
            #[cfg(target_os = "linux")]
            let agent_client_path = lib_dir.join("libMaaAgentClient.so");

            info!("Loading MaaFramework from {:?}...", framework_path);
            let framework_lib = Library::new(&framework_path).map_err(|e| {
                format!(
                    "Failed to load MaaFramework: {} (path: {:?})",
                    e, framework_path
                )
            })?;
            info!("MaaFramework loaded successfully");

            info!("Loading MaaToolkit from {:?}...", toolkit_path);
            let toolkit_lib = Library::new(&toolkit_path).map_err(|e| {
                format!(
                    "Failed to load MaaToolkit: {} (path: {:?})",
                    e, toolkit_path
                )
            })?;
            info!("MaaToolkit loaded successfully");

            info!("Loading MaaAgentClient from {:?}...", agent_client_path);
            let agent_client_lib = Library::new(&agent_client_path).map_err(|e| {
                format!(
                    "Failed to load MaaAgentClient: {} (path: {:?})",
                    e, agent_client_path
                )
            })?;
            info!("MaaAgentClient loaded successfully");

            // 加载函数宏 - 使用 transmute 进行类型转换
            macro_rules! load_fn {
                ($lib:expr, $name:literal) => {{
                    let sym = $lib
                        .get::<*const ()>($name.as_bytes())
                        .map_err(|e| format!("Failed to load {}: {}", $name, e))?;
                    std::mem::transmute(*sym)
                }};
            }

            // 可选加载函数宏 - 加载失败返回 None 而非错误（用于向后兼容旧版本 DLL）
            macro_rules! load_fn_optional {
                ($lib:expr, $name:literal) => {{
                    match $lib.get::<*const ()>($name.as_bytes()) {
                        Ok(sym) => Some(std::mem::transmute(*sym)),
                        Err(e) => {
                            warn!("Optional function {} not available: {}", $name, e);
                            None
                        }
                    }
                }};
            }

            Ok(Self {
                // Version
                maa_version: load_fn!(framework_lib, "MaaVersion"),
                maa_set_global_option: load_fn!(framework_lib, "MaaGlobalSetOption"),

                // StringBuffer
                maa_string_buffer_create: load_fn!(framework_lib, "MaaStringBufferCreate"),
                maa_string_buffer_destroy: load_fn!(framework_lib, "MaaStringBufferDestroy"),
                maa_string_buffer_get: load_fn!(framework_lib, "MaaStringBufferGet"),

                // Resource
                maa_resource_create: load_fn!(framework_lib, "MaaResourceCreate"),
                maa_resource_destroy: load_fn!(framework_lib, "MaaResourceDestroy"),
                maa_resource_post_bundle: load_fn!(framework_lib, "MaaResourcePostBundle"),
                maa_resource_status: load_fn!(framework_lib, "MaaResourceStatus"),
                maa_resource_wait: load_fn!(framework_lib, "MaaResourceWait"),
                maa_resource_loaded: load_fn!(framework_lib, "MaaResourceLoaded"),
                maa_resource_add_sink: load_fn!(framework_lib, "MaaResourceAddSink"),

                // Controller
                maa_adb_controller_create: load_fn!(framework_lib, "MaaAdbControllerCreate"),
                maa_win32_controller_create: load_fn!(framework_lib, "MaaWin32ControllerCreate"),
                maa_gamepad_controller_create: load_fn!(
                    framework_lib,
                    "MaaGamepadControllerCreate"
                ),
                maa_controller_destroy: load_fn!(framework_lib, "MaaControllerDestroy"),
                maa_controller_post_connection: load_fn!(
                    framework_lib,
                    "MaaControllerPostConnection"
                ),
                maa_controller_status: load_fn!(framework_lib, "MaaControllerStatus"),
                maa_controller_wait: load_fn!(framework_lib, "MaaControllerWait"),
                maa_controller_connected: load_fn!(framework_lib, "MaaControllerConnected"),
                maa_controller_set_option: load_fn!(framework_lib, "MaaControllerSetOption"),
                maa_controller_post_screencap: load_fn!(
                    framework_lib,
                    "MaaControllerPostScreencap"
                ),
                maa_controller_cached_image: load_fn!(framework_lib, "MaaControllerCachedImage"),
                maa_controller_add_sink: load_fn!(framework_lib, "MaaControllerAddSink"),

                // ImageBuffer
                maa_image_buffer_create: load_fn!(framework_lib, "MaaImageBufferCreate"),
                maa_image_buffer_destroy: load_fn!(framework_lib, "MaaImageBufferDestroy"),
                maa_image_buffer_get_encoded: load_fn!(framework_lib, "MaaImageBufferGetEncoded"),
                maa_image_buffer_get_encoded_size: load_fn!(
                    framework_lib,
                    "MaaImageBufferGetEncodedSize"
                ),

                // Tasker
                maa_tasker_create: load_fn!(framework_lib, "MaaTaskerCreate"),
                maa_tasker_destroy: load_fn!(framework_lib, "MaaTaskerDestroy"),
                maa_tasker_bind_resource: load_fn!(framework_lib, "MaaTaskerBindResource"),
                maa_tasker_bind_controller: load_fn!(framework_lib, "MaaTaskerBindController"),
                maa_tasker_inited: load_fn!(framework_lib, "MaaTaskerInited"),
                maa_tasker_post_task: load_fn!(framework_lib, "MaaTaskerPostTask"),
                maa_tasker_status: load_fn!(framework_lib, "MaaTaskerStatus"),
                maa_tasker_wait: load_fn!(framework_lib, "MaaTaskerWait"),
                maa_tasker_running: load_fn!(framework_lib, "MaaTaskerRunning"),
                maa_tasker_post_stop: load_fn!(framework_lib, "MaaTaskerPostStop"),
                maa_tasker_add_sink: load_fn!(framework_lib, "MaaTaskerAddSink"),
                maa_tasker_add_context_sink: load_fn!(framework_lib, "MaaTaskerAddContextSink"),
                maa_tasker_override_pipeline: load_fn_optional!(
                    framework_lib,
                    "MaaTaskerOverridePipeline"
                ),

                // Toolkit - ADB Device
                maa_toolkit_adb_device_list_create: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceListCreate"
                ),
                maa_toolkit_adb_device_list_destroy: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceListDestroy"
                ),
                maa_toolkit_adb_device_find: load_fn!(toolkit_lib, "MaaToolkitAdbDeviceFind"),
                maa_toolkit_adb_device_list_size: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceListSize"
                ),
                maa_toolkit_adb_device_list_at: load_fn!(toolkit_lib, "MaaToolkitAdbDeviceListAt"),
                maa_toolkit_adb_device_get_name: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceGetName"
                ),
                maa_toolkit_adb_device_get_adb_path: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceGetAdbPath"
                ),
                maa_toolkit_adb_device_get_address: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceGetAddress"
                ),
                maa_toolkit_adb_device_get_screencap_methods: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceGetScreencapMethods"
                ),
                maa_toolkit_adb_device_get_input_methods: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceGetInputMethods"
                ),
                maa_toolkit_adb_device_get_config: load_fn!(
                    toolkit_lib,
                    "MaaToolkitAdbDeviceGetConfig"
                ),

                // Toolkit - Desktop Window
                maa_toolkit_desktop_window_list_create: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowListCreate"
                ),
                maa_toolkit_desktop_window_list_destroy: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowListDestroy"
                ),
                maa_toolkit_desktop_window_find_all: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowFindAll"
                ),
                maa_toolkit_desktop_window_list_size: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowListSize"
                ),
                maa_toolkit_desktop_window_list_at: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowListAt"
                ),
                maa_toolkit_desktop_window_get_handle: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowGetHandle"
                ),
                maa_toolkit_desktop_window_get_class_name: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowGetClassName"
                ),
                maa_toolkit_desktop_window_get_window_name: load_fn!(
                    toolkit_lib,
                    "MaaToolkitDesktopWindowGetWindowName"
                ),

                // Toolkit - Config
                maa_toolkit_config_init_option: load_fn!(toolkit_lib, "MaaToolkitConfigInitOption"),

                // AgentClient
                maa_agent_client_create_v2: load_fn!(agent_client_lib, "MaaAgentClientCreateV2"),
                maa_agent_client_create_tcp: load_fn_optional!(agent_client_lib, "MaaAgentClientCreateTcp"),
                maa_agent_client_destroy: load_fn!(agent_client_lib, "MaaAgentClientDestroy"),
                maa_agent_client_identifier: load_fn!(agent_client_lib, "MaaAgentClientIdentifier"),
                maa_agent_client_bind_resource: load_fn!(
                    agent_client_lib,
                    "MaaAgentClientBindResource"
                ),
                maa_agent_client_connect: load_fn!(agent_client_lib, "MaaAgentClientConnect"),
                maa_agent_client_disconnect: load_fn!(agent_client_lib, "MaaAgentClientDisconnect"),
                maa_agent_client_set_timeout: load_fn!(
                    agent_client_lib,
                    "MaaAgentClientSetTimeout"
                ),

                _framework_lib: framework_lib,
                _toolkit_lib: toolkit_lib,
                _agent_client_lib: agent_client_lib,
            })
        }
    }

    pub fn version(&self) -> String {
        unsafe {
            let ptr = (self.maa_version)();
            if ptr.is_null() {
                return String::new();
            }
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

/// 全局 MaaLibrary 实例
pub static MAA_LIBRARY: Lazy<Mutex<Option<MaaLibrary>>> = Lazy::new(|| Mutex::new(None));

/// 标记是否检测到可能缺少 VC++ 运行库（DLL 存在但加载失败）
static VCREDIST_MISSING_DETECTED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

/// 设置 VC++ 运行库缺失标记
pub fn set_vcredist_missing(missing: bool) {
    if let Ok(mut guard) = VCREDIST_MISSING_DETECTED.lock() {
        *guard = missing;
    }
}

/// 检查并消费 VC++ 运行库缺失标记（检查后自动重置为 false）
pub fn check_and_clear_vcredist_missing() -> bool {
    if let Ok(mut guard) = VCREDIST_MISSING_DETECTED.lock() {
        let was_missing = *guard;
        *guard = false;
        return was_missing;
    }
    false
}

/// 库加载错误类型
#[derive(Debug, Clone, Serialize)]
pub enum MaaLibraryError {
    /// DLL 文件不存在
    FileNotFound(String),
    /// DLL 存在但加载失败（可能是运行库缺失）
    LoadFailed {
        path: String,
        error: String,
        dlls_exist: bool,
    },
    /// 其他错误
    Other(String),
}

impl std::fmt::Display for MaaLibraryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MaaLibraryError::FileNotFound(path) => write!(f, "DLL file not found: {}", path),
            MaaLibraryError::LoadFailed { path, error, .. } => {
                write!(f, "Failed to load DLL: {} ({})", path, error)
            }
            MaaLibraryError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

/// 检查 maafw 目录下的关键 DLL 是否存在
pub fn check_dlls_exist(lib_dir: &Path) -> bool {
    #[cfg(windows)]
    {
        let framework_path = lib_dir.join("MaaFramework.dll");
        let toolkit_path = lib_dir.join("MaaToolkit.dll");
        framework_path.exists() && toolkit_path.exists()
    }
    #[cfg(not(windows))]
    {
        // 非 Windows 平台不需要 VC++ 运行库
        let _ = lib_dir;
        false
    }
}

/// 初始化 MaaFramework 库
pub fn init_maa_library(lib_dir: &Path) -> Result<(), MaaLibraryError> {
    let lib = MaaLibrary::load(lib_dir).map_err(|e| {
        // 检查 DLL 文件是否存在
        let dlls_exist = check_dlls_exist(lib_dir);
        if dlls_exist {
            // DLL 存在但加载失败，可能是运行库缺失
            MaaLibraryError::LoadFailed {
                path: lib_dir.to_string_lossy().into_owned(),
                error: e,
                dlls_exist: true,
            }
        } else {
            MaaLibraryError::FileNotFound(lib_dir.to_string_lossy().into_owned())
        }
    })?;

    // 初始化 Toolkit 配置，user_path 指向 exe 目录，避免 MaaFramework 日志落在 maafw 目录
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let user_path_str = exe_dir.to_string_lossy();
    let user_path = to_cstring(&user_path_str);
    let default_json = to_cstring("{}");
    debug!("MaaToolkitConfigInitOption user_path: {}", user_path_str);
    let result =
        unsafe { (lib.maa_toolkit_config_init_option)(user_path.as_ptr(), default_json.as_ptr()) };
    debug!("MaaToolkitConfigInitOption result: {}", result);

    let mut guard = MAA_LIBRARY
        .lock()
        .map_err(|e| MaaLibraryError::Other(e.to_string()))?;
    *guard = Some(lib);
    Ok(())
}

/// 获取 MaaFramework 版本
pub fn get_maa_version() -> Option<String> {
    let guard = MAA_LIBRARY.lock().ok()?;
    guard.as_ref().map(|lib| lib.version())
}

/// 缓存的版本号（从独立加载获取）
static CACHED_VERSION: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// 独立获取 MaaFramework 版本（不依赖完整库加载）
/// 只加载 MaaVersion 函数，用于版本检查
pub fn get_maa_version_standalone(lib_dir: &Path) -> Option<String> {
    // 先检查缓存
    if let Ok(guard) = CACHED_VERSION.lock() {
        if let Some(ref version) = *guard {
            return Some(version.clone());
        }
    }

    // 尝试从已加载的库获取
    if let Some(version) = get_maa_version() {
        // 缓存结果
        if let Ok(mut guard) = CACHED_VERSION.lock() {
            *guard = Some(version.clone());
        }
        return Some(version);
    }

    // 独立加载 MaaFramework.dll 仅获取版本
    #[cfg(windows)]
    let framework_path = lib_dir.join("MaaFramework.dll");
    #[cfg(target_os = "macos")]
    let framework_path = lib_dir.join("libMaaFramework.dylib");
    #[cfg(target_os = "linux")]
    let framework_path = lib_dir.join("libMaaFramework.so");

    let version = unsafe {
        let lib = Library::new(&framework_path).ok()?;
        let sym = lib.get::<*const ()>(b"MaaVersion").ok()?;
        let maa_version: FnMaaVersion = std::mem::transmute(*sym);
        let ptr = maa_version();
        if ptr.is_null() {
            return None;
        }
        let version = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        // 注意：这里 lib 会在作用域结束时被 drop，但版本字符串已经复制出来了
        Some(version)
    };

    // 缓存结果
    if let Some(ref v) = version {
        if let Ok(mut guard) = CACHED_VERSION.lock() {
            *guard = Some(v.clone());
        }
    }

    version
}

/// 辅助函数：将 &str 转换为 CString
pub fn to_cstring(s: &str) -> CString {
    CString::new(s).unwrap_or_else(|_| CString::new("").unwrap())
}

/// 辅助函数：从 C 字符串指针读取字符串
pub unsafe fn from_cstr(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

// ============================================================================
// 回调系统
// ============================================================================

/// 全局 AppHandle 存储，用于在回调中发送事件到前端
static APP_HANDLE: Lazy<Mutex<Option<AppHandle>>> = Lazy::new(|| Mutex::new(None));

/// 设置全局 AppHandle（用于发送事件到前端）
pub fn set_app_handle(handle: AppHandle) {
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(handle);
    }
}

/// MaaFramework 回调事件载荷
#[derive(Clone, Serialize)]
pub struct MaaCallbackEvent {
    /// 消息类型，如 "Resource.Loading.Succeeded", "Controller.Action.Succeeded", "Tasker.Task.Succeeded"
    pub message: String,
    /// 详细数据 JSON 字符串
    pub details: String,
}

/// Agent 输出事件载荷
#[derive(Clone, Serialize)]
pub struct AgentOutputEvent {
    /// 实例 ID
    pub instance_id: String,
    /// 输出流类型: "stdout" 或 "stderr"
    pub stream: String,
    /// 输出内容
    pub line: String,
}

/// 用于过滤 ANSI 转义序列的正则表达式
static ANSI_ESCAPE_RE: Lazy<regex::Regex> = Lazy::new(|| {
    // 匹配 ANSI CSI 序列（颜色、光标控制等）和 OSC 序列（终端标题等）
    regex::Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07?").unwrap()
});

/// 移除字符串中的 ANSI 转义序列
fn strip_ansi_escapes(s: &str) -> String {
    ANSI_ESCAPE_RE.replace_all(s, "").into_owned()
}

/// 发送 Agent 输出事件到前端
pub fn emit_agent_output(instance_id: &str, stream: &str, line: &str) {
    // 使用 catch_unwind 捕获潜在的 panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // 快速克隆 AppHandle 后立即释放锁，避免阻塞 MaaFramework 工作线程
        let handle = match APP_HANDLE.lock() {
            Ok(guard) => guard.clone(),
            Err(e) => {
                log::error!("[agent_output] Failed to lock APP_HANDLE: {}", e);
                return;
            }
        };

        if let Some(handle) = handle {
            let event = AgentOutputEvent {
                instance_id: instance_id.to_string(),
                stream: stream.to_string(),
                line: strip_ansi_escapes(line),
            };
            if let Err(e) = handle.emit("maa-agent-output", event) {
                log::error!("[agent_output] Failed to emit event: {}", e);
            }
        }
    }));

    if let Err(e) = result {
        log::error!("[agent_output] Panic caught in emit_agent_output: {:?}", e);
    }
}

/// MaaFramework 回调处理函数
/// 由 MaaFramework 在工作线程中调用，将消息转发到前端
/// 注意：此函数必须尽快返回，避免阻塞 MaaFramework 的工作线程
extern "C" fn maa_event_callback(
    _handle: *mut c_void,
    message: *const c_char,
    details_json: *const c_char,
    _trans_arg: *mut c_void,
) {
    // 使用 catch_unwind 捕获潜在的 panic，避免回调中的 panic 导致整个程序崩溃
    let result = std::panic::catch_unwind(|| {
        // 安全地读取 C 字符串
        let message_str = if message.is_null() {
            log::warn!("[callback] Received null message pointer");
            String::new()
        } else {
            unsafe { from_cstr(message) }
        };

        let details_str = if details_json.is_null() {
            log::warn!("[callback] Received null details_json pointer");
            String::new()
        } else {
            unsafe { from_cstr(details_json) }
        };

        log::debug!(
            "[callback] Received: message={}, details={}",
            message_str,
            details_str
        );

        // 快速克隆 AppHandle 后立即释放锁，避免阻塞 MaaFramework 工作线程
        let handle = match APP_HANDLE.lock() {
            Ok(guard) => guard.clone(),
            Err(e) => {
                log::error!("[callback] Failed to lock APP_HANDLE: {}", e);
                return;
            }
        };

        // 使用克隆的 handle 发送事件（锁已释放）
        if let Some(handle) = handle {
            let event = MaaCallbackEvent {
                message: message_str,
                details: details_str,
            };
            if let Err(e) = handle.emit("maa-callback", event) {
                log::error!("[callback] Failed to emit event: {}", e);
            }
        } else {
            log::warn!("[callback] APP_HANDLE is None, cannot emit event");
        }
    });

    if let Err(e) = result {
        log::error!("[callback] Panic caught in maa_event_callback: {:?}", e);
    }
}

/// 获取回调函数指针
pub fn get_event_callback() -> MaaEventCallback {
    Some(maa_event_callback)
}
