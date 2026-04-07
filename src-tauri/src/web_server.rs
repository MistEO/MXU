//! Web 服务器
//!
//! 基于 axum 提供 HTTP API，供浏览器客户端（本机/局域网/公网）访问。
//! 与 Tauri invoke IPC 并列，实现同一套后端状态的双通道访问。

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};

use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, header},
    response::IntoResponse,
    routing::get,
    Json,
};
use rust_embed::RustEmbed;
use tower_http::cors::CorsLayer;

use crate::commands::{
    app_config::AppConfigState,
    maa_core::{
        connect_controller_impl, find_adb_devices_impl, find_win32_windows_impl,
        get_cached_image_impl, load_resource_impl, post_screencap_impl, run_task_impl,
        stop_task_impl,
    },
    types::{ControllerConfig, MaaState, TaskConfig},
    utils::{emit_callback_event, emit_config_changed, emit_state_changed},
};
use crate::ws_broadcast::WsBroadcast;

/// Web 服务器默认监听端口
pub const DEFAULT_PORT: u16 = 12701;
/// 端口搜索范围上限
const MAX_PORT_ATTEMPTS: u16 = 10;

/// 全局存储 Web 服务器实际监听端口（供前端查询）
static ACTUAL_PORT: AtomicU16 = AtomicU16::new(0);

/// 获取 Web 服务器实际监听端口（0 表示尚未启动或启动失败）
pub fn get_actual_port() -> u16 {
    ACTUAL_PORT.load(Ordering::Relaxed)
}

/// 探测本机局域网 IP（UDP 连接不发送数据，仅通过路由表推导本地地址）
static LOCAL_LAN_IP: OnceLock<Option<String>> = OnceLock::new();

fn detect_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("223.5.5.5:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

pub fn get_local_ip() -> Option<&'static str> {
    LOCAL_LAN_IP.get_or_init(detect_local_ip).as_deref()
}

/// 编译时嵌入的前端构建产物（../dist 目录）
/// release 构建时由 beforeBuildCommand (`pnpm build`) 生成
#[derive(RustEmbed)]
#[folder = "../dist"]
struct FrontendAssets;

fn guess_mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// 从内嵌资源提供前端文件，支持 SPA 路由回退（未匹配路径返回 index.html）
async fn serve_embedded(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = FrontendAssets::get(path) {
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, guess_mime(path))],
            file.data.into_owned(),
        )
            .into_response();
    }

    // SPA fallback: 非文件路径一律返回 index.html，由前端路由接管
    if let Some(file) = FrontendAssets::get("index.html") {
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            file.data.into_owned(),
        )
            .into_response();
    }

    StatusCode::NOT_FOUND.into_response()
}

/// axum 应用共享状态
#[derive(Clone)]
struct WebState {
    app_config: Arc<AppConfigState>,
    maa_state: Arc<MaaState>,
    app_handle: tauri::AppHandle,
    ws_broadcast: Arc<WsBroadcast>,
}

