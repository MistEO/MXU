//! 原生 Win32 对话框（进度、成功、错误）

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use super::to_wide;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateFontIndirectW, DeleteObject, GetStockObject, GetSysColorBrush, UpdateWindow,
    CLEARTYPE_QUALITY, COLOR_BTNFACE, DEFAULT_CHARSET, DEFAULT_GUI_FONT, HGDIOBJ, LOGFONTW,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Controls::{
    InitCommonControlsEx, ICC_PROGRESS_CLASS, INITCOMMONCONTROLSEX, PBM_SETPOS, PBM_SETRANGE32,
    PBS_SMOOTH, PROGRESS_CLASSW,
};
use windows::Win32::UI::WindowsAndMessaging::*;

const SS_CENTER: u32 = 0x0001;
const ES_MULTILINE: u32 = 0x0004;
const ES_READONLY: u32 = 0x0800;
const ES_AUTOVSCROLL: u32 = 0x0040;
const ID_OK_BUTTON: u16 = 1001;

const WM_UPDATE_PROGRESS: u32 = WM_USER + 1;
const WM_UPDATE_STATUS: u32 = WM_USER + 2;
const WM_DIALOG_CLOSE: u32 = WM_USER + 3;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum DialogType {
    Progress,
    #[allow(dead_code)]
    Success,
    Error,
}

#[derive(Default)]
struct DialogState {
    progress_hwnd: Option<HWND>,
    status_hwnd: Option<HWND>,
    button_hwnd: Option<HWND>,
    hfont: Option<HGDIOBJ>,
}

impl DialogState {
    fn clear(&mut self) {
        self.progress_hwnd = None;
        self.status_hwnd = None;
        self.button_hwnd = None;
    }
}

thread_local! {
    static DIALOG_STATE: RefCell<DialogState> = RefCell::new(DialogState::default());
}

