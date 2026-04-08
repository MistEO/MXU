//! 后端统一截图服务
//!
//! 确保每个实例同一时刻只有一份 `post_screencap` 在执行。
//! 前端（Tauri App 和 Web UI）通过订阅/退订接口指定期望帧率，
//! 后端按所有订阅者中最快的速度驱动截图循环。
//!
//! # 设计
//!
//! - 每个实例维护一个 `InstanceScreenshotStream`，其中包含订阅者 Map 和截图循环运行标志。
//! - `subscribe` 确保截图循环仅被启动一次（CAS 原子操作）。
//! - 截图循环每次迭代清理超时（30s 无活动）的订阅者，按最小间隔驱动 `post_screencap`。
//! - 任务运行中跳过 `post_screencap`（任务管线已自动更新缓存）。

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use crate::commands::types::MaaState;

/// 订阅者超时时长：超过此时间无任何活动的订阅者将被自动清理。
const SUBSCRIBER_TIMEOUT_SECS: u64 = 30;
/// 截图最小间隔（ms），防止后端被过度请求。
const MIN_INTERVAL_MS: u64 = 100;

// ============================================================================
// 数据结构
// ============================================================================

struct ScreenshotSubscriber {
    interval_ms: u64,
    last_active: Instant,
}

struct InstanceScreenshotStream {
    subscribers: Mutex<HashMap<String, ScreenshotSubscriber>>,
    capture_running: AtomicBool,
}

/// 后端统一截图服务，挂载于 `MaaState` 中，全局单例。
#[derive(Default)]
pub struct ScreenshotService {
    streams: Mutex<HashMap<String, Arc<InstanceScreenshotStream>>>,
}

// ============================================================================
// 公开接口
// ============================================================================

impl ScreenshotService {
    /// 注册截图订阅者。
    ///
    /// 若该实例的截图循环尚未启动，则自动以最小订阅间隔驱动启动。
    /// 若 `subscriber_id` 已存在，则更新其 `interval_ms`（帧率变更时复用）。
    /// `handle` 是调用方提供的 tokio runtime handle，用于 spawn 截图循环。
    /// 调用方（async Tauri 命令或 axum handler）均运行在 tokio 上下文中，可通过
    /// `tokio::runtime::Handle::current()` 获取。
    pub fn subscribe(
        &self,
        maa_state: Arc<MaaState>,
        instance_id: String,
        subscriber_id: String,
        interval_ms: u64,
        handle: tokio::runtime::Handle,
    ) {
        let stream = {
            let mut streams = self.streams.lock().unwrap();
            streams
                .entry(instance_id.clone())
                .or_insert_with(|| {
                    Arc::new(InstanceScreenshotStream {
                        subscribers: Mutex::new(HashMap::new()),
                        capture_running: AtomicBool::new(false),
                    })
                })
                .clone()
        };

        {
            let mut subs = stream.subscribers.lock().unwrap();
            subs.insert(
                subscriber_id,
                ScreenshotSubscriber {
                    interval_ms: interval_ms.max(MIN_INTERVAL_MS),
                    last_active: Instant::now(),
                },
            );
        }

        // CAS 保证只有一个 tokio task 负责该实例的截图循环
        if stream
            .capture_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            handle.spawn(capture_loop(stream, maa_state, instance_id));
        }
    }

    /// 取消订阅。截图循环将在下次迭代检测到无订阅者时自动退出。
    pub fn unsubscribe(&self, instance_id: &str, subscriber_id: &str) {
        let streams = self.streams.lock().unwrap();
        if let Some(stream) = streams.get(instance_id) {
            stream.subscribers.lock().unwrap().remove(subscriber_id);
        }
    }

    /// 刷新订阅者的活跃时间戳，防止被 30s 超时清理。
    ///
    /// Web UI 可在每次 GET /screenshot 时调用，也可不调用（依赖显式 unsubscribe）。
    pub fn touch(&self, instance_id: &str, subscriber_id: &str) {
        let streams = self.streams.lock().unwrap();
        if let Some(stream) = streams.get(instance_id) {
            let mut subs = stream.subscribers.lock().unwrap();
            if let Some(sub) = subs.get_mut(subscriber_id) {
                sub.last_active = Instant::now();
            }
        }
    }
}

