//! 类型定义
//!
//! 包含 Tauri 命令使用的数据结构和枚举

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use maa_framework::agent_client::AgentClient;
use maa_framework::controller::Controller;
use maa_framework::resource::Resource;
use maa_framework::tasker::Tasker;

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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type")]
pub enum ControllerConfig {
    Adb {
        adb_path: String,
        address: String,
        screencap_methods: String, // u64 作为字符串传递，避免 JS 精度丢失
        input_methods: String,     // u64 作为字符串传递
        config: String,
        #[serde(default)]
        display_short_side: Option<i32>,
    },
    Win32 {
        handle: u64,
        screencap_method: u64,
        mouse_method: u64,
        keyboard_method: u64,
        #[serde(default)]
        display_short_side: Option<i32>,
    },
    WlRoots {
        wlr_socket_path: String,
        #[serde(default)]
        use_win32_vk_code: bool,
        #[serde(default)]
        display_short_side: Option<i32>,
    },
    Gamepad {
        handle: u64,
        #[serde(default)]
        gamepad_type: Option<String>,
        #[serde(default)]
        screencap_method: Option<u64>,
        #[serde(default)]
        display_short_side: Option<i32>,
    },
    PlayCover {
        address: String,
        #[serde(default)]
        uuid: Option<String>,
        #[serde(default)]
        display_short_side: Option<i32>,
    },
    /// 空 controller：截图返回纯黑图、输入 no-op。
    /// 用于在游戏未连接/已关闭时执行不依赖游戏画面的 MXU 特殊任务。
    Dummy {
        #[serde(default)]
        display_short_side: Option<i32>,
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

/// 任务运行状态（后端管理，作为单一真相来源）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskRunState {
    /// selectedTaskId → status ("idle"/"pending"/"running"/"succeeded"/"failed")
    pub statuses: HashMap<String, String>,
    /// maaTaskId → selectedTaskId
    pub mappings: HashMap<i64, String>,
    /// 任务队列（maaTaskId 列表，执行顺序）
    pub pending_task_ids: Vec<i64>,
    /// 当前执行到的任务索引
    pub current_task_index: usize,
    /// 实例级整体状态（None/"Running"/"Succeeded"/"Failed"）
    pub overall_status: Option<String>,
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
    /// 任务运行状态（后端管理，包含逐任务状态、映射、队列）
    pub task_run_state: TaskRunState,
}

/// 所有实例状态的快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllInstanceStates {
    pub instances: HashMap<String, InstanceState>,
    pub cached_adb_devices: Vec<AdbDevice>,
    pub cached_win32_windows: Vec<Win32Window>,
    pub cached_wlroots_sockets: Vec<String>,
}

pub(crate) const AGENT_DISCONNECT_TIMEOUT_MS: i64 = 1_000;

pub(crate) fn terminate_agent_child(mut child: Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    if child.kill().is_ok() {
        let _ = child.wait();
    }
}

pub(crate) struct PendingAgentState {
    pub(crate) instance_id: String,
    pub(crate) child: Mutex<Option<Child>>,
    pub(crate) cancelled: AtomicBool,
}

impl PendingAgentState {
    pub(crate) fn new(instance_id: String) -> Self {
        Self {
            instance_id,
            child: Mutex::new(None),
            cancelled: AtomicBool::new(false),
        }
    }
}

/// 实例运行时状态（持有 MaaFramework 对象句柄）
#[derive(Default)]
pub struct InstanceRuntime {
    pub resource: Option<Resource>,
    pub controller: Option<Controller>,
    /// 当前控制器的配置（用于 ControllerPool 引用管理）
    pub controller_config: Option<ControllerConfig>,
    pub tasker: Option<Tasker>,
    pub agent_clients: Vec<AgentClient>,
    pub agent_children: Vec<Child>,
    /// 当前运行的任务 ID 列表（用于刷新后恢复状态）
    pub task_ids: Vec<i64>,
    /// 是否正在停止任务（用于防重复 stop）
    pub stop_in_progress: bool,
    /// stop 请求的起始时间（用于节流/重试）
    pub stop_started_at: Option<Instant>,
    /// 任务运行状态（后端管理，单一真相来源）
    pub task_run_state: TaskRunState,
}

impl Drop for InstanceRuntime {
    fn drop(&mut self) {
        // 断开并销毁所有 agent
        for client in &mut self.agent_clients {
            if client.set_timeout(AGENT_DISCONNECT_TIMEOUT_MS).is_ok() {
                let _ = client.disconnect();
            }
        }
        self.agent_clients.clear();

        // 终止并回收所有 agent 子进程
        for child in self.agent_children.drain(..) {
            terminate_agent_child(child);
        }

        if let Some(tasker) = self.tasker.take() {
            drop(tasker);
        }
        if let Some(controller) = self.controller.take() {
            drop(controller);
        }
        if let Some(resource) = self.resource.take() {
            drop(resource);
        }
    }
}

