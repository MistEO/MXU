//! Agent 相关命令
//!
//! 提供 MaaFramework Agent 启动和管理功能

use log::{debug, error, info, warn};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::State;

use crate::maa_ffi::{
    emit_agent_output, from_cstr, get_event_callback, to_cstring, MaaAgentClient, SendPtr,
    MAA_INVALID_ID, MAA_LIBRARY,
};

use super::types::{AgentConfig, MaaState, TaskConfig};
use super::utils::{get_logs_dir, normalize_path};

/// 启动单个 Agent 子进程并完成连接
///
/// 返回 `(agent_client_ptr, child_process)` 供调用方保存。
async fn start_single_agent(
    state: &Arc<MaaState>,
    instance_id: &str,
    agent: &AgentConfig,
    agent_index: usize,
    resource: &SendPtr<crate::maa_ffi::MaaResource>,
    tasker: &SendPtr<crate::maa_ffi::MaaTasker>,
    cwd: &str,
    tcp_compat_mode: bool,
) -> Result<(SendPtr<MaaAgentClient>, std::process::Child), String> {
    info!("[agent#{}] Starting agent: {:?}", agent_index, agent);

    // 创建 AgentClient 并获取 socket_id
    debug!(
        "[agent#{}] Acquiring MAA_LIBRARY lock for agent creation...",
        agent_index
    );
    let (agent_client, socket_id) = {
        let guard = MAA_LIBRARY
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        debug!("[agent#{}] MAA_LIBRARY lock acquired", agent_index);
        let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

        // 根据 tcp_compat_mode 选择创建方式
        let agent_client = if tcp_compat_mode {
            if let Some(create_tcp_fn) = lib.maa_agent_client_create_tcp {
                debug!(
                    "[agent#{}] Using TCP compat mode, calling maa_agent_client_create_tcp...",
                    agent_index
                );
                let client = unsafe { create_tcp_fn(0) };
                debug!(
                    "[agent#{}] maa_agent_client_create_tcp returned: {:?}",
                    agent_index, client
                );
                client
            } else {
                warn!(
                    "[agent#{}] TCP compat mode requested but MaaAgentClientCreateTcp not available, falling back to V2",
                    agent_index
                );
                let client = unsafe { (lib.maa_agent_client_create_v2)(std::ptr::null()) };
                debug!(
                    "[agent#{}] maa_agent_client_create_v2 (fallback) returned: {:?}",
                    agent_index, client
                );
                client
            }
        } else {
            debug!(
                "[agent#{}] Calling maa_agent_client_create_v2...",
                agent_index
            );
            let client = unsafe { (lib.maa_agent_client_create_v2)(std::ptr::null()) };
            debug!(
                "[agent#{}] maa_agent_client_create_v2 returned: {:?}",
                agent_index, client
            );
            client
        };

        if agent_client.is_null() {
            error!(
                "[agent#{}] Failed to create agent client (null pointer)",
                agent_index
            );
            return Err(format!("Failed to create agent client #{}", agent_index));
        }

        // 绑定资源
        debug!(
            "[agent#{}] Binding resource to agent client, resource ptr: {:?}",
            agent_index,
            resource.as_ptr()
        );
        unsafe {
            (lib.maa_agent_client_bind_resource)(agent_client, resource.as_ptr());
        }
        debug!("[agent#{}] Resource bound to agent client", agent_index);

        // 获取 socket identifier
        debug!("[agent#{}] Getting socket identifier...", agent_index);
        let socket_id = unsafe {
            let id_buffer = (lib.maa_string_buffer_create)();
            if id_buffer.is_null() {
                error!(
                    "[agent#{}] Failed to create string buffer (null pointer)",
                    agent_index
                );
                (lib.maa_agent_client_destroy)(agent_client);
                return Err(format!(
                    "Failed to create string buffer for agent #{}",
                    agent_index
                ));
            }

            let success = (lib.maa_agent_client_identifier)(agent_client, id_buffer);
            if success == 0 {
                error!("[agent#{}] Failed to get agent identifier", agent_index);
                (lib.maa_string_buffer_destroy)(id_buffer);
                (lib.maa_agent_client_destroy)(agent_client);
                return Err(format!(
                    "Failed to get agent identifier for agent #{}",
                    agent_index
                ));
            }

            let id = from_cstr((lib.maa_string_buffer_get)(id_buffer));
            debug!("[agent#{}] Got socket_id: {}", agent_index, id);
            (lib.maa_string_buffer_destroy)(id_buffer);
            id
        };

        (SendPtr::new(agent_client), socket_id)
    };

    info!("[agent#{}] Agent socket_id: {}", agent_index, socket_id);

    // 构建子进程参数
    let mut args = agent.child_args.clone().unwrap_or_default();
    args.push(socket_id);

    info!(
        "[agent#{}] Starting child process: {} {:?} in {}",
        agent_index, agent.child_exec, args, cwd
    );

    // 拼接并规范化路径
    let joined = std::path::Path::new(cwd).join(&agent.child_exec);
    let exec_path = normalize_path(&joined.to_string_lossy());
    debug!(
        "[agent#{}] Resolved executable path: {:?}, exists: {}",
        agent_index,
        exec_path,
        exec_path.exists()
    );

    // 启动子进程
    #[cfg(windows)]
    let spawn_result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new(&exec_path)
            .args(&args)
            .current_dir(cwd)
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
        .current_dir(cwd)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawn_result {
        Ok(c) => {
            info!("[agent#{}] Spawn succeeded!", agent_index);
            c
        }
        Err(e) => {
            let err_msg = format!(
                "Failed to start agent #{} process: {} (exec: {:?}, cwd: {})",
                agent_index, e, exec_path, cwd
            );
            error!("{}", err_msg);
            // 清理已创建的 agent_client
            let guard = MAA_LIBRARY.lock().ok();
            if let Some(guard) = guard {
                if let Some(lib) = guard.as_ref() {
                    unsafe {
                        (lib.maa_agent_client_destroy)(agent_client.as_ptr());
                    }
                }
            }
            return Err(err_msg);
        }
    };

    info!(
        "[agent#{}] Agent child process started, pid: {:?}",
        agent_index,
        child.id()
    );

    // 创建 agent 日志文件（多 agent、多实例时使用不同文件名，包含进程 PID）
    let pid = child.id();
    let log_filename = if agent_index == 0 {
        format!("mxu-agent-{}.log", pid)
    } else {
        format!("mxu-agent-{}-{}.log", agent_index, pid)
    };
    let agent_log_file = get_logs_dir().join(&log_filename);
    let log_file = Arc::new(Mutex::new(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&agent_log_file)
            .ok(),
    ));
    info!(
        "[agent#{}] Agent log file: {:?}",
        agent_index, agent_log_file
    );

    // 在单独线程中读取 stdout
    if let Some(stdout) = child.stdout.take() {
        let log_file_clone = Arc::clone(&log_file);
        let instance_id_clone = instance_id.to_string();
        let idx = agent_index;
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buffer = Vec::new();
            loop {
                buffer.clear();
                match reader.read_until(b'\n', &mut buffer) {
                    Ok(0) => break,
                    Ok(_) => {
                        if buffer.ends_with(&[b'\n']) {
                            buffer.pop();
                        }
                        if buffer.ends_with(&[b'\r']) {
                            buffer.pop();
                        }
                        let line = String::from_utf8_lossy(&buffer);
                        if let Ok(mut guard) = log_file_clone.lock() {
                            if let Some(ref mut file) = *guard {
                                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                                let _ = writeln!(file, "{} [stdout] {}", timestamp, line);
                            }
                        }
                        log::info!(target: "agent", "[agent#{}][stdout] {}", idx, line);
                        emit_agent_output(&instance_id_clone, "stdout", &line);
                    }
                    Err(e) => {
                        log::error!(target: "agent", "[agent#{}][stdout error] {}", idx, e);
                        break;
                    }
                }
            }
        });
    }

    // 在单独线程中读取 stderr
    if let Some(stderr) = child.stderr.take() {
        let log_file_clone = Arc::clone(&log_file);
        let instance_id_clone = instance_id.to_string();
        let idx = agent_index;
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = Vec::new();
            loop {
                buffer.clear();
                match reader.read_until(b'\n', &mut buffer) {
                    Ok(0) => break,
                    Ok(_) => {
                        if buffer.ends_with(&[b'\n']) {
                            buffer.pop();
                        }
                        if buffer.ends_with(&[b'\r']) {
                            buffer.pop();
                        }
                        let line = String::from_utf8_lossy(&buffer);
                        if let Ok(mut guard) = log_file_clone.lock() {
                            if let Some(ref mut file) = *guard {
                                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                                let _ = writeln!(file, "{} [stderr] {}", timestamp, line);
                            }
                        }
                        log::warn!(target: "agent", "[agent#{}][stderr] {}", idx, line);
                        emit_agent_output(&instance_id_clone, "stderr", &line);
                    }
                    Err(e) => {
                        log::error!(target: "agent", "[agent#{}][stderr error] {}", idx, e);
                        break;
                    }
                }
            }
        });
    }

    // 设置连接超时并获取 connect 函数指针
    let timeout_ms = agent.timeout.unwrap_or(-1);
    let connect_fn = {
        let guard = MAA_LIBRARY
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

        info!(
            "[agent#{}] Setting agent connect timeout: {} ms",
            agent_index, timeout_ms
        );
        unsafe {
            (lib.maa_agent_client_set_timeout)(agent_client.as_ptr(), timeout_ms);
        }
        lib.maa_agent_client_connect
    };

    // 等待连接（在独立线程池中执行，避免阻塞 UI 线程）
    let agent_ptr = agent_client.as_ptr() as usize;
    info!(
        "[agent#{}] Waiting for agent connection (non-blocking)...",
        agent_index
    );
    let connected = tokio::task::spawn_blocking(move || {
        let result = unsafe { connect_fn(agent_ptr as *mut MaaAgentClient) };
        result
    })
    .await
    .map_err(|e| format!("Agent #{} connect task panicked: {}", agent_index, e))?;

    if connected == 0 {
        error!(
            "[agent#{}] Agent connection failed, cleaning up...",
            agent_index
        );
        let guard = MAA_LIBRARY
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

        // 直接终止未成功连接的子进程，避免无用的后台进程残留
        if let Err(e) = child.kill() {
            warn!(
                "[agent#{}] Failed to kill agent child process after connection failure: {}",
                agent_index, e
            );
        } else if let Err(e) = child.wait() {
            warn!(
                "[agent#{}] Failed to wait on agent child process after connection failure: {}",
                agent_index, e
            );
        }

        unsafe {
            (lib.maa_agent_client_destroy)(agent_client.as_ptr());
        }
        return Err(format!("Failed to connect to agent #{}", agent_index));
    }

    info!("[agent#{}] Agent connected successfully!", agent_index);

    // 注册 Agent sink
    {
        let guard = MAA_LIBRARY
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

        // 获取 controller 指针
        let controller = {
            let instances = state
                .instances
                .lock()
                .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
            let instance = instances.get(instance_id).ok_or("Instance not found")?;
            instance.controller.ok_or("Controller not found")?
        };

        let res_result = unsafe {
            (lib.maa_agent_client_register_resource_sink)(agent_client.as_ptr(), resource.as_ptr())
        };
        let ctrl_result = unsafe {
            (lib.maa_agent_client_register_controller_sink)(agent_client.as_ptr(), controller)
        };
        let tasker_result = unsafe {
            (lib.maa_agent_client_register_tasker_sink)(agent_client.as_ptr(), tasker.as_ptr())
        };

        info!(
            "[agent#{}] All sinks registered: resource={}, controller={}, tasker={}",
            agent_index, res_result, ctrl_result, tasker_result
        );
    }

    Ok((agent_client, child))
}

