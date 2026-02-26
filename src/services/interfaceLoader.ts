import { invoke } from '@tauri-apps/api/core';
import type {
  ProjectInterface,
  TaskItem,
  OptionDefinition,
  ControllerType,
  PresetItem,
} from '@/types/interface';
import { loggers } from '@/utils/logger';
import { parseJsonc } from '@/utils/jsonc';
import { isTauri } from '@/utils/paths';

const log = loggers.app;

/**
 * 可导入的 PI 文件结构（支持 task、option 和 preset 字段）
 */
interface ImportableInterface {
  task?: TaskItem[];
  option?: Record<string, OptionDefinition>;
  /** v2.3.0: 支持导入 preset */
  preset?: PresetItem[];
}

export interface LoadResult {
  interface: ProjectInterface;
  translations: Record<string, Record<string, string>>;
  basePath: string;
  dataPath: string; // 数据目录（macOS: ~/Library/Application Support/MXU/，其他平台同 basePath）
}

/**
 * 获取 exe 所在目录的绝对路径（Tauri 环境）
 */
async function getExeDir(): Promise<string> {
  return await invoke<string>('get_exe_dir');
}

/**
 * 获取应用数据目录的绝对路径（Tauri 环境）
 * - macOS: ~/Library/Application Support/MXU/
 * - Windows/Linux: exe 所在目录
 */
async function getDataDir(): Promise<string> {
  return await invoke<string>('get_data_dir');
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
// Import 文件加载与合并
// ============================================================================

/**
 * 从本地文件加载可导入的 PI 文件（Tauri 环境）
 * @param importPath 导入文件的路径（相对于 exe 目录）
 */
async function loadImportFromLocal(importPath: string): Promise<ImportableInterface> {
  try {
    const content = await readLocalFile(importPath);
    return parseJsonc<ImportableInterface>(content, importPath);
  } catch (err) {
    log.warn(`加载导入文件失败 [${importPath}]:`, err);
    return {};
  }
}

/**
 * 从 HTTP 路径加载可导入的 PI 文件
 * @param importPath 导入文件的 HTTP 路径
 */
async function loadImportFromHttp(importPath: string): Promise<ImportableInterface> {
  try {
    const response = await fetch(importPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const content = await response.text();
    return parseJsonc<ImportableInterface>(content, importPath);
  } catch (err) {
    log.warn(`加载导入文件失败 [${importPath}]:`, err);
    return {};
  }
}

/**
 * 合并导入的 task 和 option 到主 interface
 * @param pi 主 ProjectInterface
 * @param imported 导入的内容
 */
function mergeImported(pi: ProjectInterface, imported: ImportableInterface): void {
  // 合并 task 数组（追加到末尾）
  if (imported.task && imported.task.length > 0) {
    pi.task = [...pi.task, ...imported.task];
    log.info(`合并了 ${imported.task.length} 个导入的 task`);
  }

  // 合并 option 对象（后导入的覆盖先导入的）
  if (imported.option && Object.keys(imported.option).length > 0) {
    pi.option = { ...pi.option, ...imported.option };
    log.info(`合并了 ${Object.keys(imported.option).length} 个导入的 option`);
  }

  // v2.3.0: 合并 preset 数组（追加到末尾）
  if (imported.preset && imported.preset.length > 0) {
    pi.preset = [...(pi.preset || []), ...imported.preset];
    log.info(`合并了 ${imported.preset.length} 个导入的 preset`);
  }
}

/**
 * 处理 import 字段，加载并合并所有导入的文件
 * @param pi 主 ProjectInterface
 * @param basePath interface.json 所在目录
 * @param useLocal 是否使用本地文件加载（Tauri 环境）
 */
async function processImports(
  pi: ProjectInterface,
  basePath: string,
  useLocal: boolean,
): Promise<void> {
  if (!pi.import || pi.import.length === 0) {
    return;
  }

  log.info(`处理 ${pi.import.length} 个导入文件...`);

  for (const importPath of pi.import) {
    const fullPath = joinPath(basePath, importPath);
    log.info(`加载导入文件: ${fullPath}`);

    const imported = useLocal
      ? await loadImportFromLocal(fullPath)
      : await loadImportFromHttp(fullPath);

    mergeImported(pi, imported);
  }
}

// ============================================================================
// 平台过滤
// ============================================================================

// 检测当前操作系统
const isWindows = navigator.platform.toLowerCase().includes('win');
const isMacOS = navigator.platform.toLowerCase().includes('mac');

/**
 * 获取当前平台不支持的控制器类型集合
 */
function getUnsupportedControllerTypes(): Set<ControllerType> {
  const unsupported = new Set<ControllerType>();
  // 非 Windows 系统不支持 Win32 和 Gamepad
  if (!isWindows) {
    unsupported.add('Win32');
    unsupported.add('Gamepad');
  }
  // 非 macOS 系统不支持 PlayCover
  if (!isMacOS) {
    unsupported.add('PlayCover');
  }
  return unsupported;
}

/**
 * 过滤掉当前平台不支持的控制器
 * 在解析阶段直接移除，使后续所有消费 controller 的地方都只看到兼容的控制器
 */
function filterControllersByPlatform(pi: ProjectInterface): void {
  const unsupported = getUnsupportedControllerTypes();
  if (unsupported.size === 0) return;

  const originalCount = pi.controller.length;
  pi.controller = pi.controller.filter((c) => !unsupported.has(c.type));
  const filteredCount = originalCount - pi.controller.length;

  if (filteredCount > 0) {
    log.info(
      `平台过滤: 移除了 ${filteredCount} 个不支持的控制器 (不支持的类型: ${[...unsupported].join(', ')})`,
    );
  }
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

    // 获取数据目录（macOS 使用 Application Support，其他平台同 basePath）
    const dataPath = await getDataDir();
    log.info('dataPath (数据目录):', dataPath);

    const pi = await loadInterfaceFromLocal(interfacePath);

    // 处理 import 字段
    await processImports(pi, relativeBasePath, true);

    // 过滤掉当前平台不支持的控制器
    filterControllersByPlatform(pi);

    const translations = await loadTranslationsFromLocal(pi, relativeBasePath);
    return { interface: pi, translations, basePath, dataPath };
  }

  // 浏览器环境：通过 HTTP 加载
  const httpPath = `/${interfacePath}`;
  if (await httpFileExists(httpPath)) {
    const pi = await loadInterfaceFromHttp(httpPath);

    // 处理 import 字段
    const httpBasePath = relativeBasePath ? `/${relativeBasePath}` : '';
    await processImports(pi, httpBasePath, false);

    // 过滤掉当前平台不支持的控制器
    filterControllersByPlatform(pi);

    const translations = await loadTranslationsFromHttp(pi, httpBasePath);
    // 浏览器环境下 dataPath 与 basePath 相同
    return { interface: pi, translations, basePath: relativeBasePath, dataPath: relativeBasePath };
  }

  throw new Error('未找到 interface.json 文件，请确保程序同目录下存在 interface.json');
}