/// 前端运行日志条目（用于跨页面刷新持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntryDto {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub log_type: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
}

/// 每个实例的日志缓冲区默认上限
const DEFAULT_MAX_LOGS: usize = 2000;

/// 运行日志缓冲区（按实例隔离，支持容量限制）
pub struct LogBuffer {
    logs: HashMap<String, VecDeque<LogEntryDto>>,
    max_per_instance: usize,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self {
            logs: HashMap::new(),
            max_per_instance: DEFAULT_MAX_LOGS,
        }
    }
}

impl LogBuffer {
    pub fn new(max_per_instance: usize) -> Self {
        Self {
            logs: HashMap::new(),
            max_per_instance: max_per_instance.max(100),
        }
    }

    pub fn push(&mut self, instance_id: &str, entry: LogEntryDto) {
        let entries = self.logs.entry(instance_id.to_string()).or_default();
        entries.push_back(entry);
        while entries.len() > self.max_per_instance {
            entries.pop_front();
        }
    }

    pub fn get_all(&self) -> &HashMap<String, VecDeque<LogEntryDto>> {
        &self.logs
    }

    pub fn clear_instance(&mut self, instance_id: &str) {
        if let Some(entries) = self.logs.get_mut(instance_id) {
            entries.clear();
        }
    }

    pub fn set_max(&mut self, max: usize) {
        self.max_per_instance = max.max(100);
    }
}

/// MaaFramework 运行时状态
#[derive(Default)]
pub struct MaaState {
    pub lib_dir: Mutex<Option<PathBuf>>,
    pub resource_dir: Mutex<Option<PathBuf>>,
    pub instances: Mutex<HashMap<String, InstanceRuntime>>,
    /// 串行化 Agent 句柄的转移与清理，确保退出流程能等待正在进行的 stop。
    pub agent_lifecycle_lock: Mutex<()>,
    /// 应用已进入退出清理阶段，不再接受新的 Agent 句柄写回。
    pub agent_shutdown_requested: AtomicBool,
    /// 已生成子进程、但尚未完成连接并写回 InstanceRuntime 的 Agent。
    pub(crate) pending_agent_children: Mutex<HashMap<String, Arc<PendingAgentState>>>,
    /// 前置程序停止请求（用于中断等待退出）
    pub pre_action_stop_requests: Mutex<HashSet<String>>,
    /// Controller 连接池：相同配置的 Controller 复用同一个 MaaControllerHandle
    pub controller_pool: Mutex<HashMap<ControllerConfig, Controller>>,
    /// 缓存的 ADB 设备列表（全局共享，避免重复搜索）
    pub cached_adb_devices: Mutex<Vec<AdbDevice>>,
    /// 缓存的 Win32 窗口列表（全局共享）
    pub cached_win32_windows: Mutex<Vec<Win32Window>>,
    /// 缓存的 WlRoots socket 列表（全局共享）
    pub cached_wlroots_sockets: Mutex<Vec<String>>,
    /// 运行日志缓冲区（前端推送，页面刷新后恢复）
    pub log_buffer: Mutex<LogBuffer>,
    /// 后端统一截图服务（确保每实例只有一份 post_screencap 在运行）
    pub screenshot_service: crate::screenshot_service::ScreenshotService,
}

