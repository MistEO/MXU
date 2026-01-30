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

/// 启动任务（支持 Agent）
#[tauri::command]
pub async fn maa_start_tasks(
    state: State<'_, Arc<MaaState>>,
    instance_id: String,
    tasks: Vec<TaskConfig>,
    agent_config: Option<AgentConfig>,
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

            // 根据 tcp_compat_mode 选择创建方式
            // TCP 模式用于不支持 AF_UNIX 的旧版 Windows（Build 17063 之前）
            let agent_client = if tcp_compat_mode {
                // 检查 TCP 模式是否可用（旧版本 MaaFramework 可能不支持）
                if let Some(create_tcp_fn) = lib.maa_agent_client_create_tcp {
                    debug!("[agent] Using TCP compat mode, calling maa_agent_client_create_tcp...");
                    let client = unsafe { create_tcp_fn(0) }; // port=0 自动选择端口
                    debug!("[agent] maa_agent_client_create_tcp returned: {:?}", client);
                    client
                } else {
                    warn!("[agent] TCP compat mode requested but MaaAgentClientCreateTcp not available, falling back to V2");
                    let client = unsafe { (lib.maa_agent_client_create_v2)(std::ptr::null()) };
                    debug!(
                        "[agent] maa_agent_client_create_v2 (fallback) returned: {:?}",
                        client
                    );
                    client
                }
            } else {
                debug!("[agent] Calling maa_agent_client_create_v2...");
                let client = unsafe { (lib.maa_agent_client_create_v2)(std::ptr::null()) };
                debug!("[agent] maa_agent_client_create_v2 returned: {:?}", client);
                client
            };

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
