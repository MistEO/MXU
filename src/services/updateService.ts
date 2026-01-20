// MirrorChyan 更新检查服务
// API 文档: https://github.com/MirrorChyan/docs

import type { UpdateChannel } from '@/types/config';
import type { UpdateInfo, DownloadProgress } from '@/stores/appStore';
import { loggers } from '@/utils/logger';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { mkdir, remove, rename, exists } from '@tauri-apps/plugin-fs';
import { join, dirname, basename } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

const log = loggers.app;

// 下载状态标志，防止重复检查或下载
let isDownloading = false;

/**
 * 将文件移动到统一的 cache/old 文件夹，处理重名冲突
 * @param filePath 要移动的文件路径
 */
async function moveToOldFolder(filePath: string): Promise<void> {
  try {
    // 检查文件是否存在
    if (!await exists(filePath)) {
      return;
    }

    // 统一移动到 exe_dir/cache/old
    const exeDir = await invoke<string>('get_exe_dir');
    const oldDir = await join(exeDir, 'cache', 'old');
    const fileName = await basename(filePath);

    // 确保 old 目录存在
    await mkdir(oldDir, { recursive: true }).catch(() => {});

    let destPath = await join(oldDir, fileName);

    // 如果目标已存在，添加 .bak001, .bak002 等后缀
    if (await exists(destPath)) {
      for (let i = 1; i <= 999; i++) {
        const bakSuffix = `.bak${i.toString().padStart(3, '0')}`;
        destPath = await join(oldDir, `${fileName}${bakSuffix}`);
        if (!await exists(destPath)) {
          break;
        }
      }
    }

    // 执行移动
    await rename(filePath, destPath);
    log.info(`已移动到 cache/old: ${filePath} -> ${destPath}`);
  } catch (error) {
    log.warn(`移动文件到 cache/old 失败: ${filePath}`, error);
    // 如果移动失败，尝试删除（兜底）
    await remove(filePath).catch(() => {});
  }
}

/**
 * 检查当前是否正在下载
 */
export function getIsDownloading(): boolean {
  return isDownloading;
}

/**
 * 取消当前正在进行的下载
 * @returns 是否成功取消（如果没有正在进行的下载则返回 false）
 */
export async function cancelDownload(): Promise<boolean> {
  if (!isDownloading || !currentDownloadPath) {
    return false;
  }
  
  log.info('取消下载...');
  
  try {
    // 调用 Rust 后端删除临时文件
    await invoke('cancel_download', { savePath: currentDownloadPath });
  } catch (error) {
    log.warn('取消下载时清理临时文件失败:', error);
  }
  
  // 重置状态
  isDownloading = false;
  currentDownloadPath = null;
  return true;
}

const MIRRORCHYAN_API_BASES = [
  'https://mirrorchyan.com/api/resources',
  'https://mirrorchyan.net/api/resources',
];
const GITHUB_API_BASE = 'https://api.github.com';

// MirrorChyan API 错误码定义
// 参考: https://github.com/MirrorChyan/docs/blob/main/ErrorCode.md
export const MIRRORCHYAN_ERROR_CODES = {
  // 业务逻辑错误 (code > 0)
  INVALID_PARAMS: 1001,           // 参数不正确
  KEY_EXPIRED: 7001,              // CDK 已过期
  KEY_INVALID: 7002,              // CDK 错误
  RESOURCE_QUOTA_EXHAUSTED: 7003, // CDK 今日下载次数已达上限
  KEY_MISMATCHED: 7004,           // CDK 类型和待下载的资源不匹配
  KEY_BLOCKED: 7005,              // CDK 已被封禁
  RESOURCE_NOT_FOUND: 8001,       // 对应架构和系统下的资源不存在
  INVALID_OS: 8002,               // 错误的系统参数
  INVALID_ARCH: 8003,             // 错误的架构参数
  INVALID_CHANNEL: 8004,          // 错误的更新通道参数
  UNDIVIDED: 1,                   // 未区分的业务错误
} as const;

// MirrorChyan API 响应类型
interface MirrorChyanApiResponse {
  code: number;
  msg: string;
  data?: {
    version_name: string;
    version_number?: number;
    url?: string;
    sha256?: string;
    release_note?: string;
    custom_data?: string;
    update_type?: 'incremental' | 'full';
    channel?: string;
    filesize?: number;
    cdk_expired_time?: number;
    os?: string;
    arch?: string;
  };
}