impl MaaState {
    /// 销毁所有 AgentClient，然后终止对应的子进程。
    ///
    /// 句柄先从共享状态中取出，避免在可能阻塞的原生调用期间持有 instances 锁。
    /// 该操作可重复调用；首轮清理后，后续调用不会再取得任何句柄。
    pub fn cleanup_all_agents(&self) {
        self.agent_shutdown_requested.store(true, Ordering::SeqCst);

        let _lifecycle_guard = match self.agent_lifecycle_lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::warn!("Agent lifecycle lock was poisoned; continuing agent cleanup");
                poisoned.into_inner()
            }
        };

        let agents = {
            let mut instances = match self.instances.lock() {
                Ok(instances) => instances,
                Err(poisoned) => {
                    log::warn!("MaaState instances lock was poisoned; continuing agent cleanup");
                    poisoned.into_inner()
                }
            };

            instances
                .iter_mut()
                .filter_map(|(id, instance)| {
                    let clients = std::mem::take(&mut instance.agent_clients);
                    let children = std::mem::take(&mut instance.agent_children);

                    if clients.is_empty() && children.is_empty() {
                        None
                    } else {
                        Some((id.clone(), clients, children))
                    }
                })
                .collect::<Vec<_>>()
        };

        for (id, clients, children) in agents {
            log::info!(
                "Cleaning up {} agent client(s) and {} child process(es) for instance: {}",
                clients.len(),
                children.len(),
                id
            );

            // 退出流程不能受 Agent 配置中的无限 RPC timeout 阻塞。直接 Drop 会销毁
            // MaaFramework Transceiver 并删除 IPC socket，随后再强制终止服务端进程。
            drop(clients);

            for mut child in children {
                match child.try_wait() {
                    Ok(Some(_)) => continue,
                    Ok(None) => {}
                    Err(e) => {
                        log::warn!(
                            "Failed to query agent child process for instance {}: {:?}",
                            id,
                            e
                        );
                    }
                }

                match child.kill() {
                    Ok(()) => {
                        // kill 成功后回收子进程，避免 *nix 上产生僵尸进程。
                        let _ = child.wait();
                    }
                    Err(e) => {
                        // kill 失败时不再无界 wait，避免把应用退出永久卡住。
                        log::warn!(
                            "Failed to kill agent child process for instance {}: {:?}",
                            id,
                            e
                        );
                    }
                }
            }
        }

        self.cleanup_pending_agents(None);
    }

    /// 清理全部 pending Agent，或仅清理指定实例的 pending Agent。
    /// 调用方必须持有 agent_lifecycle_lock，防止端点创建与筛选交错。
    pub(crate) fn cleanup_pending_agents(&self, instance_id: Option<&str>) {
        let pending_agents = {
            let mut pending = match self.pending_agent_children.lock() {
                Ok(pending) => pending,
                Err(poisoned) => {
                    log::warn!(
                        "Pending agent children lock was poisoned; continuing agent cleanup"
                    );
                    poisoned.into_inner()
                }
            };

            if let Some(instance_id) = instance_id {
                let identifiers = pending
                    .iter()
                    .filter(|(_, state)| state.instance_id == instance_id)
                    .map(|(identifier, _)| identifier.clone())
                    .collect::<Vec<_>>();
                identifiers
                    .into_iter()
                    .filter_map(|identifier| {
                        pending
                            .remove(&identifier)
                            .map(|state| (identifier, state))
                    })
                    .collect::<Vec<_>>()
            } else {
                pending.drain().collect::<Vec<_>>()
            }
        };

        for (identifier, pending_agent) in pending_agents {
            pending_agent.cancelled.store(true, Ordering::SeqCst);
            let child = match pending_agent.child.lock() {
                Ok(mut slot) => slot.take(),
                Err(poisoned) => {
                    log::warn!(
                        "Pending agent child lock was poisoned for identifier: {}",
                        identifier
                    );
                    poisoned.into_inner().take()
                }
            };

            if let Some(child) = child {
                log::info!(
                    "Terminating pending agent child process for identifier: {}",
                    identifier
                );
                terminate_agent_child(child);
            }

            remove_pending_agent_socket(&identifier);
        }
    }
}

fn remove_pending_agent_socket(identifier: &str) {
    // TCP identifier 是纯数字端口，不存在 socket 文件。
    if identifier.parse::<u16>().is_ok() {
        return;
    }
    if !identifier
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        log::warn!("Skipping invalid pending agent identifier: {}", identifier);
        return;
    }

    #[cfg(windows)]
    let socket_dir = PathBuf::from("C:/Temp");
    #[cfg(not(windows))]
    let socket_dir = std::env::temp_dir();

    let socket_path = socket_dir.join(format!("maafw-agent-{}.sock", identifier));
    match std::fs::remove_file(&socket_path) {
        Ok(()) => log::info!("Removed pending agent socket: {:?}", socket_path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::warn!(
            "Failed to remove pending agent socket {:?}: {}",
            socket_path,
            e
        ),
    }
}

/// Maa回调事件
#[derive(Clone, Serialize, Deserialize)]
pub struct MaaCallbackEvent {
    pub message: String,
    pub details: String,
}

/// 实例状态变更事件（用于 Tauri WebView 端监听）
#[derive(Clone, Serialize, Deserialize)]
pub struct StateChangedEvent {
    pub instance_id: String,
    pub kind: String,
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
    /// 对应的前端选中任务 ID（用于后端跟踪 per-task 状态）
    #[serde(default)]
    pub selected_task_id: Option<String>,
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

/// 下载结果
#[derive(Clone, Serialize)]
pub struct DownloadResult {
    /// 下载会话 ID
    pub session_id: u64,
    /// 实际保存的文件路径（可能与请求的路径不同，如果从 URL 或 header 检测到正确的文件名）
    pub actual_save_path: String,
    /// 从 URL 或 Content-Disposition 提取的文件名（如果有）
    pub detected_filename: Option<String>,
}

/// 系统信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub tauri_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: Option<String>,
    pub prerelease: bool,
    pub assets: Vec<GitHubAsset>,
}

/// WebView2 目录信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebView2DirInfo {
    pub path: String,
    pub system: bool,
}
