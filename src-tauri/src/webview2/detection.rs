//! WebView2 安装状态检测（注册表 + DLL）

use std::path::PathBuf;

use super::to_wide;
use windows::core::PCWSTR;
use windows::Win32::System::Registry::{
    RegCloseKey, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
};
use windows::Win32::System::SystemInformation::{
    GetSystemDirectoryW, GetSystemWow64DirectoryW,
};

/// 使用 Win32 API 获取系统目录路径
fn get_system_directory() -> Option<PathBuf> {
    let mut buffer = [0u16; 260];
    let len = unsafe { GetSystemDirectoryW(Some(&mut buffer)) };
    if len > 0 && (len as usize) < buffer.len() {
        Some(PathBuf::from(String::from_utf16_lossy(&buffer[..len as usize])))
    } else {
        None
    }
}

/// 使用 Win32 API 获取 SysWOW64 目录路径
fn get_system_wow64_directory() -> Option<PathBuf> {
    let mut buffer = [0u16; 260];
    let len = unsafe { GetSystemWow64DirectoryW(Some(&mut buffer)) };
    if len > 0 && (len as usize) < buffer.len() {
        Some(PathBuf::from(String::from_utf16_lossy(&buffer[..len as usize])))
    } else {
        None
    }
}

/// 检测 WebView2 是否已安装（注册表 + DLL 双重检测）
#[allow(unreachable_code)]
pub fn is_webview2_installed() -> bool {
    // 测试：强制视为未安装，以调试下载/安装流程。调试完请删除或注释下面这行。
    return false;

    let registry_paths = [
        r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    ];

    let mut registry_found = false;
    for path in &registry_paths {
        let path_wide = to_wide(path);
        let mut hkey: HKEY = HKEY::default();
        let result = unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                PCWSTR::from_raw(path_wide.as_ptr()),
                0,
                KEY_READ,
                &mut hkey,
            )
        };
        if result.is_ok() {
            unsafe { let _ = RegCloseKey(hkey); }
            registry_found = true;
            break;
        }
    }

    if !registry_found {
        return false;
    }

    let mut dll_paths = Vec::new();
    if let Some(sys_dir) = get_system_directory() {
        dll_paths.push(sys_dir.join("WebView2Loader.dll"));
    }
    if let Some(wow64_dir) = get_system_wow64_directory() {
        dll_paths.push(wow64_dir.join("WebView2Loader.dll"));
    }
    for dll_path in &dll_paths {
        if dll_path.exists() {
            return true;
        }
    }

    registry_found
}
