// 代理服务模块
// 提供代理验证、解析和统一的下载接口

import type { ProxySettings } from '@/types/config';
import { invoke } from '@tauri-apps/api/core';
import { loggers } from '@/utils/logger';

const log = loggers.app;

type ProxyType = 'http' | 'socks5';

/**
 * 代理 URL 正则表达式
 * 支持格式：
 * - http://host:port
 * - http://user:pass@host:port
 * - socks5://host:port
 * - socks5://user:pass@host:port
 *
 * 改进点：
 * - 用户名/密码使用 URL 安全字符集
 * - 主机名符合 RFC 规范（不允许开头/结尾为 -）
 * - 支持 IPv6 地址
 */
const PROXY_URL_REGEX =
  /^(http|socks5):\/\/(?:([a-zA-Z0-9._~!$&'()*+,;=-]+):([a-zA-Z0-9._~!$&'()*+,;=:-]+)@)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*|\[[\da-fA-F:]+\]):(\d{1,5})$/;

/**
 * 验证代理 URL 格式
 * @param url 代理 URL
 * @returns 是否有效
 */
export function isValidProxyUrl(url: string): boolean {
  if (!url || url.trim() === '') {
    return false;
  }

  const match = url.trim().match(PROXY_URL_REGEX);
  if (!match) {
    return false;
  }

  const port = parseInt(match[8], 10);
  return port > 0 && port <= 65535;
}

/**
 * 解析代理 URL
 * @param url 代理 URL
 * @returns 解析后的代理信息，如果无效则返回 null
 */
export function parseProxyUrl(url: string): {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
} | null {
  if (!url || url.trim() === '') {
    return null;
  }

  const match = url.trim().match(PROXY_URL_REGEX);
  if (!match) {
    return null;
  }

  const [, type, username, password, host, , , , portStr] = match;
  const port = parseInt(portStr, 10);

  if (port <= 0 || port > 65535) {
    return null;
  }

  return {
    type: type as ProxyType,
    host,
    port,
    username: username || undefined,
    password: password || undefined,
  };
}

/**
 * 创建代理设置对象（优化为单次解析）
 * @param url 代理 URL
 * @returns 代理设置对象，如果无效则返回 undefined
 */
export function createProxySettings(url: string): ProxySettings | undefined {
  const parsed = parseProxyUrl(url);
  if (!parsed) {
    return undefined;
  }

  const { type, host, port, username, password } = parsed;
  const auth = username && password ? `${username}:${password}@` : '';
  const normalized = `${type}://${auth}${host}:${port}`;

  return {
    url: normalized,
  };
}

/**
 * 检查是否应该使用代理（简化版）
 * @param proxySettings 代理设置
 * @param mirrorChyanCdk MirrorChyan CDK
 * @returns 是否应该使用代理
 */
export function shouldUseProxy(
  proxySettings: ProxySettings | undefined,
  mirrorChyanCdk: string,
): boolean {
  return (
    !mirrorChyanCdk?.trim() && !!proxySettings?.url?.trim() && isValidProxyUrl(proxySettings.url)
  );
}

/**
 * 格式化代理 URL 用于显示（隐藏密码）
 * @param url 代理 URL
 * @returns 格式化后的 URL
 */
export function formatProxyUrlForDisplay(url: string): string {
  const parsed = parseProxyUrl(url);
  if (!parsed) {
    return url;
  }

  const { type, host, port, username } = parsed;
  const auth = username ? `${username}:****@` : '';
  return `${type}://${auth}${host}:${port}`;
}

/**
 * 统一的带代理下载接口
 * 自动处理代理参数并记录日志
 *
 * @param url 下载 URL
 * @param savePath 保存路径
 * @param options 可选参数
 * @returns Session ID
 */
export async function downloadWithProxy(
  url: string,
  savePath: string,
  options?: {
    totalSize?: number;
    proxyUrl?: string | null;
  },
): Promise<number> {
  const hasProxy = options?.proxyUrl && options.proxyUrl.trim() !== '';

  if (hasProxy) {
    const parsed = parseProxyUrl(options.proxyUrl!);
    if (parsed) {
      log.info(`[下载] 使用代理: ${parsed.type}://${parsed.host}:${parsed.port}`);
      log.info(`[下载] 目标: ${url}`);
    }
  } else {
    log.info(`[下载] 直连（无代理）: ${url}`);
  }

  return invoke<number>('download_file', {
    url,
    savePath,
    totalSize: options?.totalSize || null,
    proxyUrl: options?.proxyUrl || null,
  });
}
