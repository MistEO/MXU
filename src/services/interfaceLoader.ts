import { invoke } from '@tauri-apps/api/core';
import type { ProjectInterface } from '@/types/interface';
import { loggers } from '@/utils/logger';
import { parseJsonc } from '@/utils/jsonc';

const log = loggers.app;

export interface LoadResult {
  interface: ProjectInterface;
  translations: Record<string, Record<string, string>>;
  basePath: string;
}

const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * 获取 exe 所在目录的绝对路径（Tauri 环境）
 */
async function getExeDir(): Promise<string> {
  return await invoke<string>('get_exe_dir');
}

// ============================================================================
// Tauri 环境：通过 Rust 读取本地文件
// ============================================================================

/**
 * 通过 Tauri 命令读取本地文件
 * @param filename 相对于 exe 目录的文件路径
 */
async function readLocalFile(filename: string): Promise<string> {
  return await invoke<string>('read_local_file', { filename });
}

/**
 * 拼接路径（处理空 basePath 的情况）
 */
function joinPath(basePath: string, relativePath: string): string {
  if (!basePath) return relativePath;
  return `${basePath}/${relativePath}`;
}

/**
 * 从本地文件加载 interface.json（Tauri 环境）
 * @param interfacePath interface.json 的路径（相对于 exe 目录）
 */
async function loadInterfaceFromLocal(interfacePath: string): Promise<ProjectInterface> {
  const content = await readLocalFile(interfacePath);
  const pi = parseJsonc<ProjectInterface>(content, interfacePath);

  if (pi.interface_version !== 2) {
    throw new Error(`不支持的 interface 版本: ${pi.interface_version}，仅支持 version 2`);
  }

  return pi;
}

/**
 * 从本地文件加载翻译文件（Tauri 环境）
 * @param pi ProjectInterface 对象
 * @param basePath interface.json 所在目录（相对于 exe 目录）
 */
async function loadTranslationsFromLocal(
  pi: ProjectInterface,
  basePath: string,
): Promise<Record<string, Record<string, string>>> {
  const translations: Record<string, Record<string, string>> = {};

  if (!pi.languages) return translations;

  for (const [lang, relativePath] of Object.entries(pi.languages)) {
    try {
      const fullPath = joinPath(basePath, relativePath);
      const langContent = await readLocalFile(fullPath);
      translations[lang] = parseJsonc<Record<string, string>>(langContent, fullPath);
    } catch (err) {
      log.warn(`加载翻译文件失败 [${lang}]:`, err);
    }
  }

  return translations;
}

// ============================================================================
// 浏览器环境：通过 HTTP 加载（用于纯前端开发）
// ============================================================================

/**
 * 检查文件是否存在（HTTP 方式）
 */
async function httpFileExists(path: string): Promise<boolean> {
  try {
    const response = await fetch(path);
    const contentType = response.headers.get('content-type');
    return response.ok && (contentType?.includes('application/json') ?? false);
  } catch {
    return false;
  }
}

/**
 * 从 HTTP 路径加载 interface.json
 */
async function loadInterfaceFromHttp(path: string): Promise<ProjectInterface> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const content = await response.text();
  const pi = parseJsonc<ProjectInterface>(content, path);

  if (pi.interface_version !== 2) {
    throw new Error(`不支持的 interface 版本: ${pi.interface_version}，仅支持 version 2`);
  }

  return pi;
}

/**
 * 从 HTTP 路径加载翻译文件
 */
async function loadTranslationsFromHttp(
  pi: ProjectInterface,
  basePath: string,
): Promise<Record<string, Record<string, string>>> {
  const translations: Record<string, Record<string, string>> = {};

  if (!pi.languages) return translations;

  for (const [lang, relativePath] of Object.entries(pi.languages)) {
    try {
      const langPath = basePath ? `${basePath}/${relativePath}` : `/${relativePath}`;
      const response = await fetch(langPath);
      if (response.ok) {
        const langContent = await response.text();
        translations[lang] = parseJsonc<Record<string, string>>(langContent, langPath);
      }
    } catch (err) {
      log.warn(`加载翻译文件失败 [${lang}]:`, err);
    }
  }

  return translations;
}

// ============================================================================
// 统一入口
// ============================================================================

/**
 * 从路径中提取目录部分
 * 例如: "config/interface.json" -> "config"
 *       "interface.json" -> ""
 */
function getDirectoryFromPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return '';
  return filePath.substring(0, lastSlash);
}

/**
 * 加载 interface.json
 *
 * basePath 是 interface.json 所在目录的绝对路径，所有相对路径（翻译文件、资源、图标等）都基于此目录
 *
 * Tauri 环境：从 exe 同目录加载，basePath 为 exe 目录的绝对路径
 * 浏览器环境：从 HTTP 根路径加载（需要 public/interface.json），basePath 为空
 */
export async function autoLoadInterface(): Promise<LoadResult> {
  // interface.json 的路径（将来可配置）
  const interfacePath = 'interface.json';
  // 相对 basePath（interface.json 所在目录的相对路径部分）
  const relativeBasePath = getDirectoryFromPath(interfacePath);

  // Tauri 环境：通过 Rust 读取本地文件
  if (isTauri()) {
    log.info('Tauri 环境，加载 interface.json');
    // 获取 exe 目录的绝对路径作为 basePath
    const exeDir = await getExeDir();
    const basePath = relativeBasePath ? `${exeDir}/${relativeBasePath}` : exeDir;
    log.info('basePath (绝对路径):', basePath);

    const pi = await loadInterfaceFromLocal(interfacePath);
    const translations = await loadTranslationsFromLocal(pi, relativeBasePath);
    return { interface: pi, translations, basePath };
  }

  // 浏览器环境：通过 HTTP 加载
  const httpPath = `/${interfacePath}`;
  if (await httpFileExists(httpPath)) {
    const pi = await loadInterfaceFromHttp(httpPath);
    const translations = await loadTranslationsFromHttp(
      pi,
      relativeBasePath ? `/${relativeBasePath}` : '',
    );
    return { interface: pi, translations, basePath: relativeBasePath };
  }

  throw new Error('未找到 interface.json 文件，请确保程序同目录下存在 interface.json');
}
