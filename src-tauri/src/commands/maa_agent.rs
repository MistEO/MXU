//! Agent 相关命令
//!
//! 提供 MaaFramework Agent 启动和管理功能

use log::{debug, error, info, warn};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use chrono::Local;
use tauri::{Emitter, State};

use maa_framework::agent_client::AgentClient;
use maa_framework::controller::Controller;
use maa_framework::resource::Resource;
use maa_framework::tasker::Tasker;

use super::types::{AgentConfig, MaaState, TaskConfig};
use super::utils::{emit_callback_event, get_logs_dir, normalize_path};
use regex::Regex;
use std::sync::LazyLock;

/// Agent 输出事件载荷
#[derive(Clone, serde::Serialize)]
pub struct AgentOutputEvent {
    pub instance_id: String,
    pub stream: String,
    pub line: String,
}

/// 发送 Agent 输出事件
fn emit_agent_output(app: &tauri::AppHandle, instance_id: &str, stream: &str, line: &str) {
    let event = AgentOutputEvent {
        instance_id: instance_id.to_string(),
        stream: stream.to_string(),
        line: strip_ansi_escapes(line),
    };
    if let Err(e) = app.emit("maa-agent-output", event) {
        log::error!("[agent_output] Failed to emit event: {}", e);
    }
}

/// 移除 ANSI 转义序列
static ANSI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07?").unwrap());

fn strip_ansi_escapes(s: &str) -> String {
    ANSI_RE.replace_all(s, "").into_owned()
}

/// 启动单个 Agent 子进程并完成连接
async fn start_single_agent(
    app: tauri::AppHandle,
    agent: AgentConfig,
    agent_index: usize,
    instance_id: String,
    cwd: String,
    tcp_compat_mode: bool,
    resource: Resource,
    controller: Controller,
    tasker: Tasker,
) -> Result<(AgentClient, std::process::Child), String> {
    info!("[agent#{}] Starting agent: {:?}", agent_index, agent);

    // 将整个启动过程移入 spawn_blocking，避免阻塞 async runtime 线程
    tauri::async_runtime::spawn_blocking(move || {
        let mut client = if tcp_compat_mode {
            debug!("[agent#{}] Creating TCP agent client...", agent_index);
            AgentClient::create_tcp(0).or_else(|e| {
                warn!(
                    "[agent#{}] TCP compat mode requested but failed: {}, falling back to default (IPC)",
                    agent_index, e
                );
                AgentClient::new(None)
            }).map_err(|e| e.to_string())?
        } else {
            debug!("[agent#{}] Creating default agent client...", agent_index);
            AgentClient::new(None).map_err(|e| e.to_string())?
        };

        if let Err(e) = client.bind(resource.clone()) {
            warn!("[agent#{}] Failed to bind resource: {}", agent_index, e);
            return Err(e.to_string());
        }

        let socket_id = client
            .identifier()
            .ok_or_else(|| format!("Failed to get identifier for agent #{}", agent_index))?;
        info!("[agent#{}] Agent socket_id: {}", agent_index, socket_id);

        // 启动子进程
        let mut args = agent.child_args.clone().unwrap_or_default();
        args.push(socket_id.clone());

        let joined = std::path::Path::new(&cwd).join(&agent.child_exec);
        let exec_path = normalize_path(&joined.to_string_lossy());

        info!(
            "[agent#{}] Spawning process: {:?} {:?} in {}",
            agent_index, exec_path, args, cwd
        );

        #[cfg(windows)]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = Command::new(&exec_path);
            c.creation_flags(CREATE_NO_WINDOW);
            c
        };

        #[cfg(not(windows))]
        let mut cmd = Command::new(&exec_path);

        cmd.args(&args)
            .current_dir(&cwd)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn agent #{}: {} (path: {:?})",
                agent_index, e, exec_path
            )
        })?;

        // 创建 agent 日志文件（多 agent、多实例时使用不同文件名，包含进程 PID）
        let pid = child.id();
        let log_filename = format!("mxu-agent-{}-{}.log", agent_index, pid);
        let agent_log_file = get_logs_dir().join(&log_filename);
        let log_file = Arc::new(Mutex::new(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&agent_log_file)
                .ok(),
        ));

        // 在单独线程中读取 stdout
        if let Some(stdout) = child.stdout.take() {
            let lf = log_file.clone();
            let app_handle = app.clone();
            let inst_id = instance_id.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) => break,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&buffer);
                            let clean_line = line.trim_end();
                            if let Ok(mut guard) = lf.lock() {
                                if let Some(file) = guard.as_mut() {
                                    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
                                    let _ = writeln!(file, "{} [stdout] {}", timestamp, clean_line);
                                }
                            }
                            info!(target: "agent", "[agent#{}][stdout] {}", agent_index, clean_line);
                            emit_agent_output(&app_handle, &inst_id, "stdout", clean_line);
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // Stderr thread
        if let Some(stderr) = child.stderr.take() {
            let lf = log_file.clone();
            let app_handle = app.clone();
            let inst_id = instance_id.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) => break,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&buffer);
                            let clean_line = line.trim_end();
                            if let Ok(mut guard) = lf.lock() {
                                if let Some(file) = guard.as_mut() {
                                    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
                                    let _ = writeln!(file, "{} [stderr] {}", timestamp, clean_line);
                                }
                            }
                            warn!(target: "agent", "[agent#{}][stderr] {}", agent_index, clean_line);
                            emit_agent_output(&app_handle, &inst_id, "stderr", clean_line);
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // 设置连接超时
        let timeout = agent.timeout.unwrap_or(-1);
        if let Err(e) = client.set_timeout(timeout) {
            warn!("Failed to set timeout for agent #{}: {}", agent_index, e);
        }

        info!("[agent#{}] Connecting to agent...", agent_index);

        if let Err(e) = client.connect() {
             error!("[agent#{}] Connection failed: {}", agent_index, e);
             let _ = child.kill();
             return Err(e.to_string());
        }

        info!("[agent#{}] Connected successfully!", agent_index);

        // 注册 Agent sink
        if let Err(e) = client.register_sinks(resource, controller, tasker) {
            error!("[agent#{}] Failed to register sinks: {}", agent_index, e);
            let _ = child.kill();
            return Err(e.to_string());
        }

        Ok((client, child))
    }).await.map_err(|e| e.to_string())?
}

