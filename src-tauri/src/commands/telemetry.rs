//! 匿名遥测（数据埋点）模块
//!
//! 基于 Sentry Rust SDK，向资源作者在 `interface.json` 的 `telemetry.sentry.dsn`
//! 指定的 Sentry 项目上报崩溃与任务运行统计。
//!
//! 设计要点：
//! - DSN 仅来自前端传入（源自 interface.json）；空 DSN 或未开启时不初始化、不上报。
//! - 用户开关（帮助改进软件）由前端控制；调试 / 开发版本在前端强制禁用。
//! - 隐私：`send_default_pii = false`，仅上报哈希机器 ID、硬件摘要、版本、任务名与结果。
//! - 网络：SDK 后台异步发送、队列有界，不阻塞主流程；`shutdown_timeout` 设小值避免退出卡顿。
//! - 事件模型：一次整批运行 = 一个 Transaction，每个 SavedTask = 一个 child Span。

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Sentry 客户端守卫；持有期间遥测生效，置为 None 即关闭并 flush。
static TELEMETRY_GUARD: Mutex<Option<sentry::ClientInitGuard>> = Mutex::new(None);
/// 最近一次初始化配置，供运行时重新开启使用。
static TELEMETRY_CONFIG: Mutex<Option<TelemetryInitConfig>> = Mutex::new(None);
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
    /// 是否已有任务失败。
    has_failed: bool,
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

/// 初始化遥测（前端拿到 interface + config 后调用一次）。
#[tauri::command]
pub fn telemetry_init(config: TelemetryInitConfig) {
    if let Ok(mut slot) = TELEMETRY_CONFIG.lock() {
        *slot = Some(config.clone());
    }

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

    // 关闭：丢弃守卫（close 会 flush 并使后续 capture 变为 no-op）
    if let Ok(mut slot) = TELEMETRY_GUARD.lock() {
        *slot = None;
    }
    // 清理进行中的运行状态，避免悬挂事务
    if let Ok(mut runs) = RUNS.lock() {
        runs.clear();
    }
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
        // 网络差时退出不长时间阻塞
        shutdown_timeout: Duration::from_secs(2),
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
    let machine_id = hashed_machine_id();
    let hw = collect_hardware();

    sentry::configure_scope(|scope| {
        scope.set_user(Some(sentry::User {
            id: Some(machine_id.clone()),
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

/// 整批运行开始：创建 Transaction。`entries` 为各 SavedTask 的 interface 任务名。
pub fn on_run_start(instance_id: &str, entries: &[String]) {
    if !is_active() {
        return;
    }

    let ctx = sentry::TransactionContext::new("mxu.task_run", "mxu.run");
    let transaction: sentry::TransactionOrSpan = sentry::start_transaction(ctx).into();
    transaction.set_data("task_count", (entries.len() as u64).into());
    if !entries.is_empty() {
        transaction.set_data("entries", entries.join(",").into());
    }

    if let Ok(mut runs) = RUNS.lock() {
        runs.insert(
            instance_id.to_string(),
            RunState {
                transaction,
                children: HashMap::new(),
                has_failed: false,
            },
        );
    }
}

/// 单个 SavedTask 开始：创建 child Span。
pub fn on_task_start(instance_id: &str, maa_task_id: i64, entry: &str) {
    if !is_active() {
        return;
    }

    if let Ok(mut runs) = RUNS.lock() {
        if let Some(run) = runs.get_mut(instance_id) {
            let span: sentry::TransactionOrSpan =
                run.transaction.start_child("mxu.task", entry).into();
            span.set_data("entry", entry.into());
            run.children.insert(maa_task_id, span);
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
            if let Some(span) = run.children.remove(&maa_task_id) {
                span.set_data("result", if success { "success" } else { "failure" }.into());
                span.set_status(if success {
                    sentry::protocol::SpanStatus::Ok
                } else {
                    sentry::protocol::SpanStatus::InternalError
                });
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
            run.transaction.finish();
        }
    }
}
