//! WebView2 安装状态检测（注册表 + DLL）

use std::path::PathBuf;

use super::to_wide;
use windows::core::PCWSTR;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
    KEY_READ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
};
use windows::Win32::System::SystemInformation::{GetSystemDirectoryW, GetSystemWow64DirectoryW};

/// 使用 Win32 API 获取系统目录路径
fn get_system_directory() -> Option<PathBuf> {
    let mut buffer = [0u16; 260];
    let len = unsafe { GetSystemDirectoryW(Some(&mut buffer)) };
    if len > 0 && (len as usize) < buffer.len() {
        Some(PathBuf::from(String::from_utf16_lossy(
            &buffer[..len as usize],
        )))
    } else {
        None
    }
}

/// 使用 Win32 API 获取 SysWOW64 目录路径
fn get_system_wow64_directory() -> Option<PathBuf> {
    let mut buffer = [0u16; 260];
    let len = unsafe { GetSystemWow64DirectoryW(Some(&mut buffer)) };
    if len > 0 && (len as usize) < buffer.len() {
        Some(PathBuf::from(String::from_utf16_lossy(
            &buffer[..len as usize],
        )))
    } else {
        None
    }
}

/// 检测 WebView2 是否已安装（注册表 + DLL 双重检测）
///
/// 根据微软官方文档，检查 pv (REG_SZ) 注册表值：
/// - HKLM 用于 per-machine 安装（管理员权限安装）
/// - HKCU 用于 per-user 安装（标准用户权限安装）
/// - pv 值必须存在且不为空、不为 "0.0.0.0"
///
/// 参考: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#detect-if-a-suitable-webview2-runtime-is-already-installed
#[allow(unreachable_code)]
pub fn is_webview2_installed() -> bool {
    // // 测试：强制视为未安装，以调试下载/安装流程。调试完请删除或注释下面这行。
    // return false;

    let registry_locations: &[(HKEY, &str)] = &[
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
    ];

    let mut registry_found = false;
    for (root, path) in registry_locations {
        let path_wide = to_wide(path);
        let mut hkey: HKEY = HKEY::default();
        let result = unsafe {
            RegOpenKeyExW(
                *root,
                PCWSTR::from_raw(path_wide.as_ptr()),
                0,
                KEY_READ,
                &mut hkey,
            )
        };
        if result.is_ok() {
            // 读取 pv (REG_SZ) 值，验证版本号有效
            let pv_name = to_wide("pv");
            let mut buffer = [0u16; 260];
            let mut size = (buffer.len() * 2) as u32;

            let value_result = unsafe {
                RegGetValueW(
                    hkey,
                    PCWSTR::null(),
                    PCWSTR::from_raw(pv_name.as_ptr()),
                    RRF_RT_REG_SZ,
                    None,
                    Some(buffer.as_mut_ptr() as *mut _),
                    Some(&mut size),
                )
            };

            unsafe {
                let _ = RegCloseKey(hkey);
            }

            if value_result.is_ok() {
                let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
                let version = String::from_utf16_lossy(&buffer[..len]);
                if !version.is_empty() && version != "0.0.0.0" {
                    registry_found = true;
                    break;
                }
            }
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

/// 检测 WebView2 是否被用户或组策略禁用
///
/// 检查以下注册表位置：
/// - HKCU\Software\Policies\Microsoft\Edge\WebView2\BrowserExecutableFolder
/// - HKLM\Software\Policies\Microsoft\Edge\WebView2\BrowserExecutableFolder
/// - HKCU\Software\Microsoft\Edge\WebView2\BrowserExecutableFolder (设置为空字符串表示禁用)
///
/// 返回 Some(reason) 如果被禁用，None 如果未被禁用
pub fn is_webview2_disabled() -> Option<String> {
    // 检查组策略禁用（通过 BrowserExecutableFolder 设置为特定值或空）
    // 参考: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#detect-if-a-suitable-webview2-runtime-is-already-installed

    // 检查 HKCU 和 HKLM 下的策略设置
    let policy_paths = [
        (
            HKEY_CURRENT_USER,
            r"Software\Policies\Microsoft\Edge\WebView2",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Policies\Microsoft\Edge\WebView2",
        ),
    ];

    for (root, path) in &policy_paths {
        let path_wide = to_wide(path);
        let mut hkey: HKEY = HKEY::default();
        let result = unsafe {
            RegOpenKeyExW(
                *root,
                PCWSTR::from_raw(path_wide.as_ptr()),
                0,
                KEY_READ,
                &mut hkey,
            )
        };

        if result.is_ok() {
            // 检查 BrowserExecutableFolder 值 - 如果设置为空字符串，表示禁用
            let value_name = to_wide("BrowserExecutableFolder");
            let mut buffer = [0u16; 260];
            let mut size = (buffer.len() * 2) as u32;

            let value_result = unsafe {
                RegGetValueW(
                    hkey,
                    PCWSTR::null(),
                    PCWSTR::from_raw(value_name.as_ptr()),
                    RRF_RT_REG_SZ,
                    None,
                    Some(buffer.as_mut_ptr() as *mut _),
                    Some(&mut size),
                )
            };

            if value_result.is_ok() {
                // 找到 null 终止符的位置
                let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
                let value = String::from_utf16_lossy(&buffer[..len]);

                // 如果值为空字符串，表示通过策略禁用了 WebView2
                if value.is_empty() {
                    unsafe {
                        let _ = RegCloseKey(hkey);
                    }
                    return Some("通过组策略禁用 (BrowserExecutableFolder 为空)".to_string());
                }
            }

            // 检查 ReleaseChannelPreference 或其他禁用标志
            let release_channel = to_wide("ReleaseChannelPreference");
            let mut dword_value: u32 = 0;
            let mut dword_size = std::mem::size_of::<u32>() as u32;

            let dword_result = unsafe {
                RegGetValueW(
                    hkey,
                    PCWSTR::null(),
                    PCWSTR::from_raw(release_channel.as_ptr()),
                    RRF_RT_REG_DWORD,
                    None,
                    Some(&mut dword_value as *mut u32 as *mut _),
                    Some(&mut dword_size),
                )
            };

            // 值为 0 可能表示禁用了 Evergreen WebView2
            if dword_result.is_ok() && dword_value == 0 {
                // 这不一定表示完全禁用，只是偏好设置，继续检查其他项
            }

            unsafe {
                let _ = RegCloseKey(hkey);
            }
        }
    }

    // 检查 Windows 功能中 WebView2 是否被禁用
    // 通过检查 Windows 可选功能状态
    let feature_paths = [(
        HKEY_LOCAL_MACHINE,
        r"SOFTWARE\Policies\Microsoft\EdgeWebView",
    )];

    for (root, path) in &feature_paths {
        let path_wide = to_wide(path);
        let mut hkey: HKEY = HKEY::default();
        let result = unsafe {
            RegOpenKeyExW(
                *root,
                PCWSTR::from_raw(path_wide.as_ptr()),
                0,
                KEY_READ,
                &mut hkey,
            )
        };

        if result.is_ok() {
            // 检查 Enabled 值
            let enabled_name = to_wide("Enabled");
            let mut dword_value: u32 = 1;
            let mut dword_size = std::mem::size_of::<u32>() as u32;

            let value_result = unsafe {
                RegGetValueW(
                    hkey,
                    PCWSTR::null(),
                    PCWSTR::from_raw(enabled_name.as_ptr()),
                    RRF_RT_REG_DWORD,
                    None,
                    Some(&mut dword_value as *mut u32 as *mut _),
                    Some(&mut dword_size),
                )
            };

            unsafe {
                let _ = RegCloseKey(hkey);
            }

            if value_result.is_ok() && dword_value == 0 {
                return Some("WebView2 已被组策略禁用".to_string());
            }
        }
    }

    // 检查 IFEO (Image File Execution Options) 禁用
    // Edge Blocker v2.0 等工具使用这种方式禁用 Edge/WebView2
    // 通过设置 Debugger 值来阻止进程启动
    // 注意：我们只检查 WebView2 进程，不检查 Edge 浏览器进程
    let ifeo_targets = [("msedgewebview2.exe", "WebView2 进程 (msedgewebview2.exe)")];

    for (exe_name, display_name) in &ifeo_targets {
        let ifeo_path = format!(
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\{}",
            exe_name
        );
        let path_wide = to_wide(&ifeo_path);
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
            // 检查是否存在 Debugger 值（用于阻止进程启动）
            let debugger_name = to_wide("Debugger");
            let mut buffer = [0u16; 260];
            let mut size = (buffer.len() * 2) as u32;

            let value_result = unsafe {
                RegGetValueW(
                    hkey,
                    PCWSTR::null(),
                    PCWSTR::from_raw(debugger_name.as_ptr()),
                    RRF_RT_REG_SZ,
                    None,
                    Some(buffer.as_mut_ptr() as *mut _),
                    Some(&mut size),
                )
            };

            unsafe {
                let _ = RegCloseKey(hkey);
            }

            if value_result.is_ok() {
                // 存在 Debugger 值，表示进程被 IFEO 拦截
                let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
                let debugger_value = String::from_utf16_lossy(&buffer[..len]);

                // 如果 Debugger 值不为空，说明被拦截了
                if !debugger_value.is_empty() {
                    return Some(format!(
                        "{} 已被 IFEO 禁用\r\n(可能使用了 Edge Blocker 等工具)",
                        display_name
                    ));
                }
            }
        }
    }

    None
}
