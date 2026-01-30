//! 类型定义
//!
//! 包含 Tauri 命令使用的数据结构和枚举

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::maa_ffi::{
    MaaAgentClient, MaaController, MaaResource, MaaTasker, MAA_LIBRARY,
};

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

/// 下载进度事件数据
#[derive(Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub session_id: u64,
    pub downloaded_size: u64,
    pub total_size: u64,
    pub speed: u64,
    pub progress: f64,
}

/// 系统信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub tauri_version: String,
}
