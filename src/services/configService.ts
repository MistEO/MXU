import type { MxuConfig } from '@/types/config';
import { defaultConfig } from '@/types/config';
import { loggers } from '@/utils/logger';
import { parseJsonc } from '@/utils/jsonc';
import { joinPath, isTauri, getCacheDir } from '@/utils/paths';
import { apiGet, apiPut } from '@/utils/backendApi';

const log = loggers.config;

/**
 * 追踪由本客户端发起的 config 保存次数。
 * 后端保存配置后会双通道广播 ConfigChanged（WS + Tauri 事件），所有客户端都会收到，
 * 用此计数器让发起方跳过自己触发的 config-changed 事件，避免 importConfig 重置 UI 状态。
 */
let _pendingSelfSaves = 0;

export function markSelfSave(): void {
  _pendingSelfSaves++;
}

export function consumeSelfSave(): boolean {
  if (_pendingSelfSaves > 0) {
    _pendingSelfSaves--;
    return true;
  }
  return false;
}

// 配置文件子目录
const CONFIG_DIR = 'config';
const BACKUP_SUBDIR = 'config_backup';
const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 生成配置文件名 */
function getConfigFileName(projectName?: string): string {
  return projectName ? `mxu-${projectName}.json` : 'mxu.json';
}

/** 获取配置目录路径（同步版本，用于已知 dataPath 的场景） */
function getConfigDirSync(dataPath: string): string {
  return joinPath(dataPath || '.', CONFIG_DIR);
}

/** 获取配置文件完整路径（同步版本，用于已知 dataPath 的场景） */
function getConfigPathSync(dataPath: string, projectName?: string): string {
  return joinPath(dataPath || '.', CONFIG_DIR, getConfigFileName(projectName));
}

/**
 * 从文件加载配置
 * @param basePath 基础路径（exe 所在目录）
 * @param projectName 项目名称（来自 interface.json 的 name 字段）
 */
export async function loadConfig(basePath: string, projectName?: string): Promise<MxuConfig> {
  if (isTauri()) {
    const configPath = getConfigPathSync(basePath, projectName);

    log.debug('加载配置, 路径:', configPath);

    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');

    if (await exists(configPath)) {
      try {
        const content = await readTextFile(configPath);
        const config = parseJsonc<MxuConfig>(content, configPath);
        log.info('配置加载成功');
        return config;
      } catch (err) {
        log.warn('读取配置文件失败，使用默认配置:', err);
        return defaultConfig;
      }
    } else {
      log.info('配置文件不存在，使用默认配置');
    }
  } else {
    // 浏览器环境：优先从后端 HTTP API 获取（Tauri 进程运行时提供权威配置）
    try {
      const config = await apiGet<MxuConfig>('/config');
      if (config && config.version) {
        log.info('配置加载成功（后端 HTTP API）');
        return config;
      }
    } catch {
      // API 不可用，继续尝试静态文件
    }

    // 回退：尝试从 public 目录加载（纯前端开发预览模式）
    try {
      const fileName = getConfigFileName(projectName);
      const fetchPath =
        basePath === '' ? `/${CONFIG_DIR}/${fileName}` : `${basePath}/${CONFIG_DIR}/${fileName}`;
      const response = await fetch(fetchPath);
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const content = await response.text();
          const config = parseJsonc<MxuConfig>(content, fetchPath);
          log.info('配置加载成功（浏览器环境静态文件）');
          return config;
        }
      }
    } catch {
      // 浏览器环境加载失败是正常的
    }
  }

  return defaultConfig;
}

/**
 * 保存配置到文件
 * @param basePath 基础路径（exe 所在目录）
 * @param config 配置对象
 * @param projectName 项目名称（来自 interface.json 的 name 字段）
 */