/// 启动 Web 服务器（在独立的 tokio 任务中运行，不阻塞 Tauri 启动）
///
/// `allow_lan_access` 为 true 时绑定 0.0.0.0（局域网可访问），否则绑定 127.0.0.1（仅本机）。
pub async fn start_web_server(
    app_config: Arc<AppConfigState>,
    maa_state: Arc<MaaState>,
    app_handle: tauri::AppHandle,
    ws_broadcast: Arc<WsBroadcast>,
    port: u16,
    allow_lan_access: bool,
) {
    let state = WebState {
        app_config,
        maa_state,
        app_handle,
        ws_broadcast,
    };

    // API 路由
    let api_routes = Router::new()
        // 配置 & 接口
        .route("/interface", get(handle_get_interface))
        .route("/config", get(handle_get_config).put(handle_put_config))
        .route("/background-image", get(handle_get_background_image))
        // WebSocket 实时推送
        .route("/ws", get(handle_ws_upgrade))
        // Maa 状态查询
        .route("/maa/state", get(handle_get_maa_state))
        .route("/maa/initialized", get(handle_get_maa_initialized))
        // Maa 设备扫描
        .route("/maa/devices", get(handle_get_adb_devices))
        .route("/maa/windows", get(handle_get_win32_windows))
        // Maa 实例管理
        .route("/maa/instances/:id", axum::routing::put(handle_create_instance).delete(handle_destroy_instance))
        // Maa 实例操作（通过 instance_id 路径参数）
        .route("/maa/instances/:id/connect", axum::routing::post(handle_connect_controller))
        .route("/maa/instances/:id/resource/load", axum::routing::post(handle_load_resource))
        .route("/maa/instances/:id/tasks/run", axum::routing::post(handle_run_task))
        .route("/maa/instances/:id/tasks/stop", axum::routing::post(handle_stop_task))
        .route("/maa/instances/:id/screenshot", get(handle_get_screenshot))
        // 运行日志（跨刷新持久化）
        .route("/logs", get(handle_get_all_logs))
        .route("/logs/:id", axum::routing::post(handle_push_log).delete(handle_clear_instance_logs))
        // 任务运行状态（跨刷新持久化）
        .route("/task-status", get(handle_get_all_task_run_status))
        .route("/task-status/:id", axum::routing::put(handle_sync_task_run_status).delete(handle_clear_task_run_status))
        // 系统信息
        .route("/system/is-elevated", get(handle_is_elevated))
        // 本地文件代理（浏览器通过此端点访问 exe 目录下的资源文件）
        .route("/local-file", get(handle_serve_local_file))
        .with_state(state);

    // 主路由：API + 静态前端页面
    let mut app: Router = Router::new().nest("/api", api_routes);

    // 优先从 exe 同目录的 dist/ 提供前端页面（方便热更新前端），
    // 否则使用编译时内嵌的前端资源（release 默认路径）
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let has_external_dist = exe_dir
        .as_ref()
        .map(|dir| dir.join("dist").exists())
        .unwrap_or(false);

    if has_external_dist {
        let dist_dir = exe_dir.unwrap().join("dist");
        log::info!("Web server: serving static files from {:?}", dist_dir);
        app = app.fallback_service(
            tower_http::services::ServeDir::new(&dist_dir)
                .append_index_html_on_directories(true)
                .fallback(tower_http::services::ServeFile::new(
                    dist_dir.join("index.html"),
                )),
        );
    } else {
        log::info!("Web server: serving embedded frontend assets");
        app = app.fallback(serve_embedded);
    }

    // CORS：允许所有来源（浏览器需要跨域支持）
    let app = app.layer(CorsLayer::permissive());

    let bind_host = if allow_lan_access { "0.0.0.0" } else { "127.0.0.1" };

    // 端口绑定策略：
    // 1. 先对默认端口重试几次（处理开发热重载时旧进程尚未退出的瞬态冲突）
    // 2. 若仍失败，尝试后续端口（port+1, port+2, ...）
    let listener = {
        let mut result = None;

        // Phase 1: 重试默认端口（最多 3 次，间隔 1s）
        for attempt in 0..3 {
            let addr = format!("{}:{}", bind_host, port);
            match tokio::net::TcpListener::bind(&addr).await {
                Ok(l) => {
                    result = Some((l, port));
                    break;
                }
                Err(e) => {
                    log::warn!(
                        "Web server bind attempt {}/3 on port {}: {}, retrying in 1s...",
                        attempt + 1,
                        port,
                        e
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }

        // Phase 2: 默认端口不可用，尝试递增端口
        if result.is_none() {
            for offset in 1..MAX_PORT_ATTEMPTS {
                let try_port = port + offset;
                let addr = format!("{}:{}", bind_host, try_port);
                match tokio::net::TcpListener::bind(&addr).await {
                    Ok(l) => {
                        result = Some((l, try_port));
                        break;
                    }
                    Err(e) => {
                        log::warn!("Web server port {} unavailable: {}", try_port, e);
                    }
                }
            }
        }

        result
    };

    match listener {
        Some((listener, actual_port)) => {
            ACTUAL_PORT.store(actual_port, Ordering::Relaxed);
            if actual_port != port {
                log::info!(
                    "Web server listening on http://{}:{} (fallback from default port {})",
                    bind_host,
                    actual_port,
                    port
                );
            } else {
                log::info!(
                    "Web server listening on http://{}:{}",
                    bind_host,
                    actual_port
                );
            }
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("Web server error: {}", e);
            }
        }
        None => {
            log::error!(
                "Web server failed to bind on any port in range {}-{}",
                port,
                port + MAX_PORT_ATTEMPTS - 1
            );
        }
    }
}

// ============================================================================
// WebSocket 处理
// ============================================================================

/// GET /api/ws
/// WebSocket 升级入口；每个客户端连接后各自获得一个 broadcast Receiver
async fn handle_ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<WebState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

/// 每个 WebSocket 连接的处理循环
///
/// - 将 broadcast channel 中的事件序列化为 JSON 文本帧后发送
/// - 每 30 秒发送一次 Ping 保活
/// - 客户端断开或发送 Close 帧后退出
async fn handle_ws_connection(mut socket: WebSocket, state: WebState) {
    let mut rx = state.ws_broadcast.subscribe();
    let mut ping_interval =
        tokio::time::interval(std::time::Duration::from_secs(30));
    // 跳过第一次立即触发
    ping_interval.tick().await;

    loop {
        tokio::select! {
            // 从 broadcast channel 收到事件后转发给客户端
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        match serde_json::to_string(&event) {
                            Ok(json) => {
                                if socket.send(Message::Text(json.into())).await.is_err() {
                                    break; // 客户端已断开
                                }
                            }
                            Err(e) => {
                                log::warn!("WS: failed to serialize event: {}", e);
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // 消费过慢，跳过了 n 条消息
                        log::warn!("WS client lagged, skipped {} events", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break; // 广播器已关闭（应用退出）
                    }
                }
            }
            // 发送心跳 Ping
            _ = ping_interval.tick() => {
                if socket.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
            // 接收客户端消息（主要用于检测断开）
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Pong(_))) => {} // 忽略 Pong
                    Some(Ok(_)) => {}                // 忽略其他客户端消息
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

// ============================================================================
// API Handlers
// ============================================================================

/// GET /api/interface
/// 返回已处理的 interface.json 内容、翻译文件及路径信息
async fn handle_get_interface(State(state): State<WebState>) -> impl IntoResponse {
    let pi = state.app_config.project_interface.lock().unwrap().clone();
    let translations = state.app_config.translations.lock().unwrap().clone();
    let base_path = state.app_config.base_path.lock().unwrap().clone();
    let data_path = state.app_config.data_path.lock().unwrap().clone();

    match pi {
        Some(interface) => Json(serde_json::json!({
            "interface": interface,
            "translations": translations,
            "basePath": base_path,
            "dataPath": data_path,
            "webServerPort": get_actual_port(),
        }))
        .into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "interface.json 尚未加载" })),
        )
            .into_response(),
    }
}

