//! 匿名遥测（数据埋点）模块
//!
//! 基于 Sentry Rust SDK，向资源作者在 `interface.json` 的 `telemetry.sentry.dsn`
//! 指定的 Sentry 项目上报崩溃与任务运行统计。
//!
//! 设计要点：
//! - DSN 仅来自 interface.json 的 `telemetry.sentry.dsn`；空 DSN 或未开启时不初始化、不上报。
//! - 初始化发生在 Tauri `setup()`（早于前端），使 WebView 起来之前的崩溃也能覆盖。
//! - 用户开关（帮助改进软件）与构建期闸门（调试 / 开发版本）都在本模块判定。
//! - 隐私：`send_default_pii = false`，仅上报哈希机器 ID、硬件摘要、版本、任务名、脱敏后的选项与结果。
//! - 网络：SDK 后台异步发送、队列有界，不阻塞主流程；`shutdown_timeout` 设小值避免退出卡顿。
//! - 事件模型：一次进程运行 = 一个 Session（Release Health），
//!   一次整批运行 = 一个 Transaction，每个 SavedTask = 一个 child Span。

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::types::ControllerInfo;
use super::AppConfigState;

/// Sentry 客户端守卫；持有期间遥测生效，置为 None 即关闭并 flush。
static TELEMETRY_GUARD: Mutex<Option<sentry::ClientInitGuard>> = Mutex::new(None);
/// 最近一次初始化配置，供运行时重新开启使用。
static TELEMETRY_CONFIG: Mutex<Option<TelemetryInitConfig>> = Mutex::new(None);
/// 匿名机器 ID（计算一次后复用，同时作为 Sentry user.id）。
static MACHINE_ID: OnceLock<String> = OnceLock::new();
/// 进行中的运行遥测状态，按 instance_id 索引。
static RUNS: Mutex<BTreeMap<String, RunState>> = Mutex::new(BTreeMap::new());

/// 前端传入的初始化配置（camelCase 对应 invoke 参数）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryInitConfig {
    /// Sentry DSN；空字符串表示不启用。
    pub dsn: String,
    /// 是否启用（用户 opt-in 且非调试版）。
    pub enabled: bool,
    /// release：MXU@<mxuVersion>+<appName>@<appVersion>。
    pub release: String,
    /// 环境标签，如 stable/beta/production。
    pub environment: String,
    /// 是否启用性能 / 事务上报。
    pub tracing: bool,
    /// 事务采样率 0~1。
    pub traces_sample_rate: f32,
    /// 资源项目名（interface.name）。
    pub app_name: String,
    /// 资源项目版本（interface.version）。
    pub app_version: String,
    /// MXU 本体版本。
    pub mxu_version: String,
}

