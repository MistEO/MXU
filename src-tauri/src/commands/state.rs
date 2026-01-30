//! 状态查询命令
//!
//! 提供实例状态和缓存数据查询功能

use log::debug;
use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::maa_ffi::MAA_LIBRARY;

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

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref().ok_or("MaaFramework not initialized")?;

    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get(&instance_id).ok_or("Instance not found")?;

    // 通过 Maa API 查询真实状态
    let connected = instance.controller.map_or(false, |ctrl| unsafe {
        (lib.maa_controller_connected)(ctrl) != 0
    });

    let resource_loaded = instance
        .resource
        .map_or(false, |res| unsafe { (lib.maa_resource_loaded)(res) != 0 });

    let tasker_inited = instance.tasker.map_or(false, |tasker| unsafe {
        (lib.maa_tasker_inited)(tasker) != 0
    });

    let is_running = instance.tasker.map_or(false, |tasker| unsafe {
        (lib.maa_tasker_running)(tasker) != 0
    });

    Ok(InstanceState {
        connected,
        resource_loaded,
        tasker_inited,
        is_running,
        task_ids: instance.task_ids.clone(),
    })
}

/// 获取所有实例的状态快照（用于前端启动时恢复状态）
#[tauri::command]
pub fn maa_get_all_states(state: State<Arc<MaaState>>) -> Result<AllInstanceStates, String> {
    debug!("maa_get_all_states called");

    let guard = MAA_LIBRARY.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_ref();

    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    let cached_adb = state.cached_adb_devices.lock().map_err(|e| e.to_string())?;
    let cached_win32 = state
        .cached_win32_windows
        .lock()
        .map_err(|e| e.to_string())?;

    let mut instance_states = HashMap::new();

    // 如果 MaaFramework 未初始化，返回空状态
    if let Some(lib) = lib {
        for (id, instance) in instances.iter() {
            // 通过 Maa API 查询真实状态
            let connected = instance.controller.map_or(false, |ctrl| unsafe {
                (lib.maa_controller_connected)(ctrl) != 0
            });

            let resource_loaded = instance
                .resource
                .map_or(false, |res| unsafe { (lib.maa_resource_loaded)(res) != 0 });

            let tasker_inited = instance.tasker.map_or(false, |tasker| unsafe {
                (lib.maa_tasker_inited)(tasker) != 0
            });

            let is_running = instance.tasker.map_or(false, |tasker| unsafe {
                (lib.maa_tasker_running)(tasker) != 0
            });

            instance_states.insert(
                id.clone(),
                InstanceState {
                    connected,
                    resource_loaded,
                    tasker_inited,
                    is_running,
                    task_ids: instance.task_ids.clone(),
                },
            );
        }
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