/// GET /api/config
/// 返回当前 MXU 配置（JSON 原文）
async fn handle_get_config(State(state): State<WebState>) -> impl IntoResponse {
    let config = state.app_config.config.lock().unwrap().clone();
    Json(config).into_response()
}

/// PUT /api/config
/// 更新配置：写入内存 + 持久化到磁盘 + 广播 ConfigChanged 给所有 WS 客户端
async fn handle_put_config(
    State(state): State<WebState>,
    Json(new_config): Json<serde_json::Value>,
) -> impl IntoResponse {
    match state.app_config.save_config(new_config) {
        Ok(()) => {
            // 通知所有客户端（WS 浏览器 + Tauri 桌面端）配置已变更
            emit_config_changed(&state.app_handle);
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// GET /api/maa/state
/// 返回所有 Maa 实例状态快照（与 maa_get_all_states invoke 命令返回格式相同）
async fn handle_get_maa_state(State(state): State<WebState>) -> impl IntoResponse {
    use std::collections::HashMap;

    let instances_result = state.maa_state.instances.lock();
    let adb_result = state.maa_state.cached_adb_devices.lock();
    let win32_result = state.maa_state.cached_win32_windows.lock();

    match (instances_result, adb_result, win32_result) {
        (Ok(mut instances), Ok(adb), Ok(win32)) => {
            let mut instance_states: HashMap<String, serde_json::Value> = HashMap::new();

            for (id, runtime) in instances.iter_mut() {
                let is_running = runtime.tasker.as_ref().is_some_and(|t| t.running());

                // 与 state.rs 的 maa_get_all_states 保持一致：清理停止标志
                if !is_running && runtime.stop_in_progress {
                    runtime.stop_in_progress = false;
                    runtime.stop_started_at = None;
                }

                // 字段名使用 snake_case，与 Tauri invoke 返回格式保持一致，
                // 前端 maaService.getAllStates 会统一做 camelCase 转换
                instance_states.insert(
                    id.clone(),
                    serde_json::json!({
                        "connected": runtime.controller.as_ref().is_some_and(|c| c.connected()),
                        "resource_loaded": runtime.resource.as_ref().is_some_and(|r| r.loaded()),
                        "tasker_inited": runtime.tasker.as_ref().is_some_and(|t| t.inited()),
                        "is_running": is_running,
                        "task_ids": runtime.task_ids,
                    }),
                );
            }

            Json(serde_json::json!({
                "instances": instance_states,
                "cached_adb_devices": serde_json::to_value(&*adb).unwrap_or(serde_json::Value::Array(vec![])),
                "cached_win32_windows": serde_json::to_value(&*win32).unwrap_or(serde_json::Value::Array(vec![])),
            }))
            .into_response()
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "获取状态锁失败" })),
        )
            .into_response(),
    }
}

