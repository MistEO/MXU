//! 应用配置状态
//!
//! 为 HTTP 服务器提供 interface.json 和配置文件的内存缓存，
//! 与现有 MaaState 并列，由 `app.manage()` 注入。

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::State;

/// 应用配置状态（供 HTTP server 使用）
#[derive(Default)]
pub struct AppConfigState {
    /// 已加载（含 import 合并、注释剥离）的 interface.json 内容
    pub project_interface: Mutex<Option<serde_json::Value>>,
    /// 翻译文件内容 (lang -> translations map)
    pub translations: Mutex<HashMap<String, serde_json::Value>>,
    /// exe 目录（基础路径，用于解析资源相对路径）
    pub base_path: Mutex<String>,
    /// 数据目录（配置文件存放位置）
    pub data_path: Mutex<String>,
    /// 项目名称（来自 interface.json 的 "name" 字段）
    pub project_name: Mutex<Option<String>>,
    /// 当前 MXU 配置（原始 JSON，启动时从磁盘加载，变更时写回）
    pub config: Mutex<serde_json::Value>,
}

impl AppConfigState {
    /// 从 exe 目录加载 interface.json（含 import 处理）及翻译文件，写入内存
    pub fn load_interface(&self, exe_dir: &Path) {
        let interface_path = exe_dir.join("interface.json");

        if !interface_path.exists() {
            log::warn!(
                "AppConfigState: interface.json not found at {:?}",
                interface_path
            );
            return;
        }

        let content = match std::fs::read_to_string(&interface_path) {
            Ok(c) => c,
            Err(e) => {
                log::error!("AppConfigState: failed to read interface.json: {}", e);
                return;
            }
        };

        let mut interface: serde_json::Value = match parse_jsonc(&content) {
            Ok(v) => v,
            Err(e) => {
                log::error!("AppConfigState: failed to parse interface.json: {}", e);
                return;
            }
        };

        // 提取项目名称
        let project_name = interface
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        log::info!(
            "AppConfigState: loaded interface for project: {:?}",
            project_name
        );

        // 处理 import 字段（将额外文件合并到主 interface）
        process_imports(&mut interface, exe_dir);

        // 加载翻译文件
        let translations = load_translations(&interface, exe_dir);

        *self.project_interface.lock().unwrap() = Some(interface);
        *self.translations.lock().unwrap() = translations;
        *self.project_name.lock().unwrap() = project_name;
        *self.base_path.lock().unwrap() = exe_dir.to_string_lossy().to_string();
    }

    /// 从数据目录加载配置文件，写入内存
    pub fn load_config(&self, data_dir: &Path) {
        *self.data_path.lock().unwrap() = data_dir.to_string_lossy().to_string();

        let project_name = self.project_name.lock().unwrap().clone();
        let config_filename = make_config_filename(project_name.as_deref());
        let config_path = data_dir.join("config").join(&config_filename);

        if config_path.exists() {
            match std::fs::read_to_string(&config_path) {
                Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(config) => {
                        log::info!("AppConfigState: config loaded from {:?}", config_path);
                        *self.config.lock().unwrap() = config;
                        return;
                    }
                    Err(e) => {
                        log::warn!("AppConfigState: failed to parse config: {}", e);
                    }
                },
                Err(e) => {
                    log::warn!("AppConfigState: failed to read config: {}", e);
                }
            }
        } else {
            log::info!(
                "AppConfigState: config file not found at {:?}, using default",
                config_path
            );
        }

