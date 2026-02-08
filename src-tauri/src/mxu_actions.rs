//! MXU 内置 Custom Actions
//!
//! 提供 MXU 特有的自定义动作实现，如 MXU_SLEEP 等

use std::os::raw::{c_char, c_void};

use log::{info, warn};

use crate::maa_ffi::{
    from_cstr, to_cstring, MaaBool, MaaContext, MaaCustomActionCallback, MaaId, MaaRect,
};

// ============================================================================
// MXU_SLEEP Custom Action
// ============================================================================

/// MXU_SLEEP 动作名称常量
const MXU_SLEEP_ACTION: &str = "MXU_SLEEP_ACTION";

/// MXU_SLEEP custom action 回调函数
/// 从 custom_action_param 中读取 sleep_time（秒），执行等待操作
extern "C" fn mxu_sleep_action(
    _context: *mut MaaContext,
    _task_id: MaaId,
    _current_task_name: *const c_char,
    _custom_action_name: *const c_char,
    custom_action_param: *const c_char,
    _reco_id: MaaId,
    _box_rect: *const MaaRect,
    _trans_arg: *mut c_void,
) -> MaaBool {
    // 使用 catch_unwind 捕获潜在的 panic
    let result = std::panic::catch_unwind(|| {
        // 解析参数 JSON，获取 sleep_time
        let param_str = if custom_action_param.is_null() {
            warn!("[MXU_SLEEP] custom_action_param is null, using default 5s");
            "{}".to_string()
        } else {
            unsafe { from_cstr(custom_action_param) }
        };

        info!("[MXU_SLEEP] Received param: {}", param_str);

        // 解析 JSON 获取 sleep_time
        let sleep_seconds: u64 = match serde_json::from_str::<serde_json::Value>(&param_str) {
            Ok(json) => json.get("sleep_time").and_then(|v| v.as_u64()).unwrap_or(5),
            Err(e) => {
                warn!(
                    "[MXU_SLEEP] Failed to parse param JSON: {}, using default 5s",
                    e
                );
                5
            }
        };

        info!("[MXU_SLEEP] Sleeping for {} seconds...", sleep_seconds);

        // 执行睡眠
        std::thread::sleep(std::time::Duration::from_secs(sleep_seconds));

        info!("[MXU_SLEEP] Sleep completed");
        1u8 // 返回成功
    });

    match result {
        Ok(ret) => ret,
        Err(e) => {
            log::error!("[MXU_SLEEP] Panic caught: {:?}", e);
            0 // 返回失败
        }
    }
}

/// 获取 MXU_SLEEP custom action 回调函数指针
pub fn get_mxu_sleep_action() -> MaaCustomActionCallback {
    Some(mxu_sleep_action)
}

// ============================================================================
// MXU_LAUNCH Custom Action
// ============================================================================

/// MXU_LAUNCH 动作名称常量
const MXU_LAUNCH_ACTION: &str = "MXU_LAUNCH_ACTION";

/// MXU_LAUNCH custom action 回调函数
/// 从 custom_action_param 中读取 program, args, wait_for_exit，启动外部程序
extern "C" fn mxu_launch_action(
    _context: *mut MaaContext,
    _task_id: MaaId,
    _current_task_name: *const c_char,
    _custom_action_name: *const c_char,
    custom_action_param: *const c_char,
    _reco_id: MaaId,
    _box_rect: *const MaaRect,
    _trans_arg: *mut c_void,
) -> MaaBool {
    let result = std::panic::catch_unwind(|| {
        let param_str = if custom_action_param.is_null() {
            warn!("[MXU_LAUNCH] custom_action_param is null");
            "{}".to_string()
        } else {
            unsafe { from_cstr(custom_action_param) }
        };

        info!("[MXU_LAUNCH] Received param: {}", param_str);

        let json: serde_json::Value = match serde_json::from_str(&param_str) {
            Ok(v) => v,
            Err(e) => {
                warn!("[MXU_LAUNCH] Failed to parse param JSON: {}", e);
                return 0u8;
            }
        };

        let program = match json.get("program").and_then(|v| v.as_str()) {
            Some(p) if !p.trim().is_empty() => p.to_string(),
            _ => {
                warn!("[MXU_LAUNCH] Missing or empty 'program' parameter");
                return 0u8;
            }
        };

        let args_str = json
            .get("args")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let wait_for_exit = json
            .get("wait_for_exit")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        info!(
            "[MXU_LAUNCH] Launching: program={}, args={}, wait_for_exit={}",
            program, args_str, wait_for_exit
        );

        let args_vec: Vec<&str> = if args_str.trim().is_empty() {
            vec![]
        } else {
            args_str.split_whitespace().collect()
        };

        let mut cmd = std::process::Command::new(&program);

        if !args_vec.is_empty() {
            cmd.args(&args_vec);
        }

        // 默认使用程序所在目录作为工作目录
        if let Some(parent) = std::path::Path::new(&program).parent() {
            if parent.exists() {
                cmd.current_dir(parent);
            }
        }

        if wait_for_exit {
            match cmd.status() {
                Ok(status) => {
                    let exit_code = status.code().unwrap_or(-1);
                    info!("[MXU_LAUNCH] Process exited with code: {}", exit_code);
                    1u8
                }
                Err(e) => {
                    log::error!("[MXU_LAUNCH] Failed to run program: {}", e);
                    0u8
                }
            }
        } else {
            match cmd.spawn() {
                Ok(_) => {
                    info!("[MXU_LAUNCH] Process spawned (not waiting)");
                    1u8
                }
                Err(e) => {
                    log::error!("[MXU_LAUNCH] Failed to spawn program: {}", e);
                    0u8
                }
            }
        }
    });

    match result {
        Ok(ret) => ret,
        Err(e) => {
            log::error!("[MXU_LAUNCH] Panic caught: {:?}", e);
            0
        }
    }
}

/// 获取 MXU_LAUNCH custom action 回调函数指针
pub fn get_mxu_launch_action() -> MaaCustomActionCallback {
    Some(mxu_launch_action)
}

// ============================================================================
// 注册入口
// ============================================================================

use crate::maa_ffi::MaaResource;

/// 为资源注册所有 MXU 内置 custom actions
/// 在资源创建后调用此函数
pub fn register_all_mxu_actions(
    lib: &crate::maa_ffi::MaaLibrary,
    resource: *mut MaaResource,
) -> Result<(), String> {
    // 注册 MXU_SLEEP
    let action_name = to_cstring(MXU_SLEEP_ACTION);
    let result = unsafe {
        (lib.maa_resource_register_custom_action)(
            resource,
            action_name.as_ptr(),
            get_mxu_sleep_action(),
            std::ptr::null_mut(),
        )
    };

    if result != 0 {
        info!("[MXU] Custom action MXU_SLEEP_ACTION registered successfully");
    } else {
        warn!("[MXU] Failed to register custom action MXU_SLEEP_ACTION");
    }

    // 注册 MXU_LAUNCH
    let action_name = to_cstring(MXU_LAUNCH_ACTION);
    let result = unsafe {
        (lib.maa_resource_register_custom_action)(
            resource,
            action_name.as_ptr(),
            get_mxu_launch_action(),
            std::ptr::null_mut(),
        )
    };

    if result != 0 {
        info!("[MXU] Custom action MXU_LAUNCH_ACTION registered successfully");
    } else {
        warn!("[MXU] Failed to register custom action MXU_LAUNCH_ACTION");
    }

    Ok(())
}