// ============================================================================
// 截图循环（每实例至多一个 tokio task）
// ============================================================================

/// 每个实例只允许同时运行一个截图循环。
///
/// 使用显式 `impl Future + Send + 'static` 返回类型声明，确保编译器能正确推断
/// Future 的 Send 性，避免 E0283 歧义。循环体内不在 `.await` 处持有任何非 Send 类型。
fn capture_loop(
    stream: Arc<InstanceScreenshotStream>,
    maa_state: Arc<MaaState>,
    instance_id: String,
) -> impl std::future::Future<Output = ()> + Send + 'static {
    async move {
        log::debug!("[screenshot] capture_loop started: {}", instance_id);

        loop {
            // 1. 清理超时订阅者，计算当前最小间隔
            //    MutexGuard 在块末尾 drop，不跨越 .await
            let min_interval_ms: u64 = {
                let mut subs = stream.subscribers.lock().unwrap();
                let now = Instant::now();
                subs.retain(|_, sub| {
                    now.duration_since(sub.last_active).as_secs() < SUBSCRIBER_TIMEOUT_SECS
                });
                if subs.is_empty() {
                    break;
                }
                subs.values()
                    .map(|s| s.interval_ms)
                    .min()
                    .unwrap_or(1000)
                    .max(MIN_INTERVAL_MS)
            };

            // 2. 检查实例状态，获取截图决策（仅用 bool 传递，不持有 Controller）
            //    MutexGuard 在块末尾 drop，不跨越 .await
            let (should_exit, should_screencap): (bool, bool) = {
                match maa_state.instances.lock() {
                    Err(_) => (true, false),
                    Ok(instances) => match instances.get(&instance_id) {
                        None => {
                            log::debug!(
                                "[screenshot] instance {} destroyed, stopping",
                                instance_id
                            );
                            (true, false)
                        }
                        Some(inst) => {
                            if inst.controller.is_none() {
                                log::debug!(
                                    "[screenshot] controller not connected for {}, stopping",
                                    instance_id
                                );
                                (true, false)
                            } else {
                                let is_running = inst.tasker.as_ref().is_some_and(|t| t.running());
                                // 任务运行中，管线自动更新缓存，跳过主动截图
                                (false, !is_running)
                            }
                        }
                    },
                }
            };

            if should_exit {
                break;
            }

            // 3. 需要截图时，重新加锁获取 Controller 引用并调用 post_screencap
            //    MutexGuard 及 Controller 引用均在块末尾 drop，不跨越 .await
            if should_screencap {
                if let Ok(instances) = maa_state.instances.lock() {
                    if let Some(inst) = instances.get(&instance_id) {
                        if let Some(ctrl) = inst.controller.as_ref() {
                            let _ = ctrl.post_screencap();
                        }
                    }
                }
            }

            // 4. 等待下一帧（此处 Future 状态机仅持有 Arc<...> 和 String，均为 Send）
            tokio::time::sleep(tokio::time::Duration::from_millis(min_interval_ms)).await;
        }

        // 标记循环已结束
        stream.capture_running.store(false, Ordering::SeqCst);

        // 竞态处理：若在「判断退出」与「写入 false」之间有新订阅者加入，
        // 重新检查并在必要时重启循环，防止订阅者存在但无循环运行的窗口期。
        let still_has_subs = !stream.subscribers.lock().unwrap().is_empty();
        if still_has_subs
            && stream
                .capture_running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        {
            tokio::spawn(capture_loop(stream, maa_state, instance_id.clone()));
        }

        log::debug!("[screenshot] capture_loop ended: {}", instance_id);
    }
}