/// 启动任务（支持多个 Agent）
#[tauri::command]
pub async fn maa_start_tasks(
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    tasks: Vec<TaskConfig>,
    agent_configs: Option<Vec<AgentConfig>>,
    cwd: String,
    tcp_compat_mode: bool,
) -> Result<Vec<i64>, String> {
    info!("maa_start_tasks called");
    info!(
        "instance_id: {}, tasks: {}, cwd: {}, tcp_compat_mode: {}",
        instance_id,
        tasks.len(),
        cwd,
        tcp_compat_mode
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

    // 启动所有 Agent（如果配置了）
    debug!("[start_tasks] Checking agent configs...");
    let has_agents = if let Some(agents) = &agent_configs {
        if agents.is_empty() {
            debug!("[start_tasks] Agent configs list is empty, skipping agent setup");
            false
        } else {
            info!("[start_tasks] Starting {} agent(s)...", agents.len());

            // 用于收集所有成功启动的 agent，失败时需要回滚清理
            let mut started_clients: Vec<SendPtr<MaaAgentClient>> = Vec::new();
            let mut started_children: Vec<std::process::Child> = Vec::new();

            for (idx, agent) in agents.iter().enumerate() {
                match start_single_agent(
                    state.inner(),
                    &instance_id,
                    agent,
                    idx,
                    &resource,
                    &tasker,
                    &cwd,
                    tcp_compat_mode,
                )
                .await
                {
                    Ok((client, child)) => {
                        started_clients.push(client);
                        started_children.push(child);
                    }
                    Err(e) => {
                        error!(
                            "[start_tasks] Agent #{} failed to start: {}, cleaning up previously started agents...",
                            idx, e
                        );

                        // 回滚：清理已启动的 agent
                        if let Ok(guard) = MAA_LIBRARY.lock() {
                            if let Some(lib) = guard.as_ref() {
                                for client in &started_clients {
                                    unsafe {
                                        (lib.maa_agent_client_disconnect)(client.as_ptr());
                                        (lib.maa_agent_client_destroy)(client.as_ptr());
                                    }
                                }
                            }
                        }
                        for mut child in started_children {
                            let _ = child.kill();
                            let _ = child.wait();
                        }

                        return Err(e);
                    }
                }
            }

            // 保存所有 agent 状态到 instance
            {
                let mut instances = state
                    .instances
                    .lock()
                    .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
                if let Some(instance) = instances.get_mut(&instance_id) {
                    for client in &started_clients {
                        instance.agent_clients.push(client.as_ptr());
                    }
                    instance.agent_children.extend(started_children);
                }
            }

            info!(
                "[start_tasks] All {} agent(s) started successfully",
                started_clients.len()
            );
            true
        }
    } else {
        debug!("[start_tasks] No agent configs, skipping agent setup");
        false
    };

    // 检查初始化状态并提交任务
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

    if has_agents {
        info!("[start_tasks] Tasks started with agent(s)");
    }

    info!(
        "[start_tasks] maa_start_tasks completed successfully, returning {} task_ids",
        task_ids.len()
    );
    Ok(task_ids)
}

/// 停止所有 Agent 并断开连接（异步执行，避免阻塞 UI）
/// 不强制 kill 子进程，等待 MaaTaskerPostStop 触发子进程自行退出
#[tauri::command]
pub fn maa_stop_agent(state: State<Arc<MaaState>>, instance_id: String) -> Result<(), String> {
    info!("maa_stop_agent called for instance: {}", instance_id);

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    // 取出所有 agent clients 和 children，准备在后台线程清理
    let agent_clients: Vec<*mut MaaAgentClient> = instance.agent_clients.drain(..).collect();
    let agent_children: Vec<std::process::Child> = instance.agent_children.drain(..).collect();

    if agent_clients.is_empty() && agent_children.is_empty() {
        debug!("[stop_agent] No agents to stop");
        return Ok(());
    }

    info!(
        "[stop_agent] Stopping {} agent client(s) and {} child process(es) in background...",
        agent_clients.len(),
        agent_children.len()
    );

    // 包装原始指针以跨线程传递
    let send_clients: Vec<SendPtr<MaaAgentClient>> =
        agent_clients.into_iter().map(SendPtr::new).collect();

    // 在后台线程执行阻塞的清理操作（disconnect 和 wait 可能阻塞）
    thread::spawn(move || {
        // 断开并销毁所有 agent
        let guard = MAA_LIBRARY.lock();
        if let Ok(guard) = guard {
            if let Some(lib) = guard.as_ref() {
                for (idx, agent) in send_clients.iter().enumerate() {
                    info!("Background: Disconnecting agent #{}...", idx);
                    unsafe {
                        (lib.maa_agent_client_disconnect)(agent.as_ptr());
                        (lib.maa_agent_client_destroy)(agent.as_ptr());
                    }
                    info!("Background: Agent #{} disconnected and destroyed", idx);
                }
            }
        }

        // 等待所有子进程自行退出，避免僵尸进程
        for (idx, mut child) in agent_children.into_iter().enumerate() {
            info!(
                "Background: Waiting for agent #{} child process to exit...",
                idx
            );
            let _ = child.wait();
            info!("Background: Agent #{} child process exited", idx);
        }
    });

    Ok(())
}