        // 默认配置（第一次使用时）
        *self.config.lock().unwrap() = serde_json::json!({
            "version": "1.0",
            "instances": [],
            "settings": {
                "theme": "system",
                "language": "system"
            }
        });
    }

    /// 保存配置到磁盘并更新内存
    pub fn save_config(&self, config: serde_json::Value) -> Result<(), String> {
        let data_path = self.data_path.lock().unwrap().clone();
        if data_path.is_empty() {
            return Err("数据路径未初始化".to_string());
        }

        let project_name = self.project_name.lock().unwrap().clone();
        let config_filename = make_config_filename(project_name.as_deref());
        let config_dir = Path::new(&data_path).join("config");

        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
        }

        let config_path = config_dir.join(&config_filename);

        // 防止空实例列表覆盖已有非空配置（与前端 configService.ts 保持一致）
        let new_instances_empty = config
            .get("instances")
            .and_then(|v| v.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);

        if new_instances_empty && config_path.exists() {
            if let Ok(existing_content) = std::fs::read_to_string(&config_path) {
                if let Ok(existing) = serde_json::from_str::<serde_json::Value>(&existing_content) {
                    let existing_non_empty = existing
                        .get("instances")
                        .and_then(|v| v.as_array())
                        .map(|a| !a.is_empty())
                        .unwrap_or(false);
                    if existing_non_empty {
                        log::error!(
                            "AppConfigState: refusing to overwrite non-empty config with empty instances"
                        );
                        return Err("拒绝用空实例列表覆盖已有配置".to_string());
                    }
                }
            }
        }

        let content =
            serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

        std::fs::write(&config_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

        *self.config.lock().unwrap() = config;
        log::debug!("AppConfigState: config saved to {:?}", config_path);
        Ok(())
    }
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 通知后端配置已变更（任一客户端保存后调用）
///
/// 更新 `AppConfigState` 内存缓存，并通过双通道（WS + Tauri 事件）广播 `ConfigChanged`，
/// 使所有其他客户端（浏览器 WebUI 和 Tauri 桌面端）重新拉取最新配置。
/// 各端需配合 `consumeSelfSave` 跳过自身触发的通知。
#[tauri::command]
pub fn notify_config_changed(
    app: tauri::AppHandle,
    state: State<Arc<AppConfigState>>,
    config: serde_json::Value,
) -> Result<(), String> {
    *state.config.lock().map_err(|e| e.to_string())? = config;

    super::utils::emit_config_changed(&app);

    Ok(())
}

// ============================================================================
// 内部辅助函数
// ============================================================================

fn make_config_filename(project_name: Option<&str>) -> String {
    match project_name {
        Some(name) => format!("mxu-{}.json", name),
        None => "mxu.json".to_string(),
    }
}

/// 加载 interface.json 中声明的翻译文件
fn load_translations(
    interface: &serde_json::Value,
    base_dir: &Path,
) -> HashMap<String, serde_json::Value> {
    let mut translations = HashMap::new();

    let languages = match interface.get("languages").and_then(|v| v.as_object()) {
        Some(l) => l.clone(),
        None => return translations,
    };

    for (lang, rel_path) in &languages {
        let rel_path_str = match rel_path.as_str() {
            Some(s) => s,
            None => continue,
        };
        let lang_path = base_dir.join(rel_path_str);
        if lang_path.exists() {
            match std::fs::read_to_string(&lang_path) {
                Ok(content) => match parse_jsonc(&content) {
                    Ok(value) => {
                        translations.insert(lang.clone(), value);
                    }
                    Err(e) => {
                        log::warn!("AppConfigState: parse translation [{}] failed: {}", lang, e);
                    }
                },
                Err(e) => {
                    log::warn!("AppConfigState: read translation [{}] failed: {}", lang, e);
                }
            }
        }
    }

    translations
}

/// 处理 interface.json 中的 `import` 字段，将额外文件合并到主 interface
fn process_imports(interface: &mut serde_json::Value, base_dir: &Path) {
    let imports: Vec<String> = match interface.get("import").and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        None => return,
    };

    for rel_path in &imports {
        let full_path = base_dir.join(rel_path);
        match std::fs::read_to_string(&full_path) {
            Ok(content) => match parse_jsonc(&content) {
                Ok(imported) => {
                    merge_imported(interface, &imported);
                    log::info!("AppConfigState: merged import {:?}", rel_path);
                }
                Err(e) => {
                    log::warn!("AppConfigState: parse import {:?} failed: {}", rel_path, e);
                }
            },
            Err(e) => {
                log::warn!("AppConfigState: read import {:?} failed: {}", rel_path, e);
            }
        }
    }
}