// GitHub Release API 响应类型
interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

// 获取操作系统类型
function getOS(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  return '';
}

// 获取 OS 的常见别名（用于匹配文件名）
function getOSAliases(): string[] {
  const os = getOS();
  if (os === 'windows') return ['win', 'windows', 'win32', 'win64'];
  if (os === 'darwin') return ['macos', 'mac', 'darwin', 'osx'];
  if (os === 'linux') return ['linux'];
  return [];
}

// 获取架构的常见别名（用于匹配文件名）
function getArchAliases(): string[] {
  const arch = getArch();
  if (arch === 'amd64') return ['x86_64', 'x64', 'amd64', 'x86-64'];
  if (arch === 'arm64') return ['aarch64', 'arm64'];
  return [];
}

// 构建 User-Agent 字符串
function buildUserAgent(): string {
  const version = typeof __MXU_VERSION__ !== 'undefined' ? __MXU_VERSION__ : 'unknown';
  const os = getOS();
  const arch = getArch();
  
  // 构建平台信息字符串
  let platformInfo = '';
  if (os === 'windows') {
    platformInfo = 'Windows NT 10.0; Win64; x64';
  } else if (os === 'darwin') {
    platformInfo = 'Macintosh; Intel Mac OS X';
  } else if (os === 'linux') {
    platformInfo = 'X11; Linux x86_64';
  }
  
  // 格式: MXU/版本号 (平台信息) Tauri/2.0
  return `MXU/${version} (${platformInfo}; ${arch}) Tauri/2.0`;
}

// 获取 CPU 架构
function getArch(): string {
  // 浏览器环境难以准确获取架构，默认使用 x64
  // Tauri 环境可以通过 os 插件获取更准确的信息
  return 'amd64';
}

export interface CheckUpdateOptions {
  resourceId: string;        // mirrorchyan_rid
  currentVersion: string;    // 当前版本
  cdk?: string;              // MirrorChyan CDK
  channel?: UpdateChannel;   // 更新频道
  userAgent?: string;        // 客户端标识
}

/**
 * 向单个 API 基础 URL 发送更新检查请求
 */
async function fetchUpdateFromBase(
  apiBase: string,
  resourceId: string,
  params: URLSearchParams
): Promise<MirrorChyanApiResponse> {
  const url = `${apiBase}/${resourceId}/latest?${params.toString()}`;
  const response = await tauriFetch(url, {
    headers: {
      'User-Agent': buildUserAgent(),
    },
  });
  return await response.json();
}

/**
 * 检查更新
 * @returns UpdateInfo 或 null（检查失败时或正在下载时）
 */
