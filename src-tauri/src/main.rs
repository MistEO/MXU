// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod webview2;

fn main() {
    #[cfg(target_os = "windows")]
    {
        if !webview2::ensure_webview2() {
            std::process::exit(1);
        }
    }

    mxu_lib::run()
}
