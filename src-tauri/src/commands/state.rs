//! 状态查询命令
//!
//! 提供实例状态和缓存数据查询功能

use log::debug;
use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use super::types::{AdbDevice, AllInstanceStates, InstanceState, MaaState, Win32Window};

/// 获取单个实例的运行时状态
#[tauri::command]
pub fn maa_get_instance_state(
    state: State<Arc<MaaState>>,
    instance_id: String,
) -> Result<InstanceState, String> {
    debug!(
        "maa_get_instance_state called, instance_id: {}",
        instance_id
    );

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or("Instance not found")?;

    // 通过 Maa API 查询真实状态
    let is_running = instance.tasker.as_ref().is_some_and(|t| t.running());

    if !is_running && instance.stop_in_progress {
        instance.stop_in_progress = false;
        instance.stop_started_at = None;
    }

    Ok(InstanceState {
        connected: instance.controller.as_ref().is_some_and(|c| c.connected()),
        resource_loaded: instance.resource.as_ref().is_some_and(|r| r.loaded()),
        tasker_inited: instance.tasker.as_ref().is_some_and(|t| t.inited()),
        is_running,
        task_ids: instance.task_ids.clone(),
    })
}

/// 获取所有实例的状态快照（用于前端启动时恢复状态）
#[tauri::command]
pub fn maa_get_all_states(state: State<Arc<MaaState>>) -> Result<AllInstanceStates, String> {
    debug!("maa_get_all_states called");

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let cached_adb = state.cached_adb_devices.lock().map_err(|e| e.to_string())?;
    let cached_win32 = state
        .cached_win32_windows
        .lock()
        .map_err(|e| e.to_string())?;

    let mut instance_states = HashMap::new();

    for (id, instance) in instances.iter_mut() {
        // 通过 Maa API 查询真实状态
        let is_running = instance.tasker.as_ref().is_some_and(|t| t.running());

        if !is_running && instance.stop_in_progress {
            instance.stop_in_progress = false;
            instance.stop_started_at = None;
        }

        instance_states.insert(
            id.clone(),
            InstanceState {
                connected: instance.controller.as_ref().is_some_and(|c| c.connected()),
                resource_loaded: instance.resource.as_ref().is_some_and(|r| r.loaded()),
                tasker_inited: instance.tasker.as_ref().is_some_and(|t| t.inited()),
                is_running,
                task_ids: instance.task_ids.clone(),
            },
        );
    }

    Ok(AllInstanceStates {
        instances: instance_states,
        cached_adb_devices: cached_adb.clone(),
        cached_win32_windows: cached_win32.clone(),
    })
}

/// 获取缓存的 ADB 设备列表
#[tauri::command]
pub fn maa_get_cached_adb_devices(state: State<Arc<MaaState>>) -> Result<Vec<AdbDevice>, String> {
    debug!("maa_get_cached_adb_devices called");
    let cached = state.cached_adb_devices.lock().map_err(|e| e.to_string())?;
    Ok(cached.clone())
}

/// 获取缓存的 Win32 窗口列表
#[tauri::command]
pub fn maa_get_cached_win32_windows(
    state: State<Arc<MaaState>>,
) -> Result<Vec<Win32Window>, String> {
    debug!("maa_get_cached_win32_windows called");
    let cached = state
        .cached_win32_windows
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(cached.clone())
}
