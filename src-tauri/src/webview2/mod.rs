//! WebView2 检测与安装模块（仅 Windows）

mod detection;
mod dialog;
mod install;

pub use install::ensure_webview2;
pub use install::get_webview2_runtime_dir;