export async function saveConfig(
  basePath: string,
  config: MxuConfig,
  projectName?: string,
): Promise<boolean> {
  if (!isTauri()) {
    // 浏览器环境：优先通过后端 HTTP API 持久化（多端一致性）
    try {
      markSelfSave();
      await apiPut<{ ok: boolean }>('/config', config);
      log.debug('配置已通过后端 API 保存');
      return true;
    } catch {
      // API 不可用，回退到 localStorage（离线/开发预览模式）
    }

    try {
      const storageKey = projectName ? `mxu-config-${projectName}` : 'mxu-config';
      localStorage.setItem(storageKey, JSON.stringify(config));
      log.debug('配置已保存到 localStorage（API 不可用时的回退）');
      return true;
    } catch {
      return false;
    }
  }

  const configDir = getConfigDirSync(basePath);
  const configPath = getConfigPathSync(basePath, projectName);

  log.debug('保存配置, 路径:', configPath);

  try {
    const { writeTextFile, mkdir, exists, readTextFile } = await import('@tauri-apps/plugin-fs');

    // 确保 config 目录存在
    if (!(await exists(configDir))) {
      log.debug('创建配置目录:', configDir);
      await mkdir(configDir, { recursive: true });
    }

    // 保护：拒绝用空实例覆盖已有的非空配置，避免“配置被清空”
    if (config.instances.length === 0 && (await exists(configPath))) {
      try {
        const existingContent = await readTextFile(configPath);
        const existingConfig = parseJsonc<Partial<MxuConfig>>(existingContent, configPath);
        const existingInstances = Array.isArray(existingConfig.instances)
          ? existingConfig.instances
          : [];
        if (existingInstances.length > 0) {
          log.error('检测到空实例覆盖风险，已拒绝保存:', configPath);
          return false;
        }
      } catch (err) {
        // 读取旧配置失败时，保持保守策略：拒绝覆盖，避免误清空
        log.error('读取现有配置失败，已拒绝覆盖保存:', err);
        return false;
      }
    }

    const content = JSON.stringify(config, null, 2);
    await writeTextFile(configPath, content);
    log.info('配置保存成功');

    // 通知 Rust 后端更新内存缓存并广播 config-changed 给所有其他客户端
    try {
      markSelfSave();
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('notify_config_changed', { config });
    } catch (err) {
      log.debug('notify_config_changed 调用失败（不影响保存）:', err);
    }

    return true;
  } catch (err) {
    log.error('保存配置文件失败:', err);
    return false;
  }
}

/**
 * 浏览器环境下从 localStorage 加载配置
 * @param projectName 项目名称（来自 interface.json 的 name 字段）
 */
export function loadConfigFromStorage(projectName?: string): MxuConfig | null {
  if (isTauri()) return null;

  try {
    const storageKey = projectName ? `mxu-config-${projectName}` : 'mxu-config';
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored) as MxuConfig;
    }
  } catch {
    // ignore
  }
  return null;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseTimestampFromFilename(filename: string): Date | null {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

/**
 * 在更新前备份配置文件到 cache/config_backup/，同时清理超过一周的旧备份
 */
export async function backupConfigBeforeUpdate(
  basePath: string,
  projectName?: string,
): Promise<void> {
  if (!isTauri()) return;

  const configPath = getConfigPathSync(basePath, projectName);

  try {
    const { exists, readTextFile, writeTextFile, mkdir, readDir, remove } =
      await import('@tauri-apps/plugin-fs');

    if (!(await exists(configPath))) {
      log.info('配置文件不存在，跳过备份');
      return;
    }

    const cacheDir = await getCacheDir();
    const backupDir = joinPath(cacheDir, BACKUP_SUBDIR);

    if (!(await exists(backupDir))) {
      await mkdir(backupDir, { recursive: true });
    }

    const configFileName = getConfigFileName(projectName);
    const baseName = configFileName.replace(/\.json$/, '');
    const timestamp = formatTimestamp(new Date());
    const backupFileName = `${baseName}-${timestamp}.json`;
    const backupPath = joinPath(backupDir, backupFileName);

    const content = await readTextFile(configPath);
    await writeTextFile(backupPath, content);
    log.info(`配置文件已备份: ${backupPath}`);

    // 清理超过一周的旧备份
    const now = Date.now();
    const entries = await readDir(backupDir);
    for (const entry of entries) {
      if (!entry.name || entry.isDirectory) continue;
      const fileDate = parseTimestampFromFilename(entry.name);
      if (fileDate && now - fileDate.getTime() > BACKUP_MAX_AGE_MS) {
        const oldPath = joinPath(backupDir, entry.name);
        await remove(oldPath).catch((e: unknown) => {
          log.warn(`删除过期备份失败: ${oldPath}`, e);
        });
        log.info(`已删除过期备份: ${entry.name}`);
      }
    }
  } catch (error) {
    log.warn('备份配置文件失败（不影响更新流程）:', error);
  }
}
