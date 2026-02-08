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

    // 未来可以在这里添加更多 MXU 内置 actions
    // register_mxu_xxx_action(lib, resource)?;

    Ok(())
}
