//! WebView2 检测与安装模块（仅 Windows）

mod detection;
mod dialog;
mod install;

pub use install::ensure_webview2;

use std::os::windows::ffi::OsStrExt;

/// 将 Rust 字符串转换为 Windows 宽字符串 (null-terminated)
pub(crate) fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(Some(0))
        .collect()
}