/// 启动任务（支持多个 Agent）
#[tauri::command]
pub async fn maa_start_tasks(
    app: tauri::AppHandle,
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    tasks: Vec<TaskConfig>,
    agent_configs: Option<Vec<AgentConfig>>,
    cwd: String,
    tcp_compat_mode: bool,
) -> Result<Vec<i64>, String> {
    info!("maa_start_tasks called");

    info!("instance_id: {}", instance_id);
    info!("tasks: {:?}", tasks);
    info!("agent_configs: {:?}", agent_configs);
    info!("cwd: {}, tcp_compat_mode: {}", cwd, tcp_compat_mode);

    let (resource, controller, tasker) = {
        debug!("[start_tasks] Acquiring instances lock...");
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        debug!("[start_tasks] Instances lock acquired");
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;
        debug!("[start_tasks] Instance found: {}", instance_id);

        let res = instance
            .resource
            .as_ref()
            .ok_or("Resource not loaded")?
            .clone();
        debug!("[start_tasks] Resource acquired");

        let ctrl = instance
            .controller
            .as_ref()
            .ok_or("Controller not connected")?
            .clone();
        debug!("[start_tasks] Controller acquired");

        // 创建或获取 tasker
        if instance.tasker.is_none() {
            debug!("[start_tasks] Creating new tasker...");
            let t = Tasker::new().map_err(|e| e.to_string())?;
            debug!("[start_tasks] Tasker created");

            // 添加回调 Sink，用于接收任务状态通知
            debug!("[start_tasks] Adding tasker sink...");
            let app_handle = app.clone();
            t.add_sink(move |msg, detail| {
                emit_callback_event(&app_handle, msg, detail);
            })
            .map_err(|e| e.to_string())?;
            debug!("[start_tasks] Tasker sink added");

            // 添加 Context Sink，用于接收 Node 级别的通知（包含 focus 消息）
            debug!("[start_tasks] Adding tasker context sink...");
            let app_handle = app.clone();
            t.add_context_sink(move |msg, detail| {
                emit_callback_event(&app_handle, msg, detail);
            })
            .map_err(|e| e.to_string())?;
            debug!("[start_tasks] Tasker context sink added");

            debug!("[start_tasks] Binding resource and controller...");
            t.bind(&res, &ctrl).map_err(|e| e.to_string())?;
            debug!("[start_tasks] Resource and controller bound");

            instance.tasker = Some(t);
            debug!("[start_tasks] Tasker created and stored");
        } else {
            debug!("[start_tasks] Using existing tasker");
        }

        let t = instance.tasker.as_ref().unwrap().clone();
        (res, ctrl, t)
    };
    debug!("[start_tasks] Resource, controller and tasker acquired, proceeding...");

    // 检查 Tasker 初始化状态
    if !tasker.inited() {
        error!("[start_tasks] Tasker not properly initialized");
        return Err("Tasker not properly initialized".to_string());
    }

    // 启动所有 Agent（如果配置了）
    debug!("[start_tasks] Checking agent configs...");
    if let Some(configs) = agent_configs {
        if configs.is_empty() {
            debug!("[start_tasks] Agent configs list is empty, skipping agent setup");
        } else {
            info!("[start_tasks] Starting {} agent(s)...", configs.len());

            // 用于收集所有成功启动的 agent，失败时需要回滚清理
            let mut new_clients = Vec::new();
            let mut new_children = Vec::new();

            for (idx, config) in configs.iter().enumerate() {
                let res_clone = resource.clone();
                let ctrl_clone = controller.clone();
                let tasker_clone = tasker.clone();
                let app_handle = app.clone();
                let inst_id = instance_id.clone();
                let cwd_clone = cwd.clone();

                match start_single_agent(
                    app_handle,
                    config.clone(),
                    idx,
                    inst_id,
                    cwd_clone,
                    tcp_compat_mode,
                    res_clone,
                    ctrl_clone,
                    tasker_clone,
                )
                .await
                {
                    Ok((client, child)) => {
                        new_clients.push(client);
                        new_children.push(child);
                    }
                    Err(e) => {
                        error!(
                            "[start_tasks] Agent #{} failed to start: {}, cleaning up previously started agents...",
                            idx, e
                        );

                        // 回滚：清理已启动的 agent
                        for client in &new_clients {
                            let _ = client.disconnect();
                        }
                        for mut child in new_children {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                        return Err(format!("Agent start failed: {}", e));
                    }
                }
            }

            // 保存所有 agent 状态到 instance
            let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
            if let Some(instance) = instances.get_mut(&instance_id) {
                instance.agent_clients.extend(new_clients);
                instance.agent_children.extend(new_children);
            }

            info!(
                "[start_tasks] All {} agent(s) started successfully",
                configs.len()
            );

            info!("[start_tasks] Tasks started with agent(s)");
        }
    } else {
        debug!("[start_tasks] No agent configs, skipping agent setup");
    };

    debug!("[start_tasks] Submitting {} tasks...", tasks.len());
    let mut task_ids = Vec::new();
    for (idx, task) in tasks.iter().enumerate() {
        debug!("[start_tasks] Preparing task {}: entry={}", idx, task.entry);

        info!(
            "[start_tasks] Calling post_task: entry={}, override={}",
            task.entry, task.pipeline_override
        );
        match tasker.post_task(&task.entry, &task.pipeline_override) {
            Ok(job) => {
                info!("[start_tasks] post_task returned task_id: {}", job.id);
                task_ids.push(job.id);
                debug!(
                    "[start_tasks] Task {} submitted successfully, task_id: {}",
                    idx, job.id
                );
            }
            Err(_e) => {
                warn!("[start_tasks] Failed to post task: {}", task.entry);
            }
        }
    }

    debug!(
        "[start_tasks] All tasks submitted, total: {} task_ids",
        task_ids.len()
    );

    // 缓存 task_ids，用于刷新后恢复状态
    debug!("[start_tasks] Caching task_ids...");
    {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        if let Some(instance) = instances.get_mut(&instance_id) {
            instance.task_ids = task_ids.clone();
        }
    }
    debug!("[start_tasks] Task_ids cached");

    info!(
        "[start_tasks] maa_start_tasks completed successfully, returning {} task_ids",
        task_ids.len()
    );
    Ok(task_ids)
}

/// 停止所有 Agent 并断开连接（异步执行，避免阻塞 UI）
/// 不强制 kill 子进程，等待 MaaTaskerPostStop 触发子进程自行退出
#[tauri::command]
pub fn maa_stop_agent(state: State<'_, Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    info!("maa_stop_agent called for instance: {}", instance_id);

    let (clients, children) = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&instance_id)
            .ok_or("Instance not found")?;

        // 取出所有 agent clients 和 children，准备在后台线程清理
        (
            std::mem::take(&mut instance.agent_clients),
            std::mem::take(&mut instance.agent_children)
        )
    };

    if clients.is_empty() && children.is_empty() {
        debug!("[stop_agent] No agents to stop");
        return Ok(());
    }

    info!(
        "[stop_agent] Stopping {} agent client(s) and {} child process(es) in background...",
        clients.len(),
        children.len()
    );

    thread::spawn(move || {
        // 断开所有客户端连接
        for client in clients {
            let _ = client.disconnect();
        }

        // 等待子进程退出
        for (i, mut child) in children.into_iter().enumerate() {
            debug!("Waiting for agent process #{} to exit...", i);

            let start = std::time::Instant::now();
            let timeout = std::time::Duration::from_secs(5);
            let mut exited = false;

            // 同步轮询子进程状态
            while start.elapsed() < timeout {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        exited = true;
                        break;
                    }
                    Ok(None) => {
                        thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => {
                        error!("Error waiting for agent #{}: {}", i, e);
                        break;
                    }
                }
            }

            // 超时未退出则强制 kill
            if !exited {
                warn!("Agent process #{} did not exit in time, killing it...", i);
                let _ = child.kill();
                let _ = child.wait();
            } else {
                info!("Background: Agent #{} child process exited", i);
            }
        }
    });

    Ok(())
}
