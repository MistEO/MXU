//! 托盘相关命令
//!
//! 桌面端委托给 crate::tray 模块，移动端提供空实现

/// 设置关闭时是否最小化到托盘
#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool) {
    #[cfg(desktop)]
    {
        crate::tray::set_minimize_to_tray(enabled);
        log::info!("Minimize to tray: {}", enabled);
    }
    #[cfg(mobile)]
    let _ = enabled;
}

/// 获取关闭时是否最小化到托盘的设置
#[tauri::command]
pub fn get_minimize_to_tray() -> bool {
    #[cfg(desktop)]
    return crate::tray::get_minimize_to_tray();
    #[cfg(mobile)]
    false
}

/// 更新托盘图标
#[tauri::command]
pub fn update_tray_icon(icon_path: String) -> Result<(), String> {
    #[cfg(desktop)]
    return crate::tray::update_tray_icon(&icon_path);
    #[cfg(mobile)]
    {
        let _ = icon_path;
        Ok(())
    }
}

/// 更新托盘 tooltip
#[tauri::command]
pub fn update_tray_tooltip(tooltip: String) -> Result<(), String> {
    #[cfg(desktop)]
    return crate::tray::update_tray_tooltip(&tooltip);
    #[cfg(mobile)]
    {
        let _ = tooltip;
        Ok(())
    }
}