export async function checkUpdate(options: CheckUpdateOptions): Promise<UpdateInfo | null> {
  // 正在下载时不允许检查更新
  if (isDownloading) {
    log.info('正在下载更新，跳过检查更新');
    return null;
  }
  
  const { resourceId, currentVersion, cdk, channel = 'stable', userAgent = 'MXU' } = options;
  
  if (!resourceId) {
    log.warn('未配置 mirrorchyan_rid，跳过更新检查');
    return null;
  }
  
  const params = new URLSearchParams();
  params.set('current_version', currentVersion);
  params.set('user_agent', userAgent);
  params.set('channel', channel);
  
  // 添加系统信息
  const os = getOS();
  const arch = getArch();
  if (os) params.set('os', os);
  if (arch) params.set('arch', arch);
  
  // CDK 是可选的，无 CDK 时也可以检查版本（但无法获取下载链接）
  if (cdk) {
    params.set('cdk', cdk);
  }
  
  log.info(`检查更新: ${resourceId}, 当前版本: ${currentVersion}, 频道: ${channel}`);
  
  let data: MirrorChyanApiResponse | null = null;
  let lastError: unknown = null;
  
  // 依次尝试主站和备用站
  for (let i = 0; i < MIRRORCHYAN_API_BASES.length; i++) {
    const apiBase = MIRRORCHYAN_API_BASES[i];
    try {
      data = await fetchUpdateFromBase(apiBase, resourceId, params);
      // 请求成功且 code 为 0，直接使用结果
      if (data.code === 0) {
        break;
      }
      // code 非 0 视为 API 层面的错误，尝试备用站
      log.warn(`${apiBase} 返回错误: code=${data.code}, msg=${data.msg}，尝试备用站...`);
      lastError = new Error(`API error: code=${data.code}, msg=${data.msg}`);
    } catch (error) {
      log.warn(`${apiBase} 请求失败:`, error);
      lastError = error;
      // 网络错误，继续尝试备用站
    }
  }
  
  // 所有站点都失败
  if (!data || data.code !== 0) {
    if (data && data.code !== 0) {
      log.warn(`更新检查返回错误: code=${data.code}, msg=${data.msg}`);
      // code 非 0 但仍可能有版本信息，同时返回错误码
      if (data.data?.version_name) {
        return {
          hasUpdate: false,
          versionName: data.data.version_name,
          releaseNote: data.data.release_note || '',
          channel: data.data.channel,
          errorCode: data.code,
          errorMessage: data.msg,
        };
      }
      // 没有版本信息但有错误码，仍然返回错误信息
      return {
        hasUpdate: false,
        versionName: '',
        releaseNote: '',
        errorCode: data.code,
        errorMessage: data.msg,
      };
    } else {
      log.error('检查更新失败:', lastError);
    }
    return null;
  }
  
  if (!data.data) {
    log.warn('更新检查响应缺少 data 字段');
    return null;
  }
  
  const { version_name, url: downloadUrl, release_note, update_type, channel: respChannel, filesize } = data.data;
  
  // 比较版本号判断是否有更新
  const hasUpdate = compareVersions(version_name, currentVersion) > 0;
  
  log.info(`更新检查完成: 最新版本=${version_name}, 有更新=${hasUpdate}`);
  
  return {
    hasUpdate,
    versionName: version_name,
    releaseNote: release_note || '',
    downloadUrl,
    updateType: update_type,
    channel: respChannel,
    fileSize: filesize,
    downloadSource: downloadUrl ? 'mirrorchyan' : undefined,
  };
}

/**
 * 比较版本号
 * @returns 正数表示 v1 > v2，负数表示 v1 < v2，0 表示相等
 */
function compareVersions(v1: string, v2: string): number {
  // 移除 v 前缀
  const normalize = (v: string) => v.replace(/^v/i, '');
  
  const parts1 = normalize(v1).split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = normalize(v2).split('.').map(p => parseInt(p, 10) || 0);
  
  const maxLen = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) return p1 - p2;
  }
  
  return 0;
}

/**
 * 打开 MirrorChyan 网站（带来源参数和版本号）
 * 使用系统默认浏览器打开
 */
export function openMirrorChyanWebsite(source?: string) {
  let url = 'https://mirrorchyan.com';
  if (source) {
    const version = typeof __MXU_VERSION__ !== 'undefined' ? __MXU_VERSION__ : '';
    const sourceWithVersion = version ? `${source}@${version}` : source;
    url += `?source=${encodeURIComponent(sourceWithVersion)}`;
  }
  openUrl(url).catch((err) => {
    log.error('Failed to open URL:', err);
  });
}

/**
 * 从 GitHub URL 提取 owner 和 repo
 * 支持格式: https://github.com/owner/repo 或 https://github.com/owner/repo.git
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * 获取 GitHub 最新 Release
 */