/// 将导入的内容合并到主 interface（与 interfaceLoader.ts 的 mergeImported 行为一致）
fn merge_imported(interface: &mut serde_json::Value, imported: &serde_json::Value) {
    // 合并 task 数组（追加到末尾）
    if let Some(tasks) = imported.get("task").and_then(|v| v.as_array()) {
        if let Some(arr) = interface.get_mut("task").and_then(|v| v.as_array_mut()) {
            arr.extend(tasks.iter().cloned());
        } else {
            interface["task"] = serde_json::Value::Array(tasks.to_vec());
        }
    }

    // 合并 option 对象（后导入覆盖先导入）
    if let Some(options) = imported.get("option").and_then(|v| v.as_object()) {
        if let Some(main_opts) = interface.get_mut("option").and_then(|v| v.as_object_mut()) {
            for (k, v) in options {
                main_opts.insert(k.clone(), v.clone());
            }
        } else {
            interface["option"] = imported["option"].clone();
        }
    }

    // 合并 preset 数组（追加到末尾）
    if let Some(presets) = imported.get("preset").and_then(|v| v.as_array()) {
        if let Some(arr) = interface.get_mut("preset").and_then(|v| v.as_array_mut()) {
            arr.extend(presets.iter().cloned());
        } else {
            interface["preset"] = serde_json::Value::Array(presets.to_vec());
        }
    }

    // 合并 group 数组（按 name 去重，先定义优先）
    if let Some(groups) = imported.get("group").and_then(|v| v.as_array()) {
        let existing_names: std::collections::HashSet<String> = interface
            .get("group")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| {
                        g.get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default();

        let new_groups: Vec<serde_json::Value> = groups
            .iter()
            .filter(|g| {
                !g.get("name")
                    .and_then(|n| n.as_str())
                    .map(|name| existing_names.contains(name))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        if !new_groups.is_empty() {
            if let Some(arr) = interface.get_mut("group").and_then(|v| v.as_array_mut()) {
                arr.extend(new_groups);
            } else {
                interface["group"] = serde_json::Value::Array(new_groups);
            }
        }
    }
}

/// 解析 JSONC（带注释的 JSON），去除 `//` 和 `/* */` 注释后用 serde_json 解析
pub fn parse_jsonc(content: &str) -> Result<serde_json::Value, serde_json::Error> {
    let stripped = strip_jsonc_comments(content);
    serde_json::from_str(&stripped)
}

/// 去除 JSONC 中的注释，保留字符串内的斜杠字符
fn strip_jsonc_comments(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    let mut in_string = false;
    let mut escape_next = false;

    while let Some(ch) = chars.next() {
        if escape_next {
            result.push(ch);
            escape_next = false;
            continue;
        }

        if in_string {
            match ch {
                '\\' => {
                    result.push(ch);
                    escape_next = true;
                }
                '"' => {
                    result.push(ch);
                    in_string = false;
                }
                _ => result.push(ch),
            }
            continue;
        }

        match ch {
            '"' => {
                result.push(ch);
                in_string = true;
            }
            '/' => match chars.peek() {
                Some('/') => {
                    chars.next(); // consume second '/'
                    for c in chars.by_ref() {
                        if c == '\n' {
                            result.push('\n');
                            break;
                        }
                    }
                }
                Some('*') => {
                    chars.next(); // consume '*'
                    loop {
                        match chars.next() {
                            Some('*') if chars.peek() == Some(&'/') => {
                                chars.next(); // consume '/'
                                break;
                            }
                            None => break,
                            _ => {}
                        }
                    }
                }
                _ => result.push(ch),
            },
            _ => result.push(ch),
        }
    }

    result
}
