//! 托盘相关命令

use crate::tray;

/// 设置关闭时是否最小化到托盘
#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool) {
    tray::set_minimize_to_tray(enabled);
    log::info!("Minimize to tray: {}", enabled);
}

/// 获取关闭时是否最小化到托盘的设置
#[tauri::command]
pub fn get_minimize_to_tray() -> bool {
    tray::get_minimize_to_tray()
}

/// 更新托盘图标
#[tauri::command]
pub fn update_tray_icon(icon_path: String) -> Result<(), String> {
    tray::update_tray_icon(&icon_path)
}

/// 更新托盘 tooltip
#[tauri::command]
pub fn update_tray_tooltip(tooltip: String) -> Result<(), String> {
    tray::update_tray_tooltip(&tooltip)
}
