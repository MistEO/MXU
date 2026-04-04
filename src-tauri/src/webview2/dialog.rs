//! 原生 Win32 对话框（进度、成功、错误）

use std::cell::RefCell;
use std::sync::mpsc;
use std::time::Duration;

use winsafe::co::{BS, CS, ES, SS, WS, WS_EX};
use winsafe::gui::{
    Button, ButtonOpts, Edit, EditOpts, Label, LabelOpts, ProgressBar, ProgressBarOpts, WindowMain,
    WindowMainOpts,
};
use winsafe::prelude::GuiEventsWindow;
use winsafe::prelude::GuiParent;
use winsafe::prelude::{GuiEventsButton, GuiWindow};
use winsafe::{AdjustWindowRectEx, PostQuitMessage, RECT};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum DialogType {
    Progress,
    #[allow(dead_code)]
    Success,
    Error,
}

#[derive(Default)]
struct DialogState {
    progress_hwnd: Option<ProgressBar>,
    status_hwnd: Option<Label>,
    edit_hwnd: Option<Edit>,
    button_hwnd: Option<Button>,
    dialog_type: Option<DialogType>,
}

impl DialogState {
    fn clear(&mut self) {
        self.progress_hwnd = None;
        self.status_hwnd = None;
        self.button_hwnd = None;
        self.dialog_type = None;
        self.edit_hwnd = None;
    }
}

thread_local! {
    static DIALOG_STATE: RefCell<DialogState> = RefCell::new(DialogState::default());
}

pub(crate) struct CustomDialog {
    hwnd: WindowMain,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl CustomDialog {
    pub(crate) fn new_progress(title: &str, initial_status: &str) -> Option<Self> {
        Self::create(DialogType::Progress, title, initial_status, 440, 150)
    }

    #[allow(dead_code)]
    pub(crate) fn show_success(title: &str, message: &str) {
        if let Some(dialog) = Self::create(DialogType::Success, title, message, 420, 170) {
            dialog.wait();
        }
    }

    pub(crate) fn show_error(title: &str, message: &str) {
        if let Some(dialog) = Self::create(DialogType::Error, title, message, 560, 500) {
            dialog.wait();
        }
    }

    fn create(
        dialog_type: DialogType,
        title: &str,
        message: &str,
        width: i32,
        height: i32,
    ) -> Option<Self> {
        let title_owned = title.to_string();
        let message_owned = message.to_string();

        let (tx_hwnd, rx_hwnd) = mpsc::channel();

        let handle = std::thread::spawn(move || {
            let wnd_style = WS::OVERLAPPED | WS::CAPTION | WS::SYSMENU;
            // width/height represent desired client area; compute actual window size
            let rc = RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            };
            let (wnd_w, wnd_h) =
                if let Ok(rc_new) = AdjustWindowRectEx(rc, wnd_style, false, WS_EX::default()) {
                    (rc_new.right - rc_new.left, rc_new.bottom - rc_new.top)
                } else {
                    (width, height)
                };

            let hwnd = WindowMain::new(WindowMainOpts {
                title: &title_owned,
                class_name: "WebView2CustomDialog",
                style: wnd_style,
                class_style: CS::HREDRAW | CS::VREDRAW,
                size: (wnd_w, wnd_h),
                ..Default::default()
            });

            const MARGIN: i32 = 24;
            const BTN_W: i32 = 96;
            const BTN_H: i32 = 32;

            match dialog_type {
                DialogType::Progress => {
                    let status_hwnd = Label::new(
                        &hwnd,
                        LabelOpts {
                            text: &message_owned,
                            control_style: SS::CENTER,
                            position: (MARGIN, MARGIN),
                            size: (width - 2 * MARGIN, 24),
                            ..Default::default()
                        },
                    );

                    let progressbar_hwnd = ProgressBar::new(
                        &hwnd,
                        ProgressBarOpts {
                            position: (MARGIN, MARGIN + 24 + 8),
                            size: (width - 2 * MARGIN, 22),
                            ..Default::default()
                        },
                    );

                    DIALOG_STATE.with(|s| {
                        let mut g = s.borrow_mut();
                        g.status_hwnd = Some(status_hwnd);
                        g.progress_hwnd = Some(progressbar_hwnd);
                        g.dialog_type = Some(dialog_type);
                    });
                }
                DialogType::Success | DialogType::Error => {
                    let text_height = height - (MARGIN + 12 + BTN_H + 12);
                    let status_hwnd = Edit::new(
                        &hwnd,
                        EditOpts {
                            text: &message_owned,
                            control_style: ES::MULTILINE | ES::READONLY | ES::AUTOVSCROLL,
                            position: (MARGIN, MARGIN),
                            width: width - 2 * MARGIN,
                            height: text_height,
                            ..Default::default()
                        },
                    );

                    let btn_hwnd = Button::new(
                        &hwnd,
                        ButtonOpts {
                            text: "确定",
                            position: ((width - BTN_W) / 2, height - 12 - BTN_H),
                            width: BTN_W,
                            height: BTN_H,
                            control_style: BS::DEFPUSHBUTTON,
                            ..Default::default()
                        },
                    );

                    let evt_hwnd = hwnd.clone();

                    btn_hwnd.on().bn_clicked(move || {
                        evt_hwnd.close();
                        Ok(())
                    });

                    DIALOG_STATE.with(|s| {
                        let mut g = s.borrow_mut();
                        g.edit_hwnd = Some(status_hwnd);
                        g.button_hwnd = Some(btn_hwnd);
                    });
                }
            }

            let _ = tx_hwnd.send(hwnd.clone());

            hwnd.on().wm_close(move || {
                DIALOG_STATE.with(|s| {
                    if s.borrow().dialog_type == Some(DialogType::Progress) {
                        std::process::exit(0);
                    }
                });
                PostQuitMessage(0);
                Ok(())
            });

            hwnd.on().wm_destroy(move || {
                DIALOG_STATE.with(|s| {
                    let mut g = s.borrow_mut();
                    g.clear();
                });
                Ok(())
            });

            let _ = hwnd.run_main(None);
        });

        let hwnd = rx_hwnd.recv_timeout(Duration::from_millis(500)).ok()?;

        Some(CustomDialog {
            hwnd,
            handle: Some(handle),
        })
    }

    pub(crate) fn set_progress(&self, percent: u32) {
        self.hwnd.run_ui_thread(move || {
            DIALOG_STATE.with(|s| {
                if let Some(progress) = &s.borrow().progress_hwnd {
                    progress.set_position(percent.min(100));
                };
            });
            Ok(())
        });
    }

    pub(crate) fn set_status(&self, text: String) {
        self.hwnd.run_ui_thread(move || {
            DIALOG_STATE.with(|s| {
                if let Some(status) = &s.borrow().status_hwnd {
                    let _ = status.hwnd().SetWindowText(&text);
                }
            });
            Ok(())
        });
    }

    pub(crate) fn close(mut self) {
        // 绕过 WM_CLOSE，直接退出消息循环。
        // WM_CLOSE 的处理器会在 Progress 对话框时调用 process::exit(0)，
        // 那是为用户点 X 取消启动设计的；程序主动关闭时不应走那条路径。
        self.hwnd.run_ui_thread(move || {
            PostQuitMessage(0);
            Ok(())
        });
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }

    pub(crate) fn wait(mut self) {
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}
