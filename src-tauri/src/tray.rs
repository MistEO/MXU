use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

/// 全局设置：关闭时是否最小化到托盘
static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);

/// 设置最小化到托盘选项
pub fn set_minimize_to_tray(enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::SeqCst);
}

/// 获取最小化到托盘选项
pub fn get_minimize_to_tray() -> bool {
    MINIMIZE_TO_TRAY.load(Ordering::SeqCst)
}

/// 初始化系统托盘
pub fn init_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 创建托盘菜单项
    let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let start_i = MenuItem::with_id(app, "start", "开始任务", true, None::<&str>)?;
    let stop_i = MenuItem::with_id(app, "stop", "停止任务", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_i, &start_i, &stop_i, &quit_i])?;

    // 获取图标
    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap());

    // 创建托盘图标
    let _tray = TrayIconBuilder::<Wry>::new()
        .icon(icon)
        .tooltip("MXU")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "show" => {
                    show_main_window(app);
                }
                "start" => {
                    // 发送开始任务事件到前端
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("tray-start-tasks", ());
                    }
                }
                "stop" => {
                    // 发送停止任务事件到前端
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("tray-stop-tasks", ());
                    }
                }
                "quit" => {
                    // 真正退出应用
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击显示窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// 显示主窗口
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 处理窗口关闭请求，返回 true 表示应该阻止关闭（最小化到托盘）
pub fn handle_close_requested(app: &AppHandle) -> bool {
    if get_minimize_to_tray() {
        // 最小化到托盘而不是关闭
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
        true // 阻止关闭
    } else {
        false // 允许关闭
    }
}
