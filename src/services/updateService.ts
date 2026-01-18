// MirrorChyan 更新检查服务
// API 文档: https://github.com/MirrorChyan/docs

import type { UpdateChannel } from '@/types/config';
import type { UpdateInfo } from '@/stores/appStore';
import { loggers } from '@/utils/logger';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const log = loggers.app;

const MIRRORCHYAN_API_BASE = 'https://mirrorchyan.com/api/resources';

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

// 获取操作系统类型
function getOS(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  return '';
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
 * 检查更新
 * @returns UpdateInfo 或 null（检查失败时）
 */
export async function checkUpdate(options: CheckUpdateOptions): Promise<UpdateInfo | null> {
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
  
  const url = `${MIRRORCHYAN_API_BASE}/${resourceId}/latest?${params.toString()}`;
  
  log.info(`检查更新: ${resourceId}, 当前版本: ${currentVersion}, 频道: ${channel}`);
  
  try {
    // 使用 Tauri HTTP 客户端发送请求，绑过浏览器 CORS 限制
    const response = await tauriFetch(url);
    const data: MirrorChyanApiResponse = await response.json();
    
    if (data.code !== 0) {
      log.warn(`更新检查返回错误: code=${data.code}, msg=${data.msg}`);
      // code 非 0 但仍可能有版本信息
      if (data.data?.version_name) {
        return {
          hasUpdate: false,
          versionName: data.data.version_name,
          releaseNote: data.data.release_note || '',
          channel: data.data.channel,
        };
      }
      return null;
    }
    
    if (!data.data) {
      log.warn('更新检查响应缺少 data 字段');
      return null;
    }
    
    const { version_name, url: downloadUrl, release_note, update_type, channel: respChannel } = data.data;
    
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
    };
  } catch (error) {
    log.error('检查更新失败:', error);
    return null;
  }
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
 */
export function openMirrorChyanWebsite(source?: string) {
  let url = 'https://mirrorchyan.com';
  if (source) {
    const version = typeof __MXU_VERSION__ !== 'undefined' ? __MXU_VERSION__ : '';
    const sourceWithVersion = version ? `${source}@${version}` : source;
    url += `?source=${encodeURIComponent(sourceWithVersion)}`;
  }
  window.open(url, '_blank');
}