unsafe extern "system" fn dialog_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => LRESULT(0),
        WM_UPDATE_PROGRESS => {
            DIALOG_STATE.with(|s| {
                if let Some(pb) = s.borrow().progress_hwnd {
                    let _ = SendMessageW(pb, PBM_SETPOS, wparam, LPARAM(0));
                }
            });
            LRESULT(0)
        }
        WM_UPDATE_STATUS => {
            DIALOG_STATE.with(|s| {
                if let Some(status) = s.borrow().status_hwnd {
                    let text_ptr = lparam.0 as *const u16;
                    let _ = SetWindowTextW(status, PCWSTR::from_raw(text_ptr));
                }
            });
            LRESULT(0)
        }
        WM_COMMAND => {
            let control_id = (wparam.0 & 0xFFFF) as u16;
            if control_id == ID_OK_BUTTON {
                PostQuitMessage(0);
            }
            LRESULT(0)
        }
        WM_DIALOG_CLOSE | WM_CLOSE => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        WM_DESTROY => {
            DIALOG_STATE.with(|s| {
                let mut g = s.borrow_mut();
                if let Some(h) = g.hfont.take() {
                    let _ = DeleteObject(h);
                }
                g.clear();
            });
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn center_window(hwnd: HWND, width: i32, height: i32) {
    unsafe {
        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        let _ = SetWindowPos(
            hwnd,
            None,
            (screen_w - width) / 2,
            (screen_h - height) / 2,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}

fn set_font(hwnd: HWND, font: Option<HGDIOBJ>) {
    unsafe {
        let ptr = font
            .map(|f| f.0 as usize)
            .unwrap_or_else(|| GetStockObject(DEFAULT_GUI_FONT).0 as usize);
        let _ = SendMessageW(hwnd, WM_SETFONT, WPARAM(ptr), LPARAM(1));
    }
}

fn create_ui_font() -> Option<HGDIOBJ> {
    unsafe {
        let mut lf = LOGFONTW::default();
        lf.lfHeight = -12;
        lf.lfCharSet = DEFAULT_CHARSET;
        lf.lfQuality = CLEARTYPE_QUALITY;
        let segoe = super::to_wide("Segoe UI");
        let len = (segoe.len() - 1).min(31);
        lf.lfFaceName[..len].copy_from_slice(&segoe[..len]);

        let hf = CreateFontIndirectW(&lf);
        if hf.0.is_null() {
            return None;
        }
        Some(HGDIOBJ(hf.0))
    }
}

pub(crate) struct CustomDialog {
    hwnd: HWND,
    progress: std::sync::Arc<AtomicU32>,
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
        if let Some(dialog) = Self::create(DialogType::Error, title, message, 560, 450) {
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
        let progress = std::sync::Arc::new(AtomicU32::new(0));
        let progress_clone = progress.clone();

        let title_owned = title.to_string();
        let message_owned = message.to_string();

        let (tx_hwnd, rx_hwnd) = mpsc::channel();

        let handle = std::thread::spawn(move || unsafe {
            let icc = INITCOMMONCONTROLSEX {
                dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
                dwICC: ICC_PROGRESS_CLASS,
            };
            let _ = InitCommonControlsEx(&icc);

            let hinstance = GetModuleHandleW(None).unwrap_or_default();

            let font_for_controls = create_ui_font();
            if let Some(h) = font_for_controls {
                DIALOG_STATE.with(|s| s.borrow_mut().hfont = Some(h));
            }

            let class_name = to_wide("WebView2CustomDialog");
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(dialog_wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: PCWSTR::from_raw(class_name.as_ptr()),
                hbrBackground: GetSysColorBrush(COLOR_BTNFACE),
                ..Default::default()
            };
            RegisterClassW(&wc);

            let title_wide = to_wide(&title_owned);
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                PCWSTR::from_raw(class_name.as_ptr()),
                PCWSTR::from_raw(title_wide.as_ptr()),
                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                width,
                height,
                None,
                None,
                hinstance,
                None,
            )
            .unwrap_or_default();

            center_window(hwnd, width, height);

            const MARGIN: i32 = 24;
            const BTN_W: i32 = 96;
            const BTN_H: i32 = 32;

            match dialog_type {
                DialogType::Progress => {
                    let status_text = to_wide(&message_owned);
                    let status_hwnd = CreateWindowExW(
                        WINDOW_EX_STYLE::default(),
                        PCWSTR::from_raw(to_wide("STATIC").as_ptr()),
                        PCWSTR::from_raw(status_text.as_ptr()),
                        WS_CHILD | WS_VISIBLE | WINDOW_STYLE(SS_CENTER),
                        MARGIN,
                        MARGIN,
                        width - 2 * MARGIN,
                        24,
                        hwnd,
                        None,
                        hinstance,
                        None,
                    )
                    .unwrap_or_default();
                    set_font(status_hwnd, font_for_controls);

                    let progressbar_hwnd = CreateWindowExW(
                        WINDOW_EX_STYLE::default(),
                        PROGRESS_CLASSW,
                        PCWSTR::null(),
                        WS_CHILD | WS_VISIBLE | WINDOW_STYLE(PBS_SMOOTH as u32),
                        MARGIN,
                        MARGIN + 24 + 8,
                        width - 2 * MARGIN,
                        22,
                        hwnd,
                        None,
                        hinstance,
                        None,
                    )
                    .unwrap_or_default();
                    let _ = SendMessageW(progressbar_hwnd, PBM_SETRANGE32, WPARAM(0), LPARAM(100));

                    DIALOG_STATE.with(|s| {
                        let mut g = s.borrow_mut();
                        g.status_hwnd = Some(status_hwnd);
                        g.progress_hwnd = Some(progressbar_hwnd);
                    });
                }
                DialogType::Success | DialogType::Error => {
                    let text_height = height - (MARGIN + 12 + BTN_H + 12);
                    let msg_text = to_wide(&message_owned);
                    let status_hwnd = CreateWindowExW(
                        WINDOW_EX_STYLE::default(),
                        PCWSTR::from_raw(to_wide("EDIT").as_ptr()),
                        PCWSTR::from_raw(msg_text.as_ptr()),
                        WS_CHILD
                            | WS_VISIBLE
                            | WINDOW_STYLE(ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL),
                        MARGIN,
                        MARGIN,
                        width - 2 * MARGIN,
                        text_height,
                        hwnd,
                        None,
                        hinstance,
                        None,
                    )
                    .unwrap_or_default();
                    set_font(status_hwnd, font_for_controls);

                    let btn_text = to_wide("确定");
                    let btn_hwnd = CreateWindowExW(
                        WINDOW_EX_STYLE::default(),
                        PCWSTR::from_raw(to_wide("BUTTON").as_ptr()),
                        PCWSTR::from_raw(btn_text.as_ptr()),
                        WS_CHILD | WS_VISIBLE | WINDOW_STYLE(BS_DEFPUSHBUTTON as u32),
                        (width - BTN_W) / 2,
                        height - 12 - BTN_H,
                        BTN_W,
                        BTN_H,
                        hwnd,
                        HMENU(ID_OK_BUTTON as *mut _),
                        hinstance,
                        None,
                    )
                    .unwrap_or_default();
                    set_font(btn_hwnd, font_for_controls);

                    DIALOG_STATE.with(|s| {
                        let mut g = s.borrow_mut();
                        g.status_hwnd = Some(status_hwnd);
                        g.button_hwnd = Some(btn_hwnd);
                    });
                }
            }

            let _ = tx_hwnd.send(hwnd.0 as usize);

            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = UpdateWindow(hwnd);

            let mut msg = MSG::default();
            let mut last_progress = 0u32;

            loop {
                if dialog_type == DialogType::Progress {
                    let current = progress_clone.load(Ordering::Relaxed);
                    if current != last_progress {
                        last_progress = current;
                        let _ = SendMessageW(
                            hwnd,
                            WM_UPDATE_PROGRESS,
                            WPARAM(current as usize),
                            LPARAM(0),
                        );
                    }
                }

                if PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    if msg.message == WM_QUIT {
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                } else {
                    std::thread::sleep(Duration::from_millis(30));
                }
            }

            let _ = DestroyWindow(hwnd);
        });

        let addr = rx_hwnd.recv_timeout(Duration::from_millis(500)).ok()?;
        let hwnd = HWND(addr as *mut c_void);

        Some(CustomDialog {
            hwnd,
            progress,
            handle: Some(handle),
        })
    }

    pub(crate) fn set_progress(&self, percent: u32) {
        self.progress.store(percent.min(100), Ordering::Relaxed);
    }

    pub(crate) fn set_status(&self, text: &str) {
        let wide_text = to_wide(text);
        unsafe {
            let _ = SendMessageW(
                self.hwnd,
                WM_UPDATE_STATUS,
                WPARAM(0),
                LPARAM(wide_text.as_ptr() as isize),
            );
        }
    }

    pub(crate) fn close(mut self) {
        unsafe {
            let _ = PostMessageW(self.hwnd, WM_DIALOG_CLOSE, WPARAM(0), LPARAM(0));
        }
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