/// GET /api/maa/initialized
/// 返回 Maa 库初始化状态及版本号
async fn handle_get_maa_initialized(State(state): State<WebState>) -> impl IntoResponse {
    let lib_dir_set = state.maa_state.lib_dir.lock().unwrap().is_some();

    // 库已加载时尝试获取版本号（load_library 后才可调用 maa_version）
    let version = if lib_dir_set {
        let v = maa_framework::maa_version().to_string();
        if v.is_empty() { None } else { Some(v) }
    } else {
        None
    };

    Json(serde_json::json!({
        "initialized": lib_dir_set,
        "version": version,
    }))
    .into_response()
}

// ============================================================================
// Phase 2: Maa 操作端点
// ============================================================================

/// GET /api/maa/devices
/// 扫描并返回 ADB 设备列表（会更新 MaaState 缓存）
async fn handle_get_adb_devices(State(state): State<WebState>) -> impl IntoResponse {
    match find_adb_devices_impl(state.maa_state).await {
        Ok(devices) => Json(serde_json::to_value(&devices).unwrap_or_default()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// GET /api/maa/windows
/// 扫描并返回 Win32 窗口列表（可选 class_regex / window_regex 过滤参数）
async fn handle_get_win32_windows(
    State(state): State<WebState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let class_regex = params.get("class_regex").cloned();
    let window_regex = params.get("window_regex").cloned();

    match find_win32_windows_impl(state.maa_state, class_regex, window_regex).await {
        Ok(windows) => Json(serde_json::to_value(&windows).unwrap_or_default()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// PUT /api/maa/instances/:id
/// 创建实例（幂等）
async fn handle_create_instance(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    ensure_instance_exists(&state.maa_state, &instance_id);
    Json(serde_json::json!({ "ok": true })).into_response()
}

/// DELETE /api/maa/instances/:id
/// 销毁实例
async fn handle_destroy_instance(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let mut instances = match state.maa_state.instances.lock() {
        Ok(g) => g,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    };
    instances.remove(&instance_id);
    Json(serde_json::json!({ "ok": true })).into_response()
}

/// 确保指定实例存在，不存在则自动创建
fn ensure_instance_exists(maa_state: &Arc<MaaState>, instance_id: &str) {
    if let Ok(mut instances) = maa_state.instances.lock() {
        instances
            .entry(instance_id.to_string())
            .or_insert_with(crate::commands::types::InstanceRuntime::default);
    }
}

/// POST /api/maa/instances/:id/connect
/// 连接控制器；自动创建不存在的实例
async fn handle_connect_controller(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
    Json(config): Json<ControllerConfig>,
) -> impl IntoResponse {
    ensure_instance_exists(&state.maa_state, &instance_id);

    let app_handle = state.app_handle.clone();
    let on_event = Arc::new(move |msg: &str, detail: &str| {
        emit_callback_event(&app_handle, msg, detail);
    });

    match connect_controller_impl(state.maa_state, instance_id.clone(), config, on_event).await {
        Ok(conn_id) => {
            emit_state_changed(&state.app_handle, &instance_id, "connected");
            Json(serde_json::json!({ "connId": conn_id })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// POST /api/maa/instances/:id/resource/load
/// 加载资源（异步，通过 WebSocket 回调通知完成状态）
/// Body: `{ "paths": ["/path/to/resource"] }`
async fn handle_load_resource(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    ensure_instance_exists(&state.maa_state, &instance_id);

    let paths: Vec<String> = match body.get("paths").and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "missing 'paths' array" })),
            )
                .into_response();
        }
    };

    let app_handle = state.app_handle.clone();
    let on_event: Arc<dyn Fn(&str, &str) + Send + Sync + 'static> =
        Arc::new(move |msg: &str, detail: &str| {
            emit_callback_event(&app_handle, msg, detail);
        });

    match load_resource_impl(&state.maa_state, &instance_id, &paths, on_event, None) {
        Ok(res_ids) => {
            emit_state_changed(&state.app_handle, &instance_id, "resource-loading");
            Json(serde_json::json!({ "resIds": res_ids })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// POST /api/maa/instances/:id/tasks/run
/// 运行一批任务（不启动 agent，适用于已连接的实例）
/// Body: `[{"entry": "TaskName", "pipelineOverride": "{}"}]`
async fn handle_run_task(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
    Json(tasks): Json<Vec<TaskConfig>>,
) -> impl IntoResponse {
    let app_handle = state.app_handle.clone();
    let on_event: Arc<dyn Fn(&str, &str) + Send + Sync + 'static> =
        Arc::new(move |msg: &str, detail: &str| {
            emit_callback_event(&app_handle, msg, detail);
        });

    let mut task_ids = Vec::new();
    let maa = state.maa_state;

    for task in &tasks {
        match run_task_impl(
            &maa,
            &instance_id,
            &task.entry,
            &task.pipeline_override,
            on_event.clone(),
        ) {
            Ok(id) => task_ids.push(id),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e })),
                )
                    .into_response();
            }
        }
    }

    emit_state_changed(&state.app_handle, &instance_id, "task-started");

    Json(serde_json::json!({ "taskIds": task_ids })).into_response()
}

/// POST /api/maa/instances/:id/tasks/stop
/// 停止当前实例的任务
async fn handle_stop_task(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match stop_task_impl(&state.maa_state, &instance_id) {
        Ok(()) => {
            emit_state_changed(&state.app_handle, &instance_id, "task-stopped");
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// GET /api/maa/instances/:id/screenshot
/// 同步截图：发起截图请求、等待完成（最多 15 秒）、返回 PNG 图片
async fn handle_get_screenshot(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    // 发起截图请求
    let screencap_id = match post_screencap_impl(&state.maa_state, &instance_id) {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response();
        }
    };

    // 等待截图完成（轮询，最多 15 秒）
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        // 尝试获取图像
        match get_cached_image_impl(&state.maa_state, &instance_id) {
            Ok(data_url) if !data_url.is_empty() => {
                // 解码 base64 返回 PNG 二进制
                if let Some(b64) = data_url.strip_prefix("data:image/png;base64,") {
                    use base64::{engine::general_purpose::STANDARD, Engine as _};
                    if let Ok(bytes) = STANDARD.decode(b64) {
                        return (
                            StatusCode::OK,
                            [(header::CONTENT_TYPE, "image/png")],
                            bytes,
                        )
                            .into_response();
                    }
                }
                // fallback: 返回 data URL
                return Json(serde_json::json!({ "dataUrl": data_url })).into_response();
            }
            _ => {}
        }

        if std::time::Instant::now() > deadline {
            return (
                StatusCode::GATEWAY_TIMEOUT,
                Json(serde_json::json!({
                    "error": "截图超时",
                    "screencapId": screencap_id
                })),
            )
                .into_response();
        }

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// GET /api/background-image
/// 读取配置中的背景图路径并返回图片二进制数据
async fn handle_get_background_image(State(state): State<WebState>) -> impl IntoResponse {
    let config = state.app_config.config.lock().unwrap().clone();

    let image_path = config
        .get("settings")
        .and_then(|s| s.get("backgroundImage"))
        .and_then(|p| p.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    match image_path {
        Some(path) => match std::fs::read(&path) {
            Ok(data) => {
                let content_type = if path.ends_with(".png") {
                    "image/png"
                } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
                    "image/jpeg"
                } else if path.ends_with(".gif") {
                    "image/gif"
                } else if path.ends_with(".webp") {
                    "image/webp"
                } else {
                    "application/octet-stream"
                };
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, content_type)],
                    data,
                )
                    .into_response()
            }
            Err(e) => (
                StatusCode::NOT_FOUND,
                format!("背景图读取失败: {}", e),
            )
                .into_response(),
        },
        None => (StatusCode::NOT_FOUND, "未设置背景图片").into_response(),
    }
}

/// GET /api/local-file?path=relative/path
/// 代理 exe 目录下的本地资源文件（图标、描述、翻译等），供浏览器客户端使用。
/// 包含路径穿越保护，仅允许访问 exe 目录内的文件。
async fn handle_serve_local_file(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    use crate::commands::file_ops::resolve_local_file_path;

    let file_path = match params.get("path") {
        Some(p) if !p.is_empty() => p.as_str(),
        _ => return (StatusCode::BAD_REQUEST, "缺少 path 参数").into_response(),
    };

    let resolved = match resolve_local_file_path(file_path) {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };

    match std::fs::read(&resolved) {
        Ok(data) => {
            let ext = resolved
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let content_type = match ext.as_str() {
                "json" | "jsonc" => "application/json; charset=utf-8",
                "txt" => "text/plain; charset=utf-8",
                "md" => "text/markdown; charset=utf-8",
                "html" | "htm" => "text/html; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "js" => "application/javascript; charset=utf-8",
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                "ico" => "image/x-icon",
                "bmp" => "image/bmp",
                _ => "application/octet-stream",
            };
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                data,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "文件不存在").into_response(),
    }
}

/// GET /api/logs — 获取所有实例的运行日志
async fn handle_get_all_logs(State(state): State<WebState>) -> impl IntoResponse {
    match state.maa_state.log_buffer.lock() {
        Ok(buffer) => Json(buffer.get_all().clone()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// POST /api/logs/:id — 推送一条运行日志
async fn handle_push_log(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
    Json(entry): Json<crate::commands::types::LogEntryDto>,
) -> impl IntoResponse {
    match state.maa_state.log_buffer.lock() {
        Ok(mut buffer) => {
            buffer.push(&instance_id, entry);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// DELETE /api/logs/:id — 清空指定实例的运行日志
async fn handle_clear_instance_logs(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.maa_state.log_buffer.lock() {
        Ok(mut buffer) => {
            buffer.clear_instance(&instance_id);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// GET /api/task-status — 获取所有实例的任务运行状态快照
async fn handle_get_all_task_run_status(State(state): State<WebState>) -> impl IntoResponse {
    match state.maa_state.task_run_snapshots.lock() {
        Ok(snapshots) => Json(snapshots.clone()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// PUT /api/task-status/:id — 同步指定实例的任务运行状态快照
async fn handle_sync_task_run_status(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
    Json(snapshot): Json<crate::commands::types::InstanceTaskRunSnapshot>,
) -> impl IntoResponse {
    match state.maa_state.task_run_snapshots.lock() {
        Ok(mut snapshots) => {
            snapshots.insert(instance_id, snapshot);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// DELETE /api/task-status/:id — 清空指定实例的任务运行状态
async fn handle_clear_task_run_status(
    State(state): State<WebState>,
    axum::extract::Path(instance_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.maa_state.task_run_snapshots.lock() {
        Ok(mut snapshots) => {
            snapshots.remove(&instance_id);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// GET /api/system/is-elevated
/// 返回当前进程是否以管理员权限运行
async fn handle_is_elevated() -> impl IntoResponse {
    Json(serde_json::json!({
        "elevated": crate::commands::system::is_elevated(),
    }))
    .into_response()
}