async function getGitHubLatestRelease(owner: string, repo: string, prerelease = false): Promise<GitHubRelease | null> {
  try {
    // 如果需要预发布版本，需要获取所有 releases 然后找最新的
    const url = prerelease
      ? `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`
      : `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`;
    
    const response = await tauriFetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': buildUserAgent(),
      },
    });
    
    if (!response.ok) {
      log.warn(`GitHub API 返回错误: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (prerelease && Array.isArray(data)) {
      // 找到最新的 release（包括预发布）
      return data[0] || null;
    }
    
    return data as GitHubRelease;
  } catch (error) {
    log.error('获取 GitHub Release 失败:', error);
    return null;
  }
}

/**
 * 根据 OS 和架构匹配合适的 GitHub Asset
 * 优先匹配 OS + 架构，多个匹配时优先选择名字带 mxu 的，否则选体积最大的
 */
function matchGitHubAsset(assets: GitHubAsset[]): GitHubAsset | null {
  const osAliases = getOSAliases();
  const archAliases = getArchAliases();
  
  // 先找出所有匹配 OS + 架构的 assets
  const candidates: GitHubAsset[] = [];
  
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    
    // 检查 OS 匹配
    const osMatch = osAliases.some(alias => name.includes(alias.toLowerCase()));
    if (!osMatch) continue;
    
    // 检查架构匹配
    const archMatch = archAliases.some(alias => name.includes(alias.toLowerCase()));
    if (!archMatch) continue;
    
    candidates.push(asset);
  }
  
  if (candidates.length === 0) {
    return null;
  }
  
  // 如果只有一个匹配，直接返回
  if (candidates.length === 1) {
    return candidates[0];
  }
  
  // 多个匹配时，优先选择名字带 "mxu" 的
  const mxuCandidate = candidates.find(asset => 
    asset.name.toLowerCase().includes('-mxu')
  );
  if (mxuCandidate) {
    log.info(`多个匹配，选择带 mxu 的文件: ${mxuCandidate.name}`);
    return mxuCandidate;
  }
  
  // 没有 mxu 的，选择体积最大的
  const largest = candidates.reduce((max, asset) => 
    asset.size > max.size ? asset : max
  );
  log.info(`多个匹配，选择体积最大的文件: ${largest.name} (${largest.size} bytes)`);
  return largest;
}

export interface GetGitHubDownloadUrlOptions {
  githubUrl: string;
  channel?: UpdateChannel;
}

/**
 * 获取 GitHub 下载链接
 * @returns 下载链接和文件大小，或 null（失败时）
 */
export async function getGitHubDownloadUrl(options: GetGitHubDownloadUrlOptions): Promise<{ url: string; size: number; filename: string } | null> {
  const { githubUrl, channel = 'stable' } = options;
  
  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed) {
    log.warn('无法解析 GitHub URL:', githubUrl);
    return null;
  }
  
  const { owner, repo } = parsed;
  const prerelease = channel !== 'stable';
  
  const release = await getGitHubLatestRelease(owner, repo, prerelease);
  if (!release) {
    log.warn('未找到 GitHub Release');
    return null;
  }
  
  const asset = matchGitHubAsset(release.assets);
  if (!asset) {
    log.warn('未找到匹配当前系统的下载文件');
    return null;
  }
  
  log.info(`匹配到 GitHub 下载文件: ${asset.name}`);
  
  return {
    url: asset.browser_download_url,
    size: asset.size,
    filename: asset.name,
  };
}

export interface DownloadUpdateOptions {
  url: string;
  savePath: string;
  totalSize?: number;
  onProgress?: (progress: DownloadProgress) => void;
}

// 当前下载的保存路径，用于取消时清理临时文件
let currentDownloadPath: string | null = null;

/**
 * 下载更新包（使用 Rust 后端流式下载）
 * 
 * 相比 JavaScript 下载，Rust 后端实现具有以下优势：
 * - 流式写入磁盘，不占用大量内存
 * - 更高的下载速度（直接写入文件，无需 JS 中转）
 * - 更稳定的大文件下载支持
 * 
 * @returns 是否下载成功
 */
export async function downloadUpdate(options: DownloadUpdateOptions): Promise<boolean> {
  // 已经在下载中，不允许重复下载
  if (isDownloading) {
    log.info('已有下载任务进行中，跳过本次下载请求');
    return false;
  }
  
  const { url, savePath, totalSize, onProgress } = options;
  
  log.info(`开始下载更新: ${url}`);
  log.info(`保存路径: ${savePath}`);
  
  isDownloading = true;
  currentDownloadPath = savePath;
  
  // 设置进度监听器
  let unlisten: (() => void) | null = null;
  
  try {
    // 监听 Rust 后端发送的下载进度事件
    if (onProgress) {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<DownloadProgress>('download-progress', (event) => {
        onProgress({
          downloadedSize: event.payload.downloadedSize,
          totalSize: event.payload.totalSize,
          speed: event.payload.speed,
          progress: event.payload.progress,
        });
      });
    }
    
    // 调用 Rust 后端进行流式下载
    const result = await invoke<boolean>('download_file', {
      url,
      savePath,
      totalSize: totalSize || null,
    });
    
    if (result) {
      log.info('下载完成');
    }
    
    return result;
  } catch (error) {
    log.error('下载失败:', error);
    return false;
  } finally {
    // 清理事件监听器
    if (unlisten) {
      unlisten();
    }
    isDownloading = false;
    currentDownloadPath = null;
  }
}

export interface CheckAndDownloadOptions extends CheckUpdateOptions {
  githubUrl?: string;
  basePath: string;
}

/**
 * 检查更新并获取下载信息
 * 始终使用 Mirror酱 检查更新，根据是否有 CDK 决定下载来源
 */
export async function checkAndPrepareDownload(options: CheckAndDownloadOptions): Promise<UpdateInfo | null> {
  // 正在下载时不允许检查更新
  if (isDownloading) {
    log.info('正在下载更新，跳过检查更新');
    return null;
  }
  
  const { githubUrl, basePath, cdk, channel, ...checkOptions } = options;
  
  // 始终使用 Mirror酱 检查更新
  const updateInfo = await checkUpdate({ ...checkOptions, cdk, channel });
  
  if (!updateInfo || !updateInfo.hasUpdate) {
    return updateInfo;
  }
  
  // 如果有 CDK 且返回了下载链接，直接使用
  if (cdk && updateInfo.downloadUrl) {
    log.info('使用 Mirror酱 下载链接');
    return updateInfo;
  }
  
  // 没有 CDK 或没有下载链接，尝试使用 GitHub
  if (githubUrl) {
    log.info('无 CDK 或无下载链接，尝试使用 GitHub 下载');
    const githubDownload = await getGitHubDownloadUrl({ githubUrl, channel });
    
    if (githubDownload) {
      return {
        ...updateInfo,
        downloadUrl: githubDownload.url,
        fileSize: githubDownload.size,
        filename: githubDownload.filename,
        downloadSource: 'github',
      };
    }
    
    log.warn('GitHub 下载链接获取失败');
  }
  
  // 既没有 Mirror酱 链接也没有 GitHub 链接
  return updateInfo;
}

/**
 * 获取更新包保存路径
 */
export async function getUpdateSavePath(basePath: string, filename?: string): Promise<string> {
  const os = getOS();
  const ext = os === 'windows' ? '.zip' : '.tar.gz';
  const name = filename || `update${ext}`;
  return await join(basePath, 'cache', name);
}

// ============================================================================
// 更新安装相关
// ============================================================================

// changes.json 结构（增量包标识）
interface ChangesJson {
  added: string[];
  deleted: string[];
  modified: string[];
}

export interface InstallUpdateOptions {
  zipPath: string;      // 下载的更新包路径
  targetDir: string;    // 目标安装目录
  onProgress?: (stage: string, detail?: string) => void;
}

/**
 * 安装更新包
 * 1. 解压更新包
 * 2. 检查是否为增量包（存在 changes.json）
 * 3. 增量包：删除 deleted 文件，复制覆盖
 * 4. 全量包：删除同名文件夹，复制覆盖
 * 5. 清理临时文件
 */
export async function installUpdate(options: InstallUpdateOptions): Promise<boolean> {
  const { zipPath, targetDir, onProgress } = options;
  
  log.info(`开始安装更新: ${zipPath} -> ${targetDir}`);
  
  // 生成临时解压目录
  const extractDir = await join(await dirname(zipPath), 'update_extract');
  
  try {
    // 1. 解压更新包
    onProgress?.('extracting', zipPath);
    log.info(`解压更新包到: ${extractDir}`);
    
    await invoke('extract_zip', {
      zipPath,
      destDir: extractDir,
    });
    
    // 2. 检查是否为增量包
    onProgress?.('checking', 'changes.json');
    log.info('检查更新包类型...');
    
    const changesJson = await invoke<ChangesJson | null>('check_changes_json', {
      extractDir,
    });
    
    if (changesJson) {
      // 增量更新
      log.info(`增量更新: deleted=${changesJson.deleted.length}, added=${changesJson.added.length}, modified=${changesJson.modified.length}`);
      onProgress?.('applying', 'incremental');
      
      await invoke('apply_incremental_update', {
        extractDir,
        targetDir,
        deletedFiles: changesJson.deleted,
      });
    } else {
      // 全量更新
      log.info('全量更新');
      onProgress?.('applying', 'full');
      
      await invoke('apply_full_update', {
        extractDir,
        targetDir,
      });
    }
    
    // 3. 清理临时文件
    onProgress?.('cleanup');
    log.info('清理临时文件...');
    
    await invoke('cleanup_extract_dir', { extractDir });
    
    // 将下载的 zip 文件移动到 old 文件夹
    await moveToOldFolder(zipPath);
    
    log.info('更新安装完成');
    onProgress?.('done');
    
    return true;
  } catch (error) {
    log.error('更新安装失败:', error);
    
    // 尝试清理临时目录
    await invoke('cleanup_extract_dir', { extractDir }).catch(() => {});
    
    throw error;
  }
}

// 更新完成信息存储 key
const UPDATE_COMPLETE_STORAGE_KEY = 'mxu-update-complete';
// 待安装更新信息存储 key
const PENDING_UPDATE_STORAGE_KEY = 'mxu-pending-update';

/**
 * 更新完成后的信息（用于重启后显示）
 */
export interface UpdateCompleteInfo {
  previousVersion: string;
  newVersion: string;
  releaseNote: string;
  channel?: string;
  timestamp: number;
}

/**
 * 待安装的更新信息（下载完成后保存，用于下次启动时自动安装）
 */
export interface PendingUpdateInfo {
  versionName: string;
  releaseNote: string;
  channel?: string;
  downloadSavePath: string;
  fileSize?: number;
  updateType?: 'incremental' | 'full';
  downloadSource?: 'mirrorchyan' | 'github';
  timestamp: number;
}

/**
 * 保存更新完成信息到本地存储
 */
export function saveUpdateCompleteInfo(info: UpdateCompleteInfo): void {
  try {
    localStorage.setItem(UPDATE_COMPLETE_STORAGE_KEY, JSON.stringify(info));
    log.info('已保存更新完成信息');
  } catch (error) {
    log.warn('保存更新完成信息失败:', error);
  }
}

/**
 * 读取并清除更新完成信息
 */
export function consumeUpdateCompleteInfo(): UpdateCompleteInfo | null {
  try {
    const data = localStorage.getItem(UPDATE_COMPLETE_STORAGE_KEY);
    if (!data) return null;
    
    // 读取后立即清除
    localStorage.removeItem(UPDATE_COMPLETE_STORAGE_KEY);
    
    const info = JSON.parse(data) as UpdateCompleteInfo;
    log.info('已读取更新完成信息:', info.newVersion);
    return info;
  } catch (error) {
    log.warn('读取更新完成信息失败:', error);
    localStorage.removeItem(UPDATE_COMPLETE_STORAGE_KEY);
    return null;
  }
}

/**
 * 保存待安装更新信息到本地存储（下载完成后调用）
 */
export function savePendingUpdateInfo(info: PendingUpdateInfo): void {
  try {
    localStorage.setItem(PENDING_UPDATE_STORAGE_KEY, JSON.stringify(info));
    log.info('已保存待安装更新信息:', info.versionName);
  } catch (error) {
    log.warn('保存待安装更新信息失败:', error);
  }
}

/**
 * 读取待安装更新信息（不自动清除，需要手动调用 clearPendingUpdateInfo）
 */
export function getPendingUpdateInfo(): PendingUpdateInfo | null {
  try {
    const data = localStorage.getItem(PENDING_UPDATE_STORAGE_KEY);
    if (!data) return null;
    
    const info = JSON.parse(data) as PendingUpdateInfo;
    log.info('检测到待安装更新:', info.versionName);
    return info;
  } catch (error) {
    log.warn('读取待安装更新信息失败:', error);
    localStorage.removeItem(PENDING_UPDATE_STORAGE_KEY);
    return null;
  }
}

/**
 * 清除待安装更新信息（安装完成或用户取消后调用）
 */
export function clearPendingUpdateInfo(): void {
  try {
    localStorage.removeItem(PENDING_UPDATE_STORAGE_KEY);
    log.info('已清除待安装更新信息');
  } catch (error) {
    log.warn('清除待安装更新信息失败:', error);
  }
}

/**
 * 重启应用
 * 使用 Tauri 的 relaunch API 重启应用
 */
export async function restartApp(): Promise<void> {
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error) {
    log.error('重启应用失败:', error);
    throw error;
  }
}