/// 单次整批运行的遥测状态。
struct RunState {
    /// 整批运行对应的 Transaction。
    transaction: sentry::TransactionOrSpan,
    /// 每个 SavedTask（maa_task_id）对应的 child Span。
    children: HashMap<i64, sentry::TransactionOrSpan>,
    /// 已提交任务的元数据（maa_task_id → 任务名与选项摘要）。
    metas: HashMap<i64, TaskMeta>,
    /// 各任务最近一次失败的节点（maa_task_id → 节点名与失败阶段）。
    last_failures: HashMap<i64, (String, &'static str)>,
    /// Transaction 级 tag，在 finish 时通过临时 scope 应用（SDK 未提供直接设置 tag 的接口）。
    tags: BTreeMap<String, String>,
    /// 是否已有任务失败。
    has_failed: bool,
}

/// 单个 SavedTask 的遥测元数据，由前端在提交任务时给出。
#[derive(Debug, Clone, Default)]
pub struct TaskMeta {
    /// interface 任务名，作为 Span 的 description。
    pub name: String,
    /// 已脱敏的选项摘要。
    pub options: BTreeMap<String, String>,
}

/// 主机硬件摘要。
struct HardwareInfo {
    cpu: String,
    cpu_cores: u32,
    memory_total_mb: u64,
    gpu: String,
    os: String,
}

/// 遥测是否处于激活状态（已初始化且客户端存在）。
pub fn is_active() -> bool {
    TELEMETRY_GUARD.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// 启动期初始化，在 Tauri `setup()` 中调用（interface / config 加载之后）。
///
/// 相比等前端 `telemetry_init`，这里能覆盖 WebView2 缺失、interface 解析失败等
/// 启动即崩的场景；同时 Session 会挂在主线程 hub 上，退出时才能正确收尾。
pub fn init_at_startup(app_config: &AppConfigState) {
    // 无论是否启用都记录：用户反馈问题时可凭这行在 Sentry 后台按 user.id 定位
    log::info!(
        "[telemetry] 匿名机器 ID (Sentry user.id) = {}",
        machine_id()
    );

    let Some(config) = build_startup_config(app_config) else {
        log::info!("[telemetry] interface 未声明 telemetry.sentry.dsn，跳过初始化");
        return;
    };

    if is_blocked_by_build(&config.app_version) {
        log::info!("[telemetry] 调试 / 开发版本，跳过初始化（MXU_TELEMETRY_FORCE=1 可放行）");
        return;
    }

    cache_config(config.clone());

    if !config.enabled || config.dsn.trim().is_empty() {
        log::info!("[telemetry] 用户未开启，跳过初始化");
        return;
    }

    do_init(&config);
}

/// 从已加载的 interface + config 组装初始化参数；未声明 DSN 时返回 None。
fn build_startup_config(app_config: &AppConfigState) -> Option<TelemetryInitConfig> {
    let project_interface = app_config
        .project_interface
        .lock()
        .ok()
        .and_then(|pi| pi.clone())?;

    let sentry_cfg = project_interface.get("telemetry")?.get("sentry")?;
    let dsn = sentry_cfg.get("dsn")?.as_str()?.trim().to_string();
    if dsn.is_empty() {
        return None;
    }

    let app_name = project_interface
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let app_version = project_interface
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();

    // 用户开关缺省视为开启，与前端 `helpImproveSoftware ?? true` 一致
    let (enabled, channel) = {
        let config = app_config.config.lock().ok()?;
        let settings = config.get("settings");
        let enabled = settings
            .and_then(|s| s.get("helpImproveSoftware"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let channel = settings
            .and_then(|s| s.get("mirrorChyan"))
            .and_then(|m| m.get("channel"))
            .and_then(|v| v.as_str())
            .unwrap_or("production")
            .to_string();
        (enabled, channel)
    };

    let mxu_version = env!("CARGO_PKG_VERSION").to_string();

    Some(TelemetryInitConfig {
        dsn,
        enabled,
        release: format!("MXU@{mxu_version}+{app_name}@{app_version}"),
        environment: sentry_cfg
            .get("environment")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or(channel),
        tracing: sentry_cfg
            .get("tracing")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        traces_sample_rate: sentry_cfg
            .get("traces_sample_rate")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0) as f32,
        app_name,
        app_version,
        mxu_version,
    })
}

/// 构建期闸门：调试 / 开发版本一律不上报，`MXU_TELEMETRY_FORCE=1` 用于本地联调放行。
fn is_blocked_by_build(app_version: &str) -> bool {
    if std::env::var("MXU_TELEMETRY_FORCE").is_ok_and(|v| v == "1") {
        return false;
    }
    cfg!(debug_assertions) || is_debug_version(app_version)
}

/// 资源项目版本是否为非正式版本，与前端 `isDebugVersion` 保持一致。
fn is_debug_version(version: &str) -> bool {
    if version.is_empty() {
        return false;
    }
    if version == "DEBUG_VERSION" {
        return true;
    }

    let normalized = version.trim_start_matches(['v', 'V']);
    let baseline = semver::Version::new(1, 0, 0);

    if let Ok(parsed) = semver::Version::parse(normalized) {
        if parsed < baseline {
            return true;
        }
        if parsed.pre.is_empty() {
            return false;
        }
        // 仅 beta / rc 属于对外预发布，其余（ci.123、alpha.1 等）按调试版处理
        return !parsed
            .pre
            .as_str()
            .split('.')
            .any(|tag| tag == "beta" || tag == "rc");
    }

    // 非标准版本号：退化为提取前导数字比较，与前端 `semver.coerce` 的兜底对应
    coerce_version(normalized).is_some_and(|version| version < baseline)
}

/// 从非标准版本号中提取最多三段前导数字，解析不出数字时返回 None。
fn coerce_version(version: &str) -> Option<semver::Version> {
    let start = version.find(|c: char| c.is_ascii_digit())?;
    let mut rest = &version[start..];
    let mut parts = [0u64; 3];

    for part in parts.iter_mut() {
        let digits = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        *part = rest[..digits].parse().ok()?;
        rest = &rest[digits..];
        if !rest.starts_with('.') {
            break;
        }
        rest = &rest[1..];
        if !rest.starts_with(|c: char| c.is_ascii_digit()) {
            break;
        }
    }

    Some(semver::Version::new(parts[0], parts[1], parts[2]))
}

/// 缓存初始化参数，供运行时开关复用。
fn cache_config(config: TelemetryInitConfig) {
    if let Ok(mut slot) = TELEMETRY_CONFIG.lock() {
        *slot = Some(config);
    }
}

/// 前端校正遥测配置；启动期已初始化时仅更新缓存与开关，不重复建客户端。
#[tauri::command]
pub fn telemetry_init(config: TelemetryInitConfig) {
    // 二次 sentry::init 会建出第二个 client 与第二条 Session，因此这里只做校正
    if is_active() {
        let enabled = config.enabled;
        cache_config(config);
        if !enabled {
            telemetry_set_enabled(false);
        }
        return;
    }

    // 兜底：启动期初始化未成功（如 interface.json 读不到）时允许迟到初始化，
    // 闸门与启动期共用，避免调试版从这条路绕过
    if is_blocked_by_build(&config.app_version) {
        log::info!("[telemetry] 调试 / 开发版本，跳过初始化（MXU_TELEMETRY_FORCE=1 可放行）");
        return;
    }

    cache_config(config.clone());

    if !config.enabled || config.dsn.trim().is_empty() {
        log::info!("[telemetry] 未启用或缺少 DSN，跳过初始化");
        return;
    }

    do_init(&config);
}

/// 运行时切换遥测开关。
#[tauri::command]
pub fn telemetry_set_enabled(enabled: bool) {
    if enabled {
        // 已激活则无需重复初始化
        if is_active() {
            return;
        }
        let cfg = TELEMETRY_CONFIG.lock().ok().and_then(|c| c.clone());
        if let Some(mut cfg) = cfg {
            cfg.enabled = true;
            if !cfg.dsn.trim().is_empty() {
                do_init(&cfg);
            }
        }
        return;
    }

    // 先正常结束 Session，否则它会一直挂着并最终被判为 abnormal，拉低 crash-free 率
    if is_active() {
        sentry::end_session_with_status(sentry::protocol::SessionStatus::Exited);
    }
    // 关闭：丢弃守卫（close 会 flush 并使后续 capture 变为 no-op）
    if let Ok(mut slot) = TELEMETRY_GUARD.lock() {
        *slot = None;
    }
    // 清理进行中的运行状态，避免悬挂事务
    if let Ok(mut runs) = RUNS.lock() {
        runs.clear();
    }
}

/// 应用退出收尾：结束悬挂的 Transaction 与 Session，并 flush 队列。
///
/// 由 `RunEvent::Exit` 调用。最小化到托盘不算退出，不在那里收尾。
pub fn on_app_exit() {
    if !is_active() {
        return;
    }

    // 退出时仍在跑的整批运行按取消收尾，避免整条 Transaction 丢失
    let pending: Vec<String> = RUNS
        .lock()
        .map(|runs| runs.keys().cloned().collect())
        .unwrap_or_default();
    for instance_id in pending {
        finish_run(&instance_id, Some(sentry::protocol::SpanStatus::Cancelled));
    }

    sentry::end_session_with_status(sentry::protocol::SessionStatus::Exited);

    // 丢弃守卫触发 flush（上限为 shutdown_timeout）
    if let Ok(mut slot) = TELEMETRY_GUARD.lock() {
        *slot = None;
    }
    log::info!("[telemetry] 已结束 Session 并 flush");
}

/// 实际执行 Sentry 初始化并配置 scope。
fn do_init(config: &TelemetryInitConfig) {
    let dsn: sentry::types::Dsn = match config.dsn.parse() {
        Ok(dsn) => dsn,
        Err(err) => {
            log::warn!("[telemetry] DSN 解析失败: {err}");
            return;
        }
    };

    let traces_sample_rate = if config.tracing {
        config.traces_sample_rate.clamp(0.0, 1.0)
    } else {
        0.0
    };

    let guard = sentry::init(sentry::ClientOptions {
        dsn: Some(dsn),
        release: Some(config.release.clone().into()),
        environment: Some(config.environment.clone().into()),
        traces_sample_rate,
        // 隐私：不采集用户 IP、请求头等 PII
        send_default_pii: false,
        // Session（Release Health）：一次进程运行一条，init 时自动开始
        auto_session_tracking: true,
        session_mode: sentry::SessionMode::Application,
        // 网络差时退出不长时间阻塞（退出路径还要清理 agent 子进程）
        shutdown_timeout: Duration::from_secs(1),
        ..Default::default()
    });

    if let Ok(mut slot) = TELEMETRY_GUARD.lock() {
        *slot = Some(guard);
    }

    configure_scope(config);
    log::info!("[telemetry] 已初始化 (release={})", config.release);
}

/// 配置全局 scope：匿名用户、版本 tag、硬件 context。
fn configure_scope(config: &TelemetryInitConfig) {
    let hw = collect_hardware();

    sentry::configure_scope(|scope| {
        scope.set_user(Some(sentry::User {
            id: Some(machine_id().to_string()),
            ..Default::default()
        }));

        scope.set_tag("app.name", config.app_name.clone());
        scope.set_tag("app.version", config.app_version.clone());
        scope.set_tag("mxu.version", config.mxu_version.clone());

        let mut map: BTreeMap<String, sentry::protocol::Value> = BTreeMap::new();
        map.insert("cpu".into(), hw.cpu.clone().into());
        map.insert("cpu_cores".into(), hw.cpu_cores.into());
        map.insert("memory_total_mb".into(), hw.memory_total_mb.into());
        map.insert("gpu".into(), hw.gpu.clone().into());
        map.insert("os".into(), hw.os.clone().into());
        scope.set_context("hardware", sentry::protocol::Context::Other(map));
    });
}

/// 匿名机器 ID，首次调用时计算并缓存。
fn machine_id() -> &'static str {
    MACHINE_ID.get_or_init(hashed_machine_id)
}

/// 计算稳定的匿名机器 ID：machine-uid 原值加盐后 sha256，物理机固定、重启不变。
fn hashed_machine_id() -> String {
    let raw = machine_uid::get().unwrap_or_else(|_| "unknown-machine".to_string());
    let mut hasher = Sha256::new();
    hasher.update(b"mxu-telemetry-v1:");
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// 采集主机硬件摘要（CPU / 内存 / GPU / OS）。
fn collect_hardware() -> HardwareInfo {
    let sys = sysinfo::System::new_all();

    let cpu = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();
    let cpu_cores = sys.cpus().len() as u32;
    // sysinfo 返回字节
    let memory_total_mb = sys.total_memory() / 1024 / 1024;
    let os = format!(
        "{} {}",
        sysinfo::System::name().unwrap_or_default(),
        sysinfo::System::os_version().unwrap_or_default()
    )
    .trim()
    .to_string();
    let gpu = collect_gpu();

    HardwareInfo {
        cpu,
        cpu_cores,
        memory_total_mb,
        gpu,
        os,
    }
}

/// Windows：从注册表读取主显卡名称（DriverDesc）；其他平台暂不采集。
#[cfg(windows)]
fn collect_gpu() -> String {
    use winsafe::co::{KEY, REG_OPTION};
    use winsafe::{RegistryValue, HKEY};

    let path =
        r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0000";
    let key =
        match HKEY::LOCAL_MACHINE.RegOpenKeyEx(Some(path), REG_OPTION::NoValue, KEY::QUERY_VALUE) {
            Ok(key) => key,
            Err(_) => return String::new(),
        };

    match key.RegQueryValueEx(Some("DriverDesc")) {
        Ok(RegistryValue::Sz(name)) | Ok(RegistryValue::ExpandSz(name)) => name.trim().to_string(),
        _ => String::new(),
    }
}

/// 非 Windows 平台：暂不采集 GPU。
#[cfg(not(windows))]
fn collect_gpu() -> String {
    String::new()
}

// ============ 任务事件埋点 ============

/// 整批运行开始：创建 Transaction，并记录本次使用的 controller。
pub fn on_run_start(instance_id: &str, task_names: &[String], controller: Option<&ControllerInfo>) {
    if !is_active() {
        return;
    }

    let ctx = sentry::TransactionContext::new("mxu.task_run", "mxu.run");
    let transaction: sentry::TransactionOrSpan = sentry::start_transaction(ctx).into();
    transaction.set_data("task_count", (task_names.len() as u64).into());
    if !task_names.is_empty() {
        transaction.set_data("tasks", task_names.join(",").into());
    }

    // controller 既写 data（事件详情可见）又留作 tag（Sentry 中可搜索 / 分组）
    let mut tags = BTreeMap::new();
    if let Some(controller) = controller {
        for (key, value) in [
            ("controller.name", controller.name.as_deref()),
            ("controller.type", controller.type_name.as_deref()),
        ] {
            let Some(value) = value.filter(|s| !s.is_empty()) else {
                continue;
            };
            transaction.set_data(key, value.into());
            tags.insert(key.to_string(), value.to_string());
        }
    }

    if let Ok(mut runs) = RUNS.lock() {
        runs.insert(
            instance_id.to_string(),
            RunState {
                transaction,
                children: HashMap::new(),
                metas: HashMap::new(),
                last_failures: HashMap::new(),
                tags,
                has_failed: false,
            },
        );
    }
}

/// 提交任务期间的元数据登记句柄，持有遥测状态锁。
pub struct PostingGuard {
    runs: std::sync::MutexGuard<'static, BTreeMap<String, RunState>>,
    instance_id: String,
}

impl PostingGuard {
    /// 登记一个刚提交的任务的任务名与选项摘要。
    pub fn register(&mut self, maa_task_id: i64, meta: TaskMeta) {
        if let Some(run) = self.runs.get_mut(&self.instance_id) {
            run.metas.insert(maa_task_id, meta);
        }
    }
}

/// 开始提交任务：让 post_task 与元数据登记处于同一临界区。
///
/// MaaFW 会在 `post_task` 返回后立刻在通知线程发出 `Tasker.Task.Starting`，
/// 若元数据尚未登记，该任务的 Span 就会丢失任务名。持锁提交可让回调线程短暂等待
/// （仅数毫秒，不阻塞任务执行），从而保证 Span 一定能取到元数据。
pub fn begin_posting(instance_id: &str) -> Option<PostingGuard> {
    if !is_active() {
        return None;
    }

    let runs = RUNS.lock().ok()?;
    if !runs.contains_key(instance_id) {
        return None;
    }
    Some(PostingGuard {
        runs,
        instance_id: instance_id.to_string(),
    })
}

/// 单个 SavedTask 开始：创建 child Span，description 用 interface 任务名。
pub fn on_task_start(instance_id: &str, maa_task_id: i64) {
    if !is_active() {
        return;
    }

    if let Ok(mut runs) = RUNS.lock() {
        if let Some(run) = runs.get_mut(instance_id) {
            let meta = run.metas.get(&maa_task_id).cloned().unwrap_or_default();
            let span: sentry::TransactionOrSpan =
                run.transaction.start_child("mxu.task", &meta.name).into();
            span.set_data("task", meta.name.clone().into());
            for (key, value) in &meta.options {
                span.set_data(&format!("option.{key}"), value.clone().into());
            }
            run.children.insert(maa_task_id, span);
        }
    }
}

/// 节点级回调：记录各任务最近一次失败的节点，供任务失败时上报。
///
/// 由 tasker 的 context sink 调用，属于高频回调，因此先比较消息名再解析 JSON。
pub fn on_node_event(instance_id: &str, message: &str, details: &str) {
    let stage = match message {
        // 动作执行失败，name 即失败节点
        "Node.Action.Failed" => "action",
        // next 列表全部未命中，name 为卡住的当前节点
        "Node.NextList.Failed" => "recognition",
        _ => return,
    };

    if !is_active() {
        return;
    }

    let Ok(detail) = serde_json::from_str::<serde_json::Value>(details) else {
        return;
    };
    let Some(task_id) = detail.get("task_id").and_then(|v| v.as_i64()) else {
        return;
    };
    let Some(node) = detail.get("name").and_then(|v| v.as_str()) else {
        return;
    };

    if let Ok(mut runs) = RUNS.lock() {
        if let Some(run) = runs.get_mut(instance_id) {
            run.last_failures.insert(task_id, (node.to_string(), stage));
        }
    }
}

/// 单个 SavedTask 结束：为 child Span 打结果并 finish。
pub fn on_task_finished(instance_id: &str, maa_task_id: i64, success: bool) {
    if !is_active() {
        return;
    }

    if let Ok(mut runs) = RUNS.lock() {
        if let Some(run) = runs.get_mut(instance_id) {
            if !success {
                run.has_failed = true;
            }
            let failure = run.last_failures.remove(&maa_task_id);
            run.metas.remove(&maa_task_id);
            if let Some(span) = run.children.remove(&maa_task_id) {
                span.set_data("result", if success { "success" } else { "failure" }.into());
                span.set_status(if success {
                    sentry::protocol::SpanStatus::Ok
                } else {
                    sentry::protocol::SpanStatus::InternalError
                });

                if !success {
                    if let Some((node, stage)) = failure {
                        span.set_data("failed_node", node.clone().into());
                        span.set_data("failed_stage", stage.into());
                        // Transaction 上只记首个失败节点，便于按节点搜索整次运行
                        run.tags.entry("failed_node".to_string()).or_insert(node);
                    }
                }

                span.finish();
            }
        }
    }
}

/// 整批运行结束：finish Transaction。
pub fn on_run_finished(instance_id: &str) {
    finish_run(instance_id, None);
}

/// 用户取消 / 停止：以 cancelled 结束 Transaction。
pub fn on_run_cancelled(instance_id: &str) {
    finish_run(instance_id, Some(sentry::protocol::SpanStatus::Cancelled));
}

/// 结束一次运行：未 finish 的 child 一并收尾，再 finish Transaction。
fn finish_run(instance_id: &str, forced_status: Option<sentry::protocol::SpanStatus>) {
    if let Ok(mut runs) = RUNS.lock() {
        if let Some(mut run) = runs.remove(instance_id) {
            // 收尾未完成的 child（如取消时仍在运行的任务）
            let pending: Vec<i64> = run.children.keys().copied().collect();
            for id in pending {
                if let Some(span) = run.children.remove(&id) {
                    let status = forced_status.unwrap_or(sentry::protocol::SpanStatus::Cancelled);
                    span.set_status(status);
                    span.set_data(
                        "result",
                        match status {
                            sentry::protocol::SpanStatus::Ok => "success",
                            sentry::protocol::SpanStatus::Cancelled => "cancelled",
                            _ => "failure",
                        }
                        .into(),
                    );
                    span.finish();
                }
            }

            let status = forced_status.unwrap_or(if run.has_failed {
                sentry::protocol::SpanStatus::InternalError
            } else {
                sentry::protocol::SpanStatus::Ok
            });
            run.transaction.set_status(status);
            run.transaction.set_data(
                "result",
                match status {
                    sentry::protocol::SpanStatus::Ok => "success",
                    sentry::protocol::SpanStatus::Cancelled => "cancelled",
                    _ => "failure",
                }
                .into(),
            );

            // Transaction 的 tag 只能来自 finish 时当前 scope，故用临时 scope 承载本次运行的 tag
            let tags = std::mem::take(&mut run.tags);
            let transaction = run.transaction;
            sentry::with_scope(
                |scope| {
                    for (key, value) in tags {
                        scope.set_tag(&key, value);
                    }
                },
                || transaction.finish(),
            );
        }
    }
}
