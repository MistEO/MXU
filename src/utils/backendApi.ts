/**
 * 后端 HTTP API 工具
 *
 * 浏览器环境下（非 Tauri）通过此模块调用 axum HTTP 服务器 API。
 * Tauri 环境下直接使用 invoke，不经过此模块。
 *
 * 默认走 Vite proxy（`/api`），调用 setBackendPort 后切换为直连后端。
 */

/** 后端实际端口（0 = 未设置，走相对路径/Vite proxy） */
let backendPort = 0;

/** 设置后端直连端口（从 /api/interface 的 webServerPort 获取） */
export function setBackendPort(port: number): void {
  backendPort = port;
}

export function getApiBase(): string {
  // 已探测到后端直连端口：优先使用绝对 URL。
  // 这是 tauri 生产模式的关键路径 —— tauri://localhost 下相对路径 /api 会 404
  // （tauri 不代理 /api 到后端端口），只有浏览器 dev 模式（Vite proxy）相对路径才可用。
  if (backendPort > 0) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || '127.0.0.1';
    return `${protocol}//${hostname}:${backendPort}/api`;
  }

  // 浏览器 dev 模式 / 远程访问：通过代理相对路径或直连
  if (window.location.host) {
    // dev 模式（Vite proxy）或后端已在同源反代下
    return '/api';
  }

  // Fallback：直连后端（file:// 或未设置 host）
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const hostname = window.location.hostname || '127.0.0.1';
  const port = backendPort || 12701;
  return `${protocol}//${hostname}:${port}/api`;
}

/** 安全解析 JSON 响应，204 / 空 body 时返回 undefined */
async function parseJsonSafe<T>(resp: Response): Promise<T> {
  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * 向后端 HTTP API 发送 GET 请求
 */
export async function apiGet<T>(path: string): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API GET ${path} failed (${resp.status}): ${text}`);
  }
  return parseJsonSafe<T>(resp);
}

/**
 * 向后端 HTTP API 发送 PUT 请求（含 JSON body）
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API PUT ${path} failed (${resp.status}): ${text}`);
  }
  return parseJsonSafe<T>(resp);
}

/**
 * 向后端 HTTP API 发送 POST 请求（含 JSON body）
 */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API POST ${path} failed (${resp.status}): ${text}`);
  }
  return parseJsonSafe<T>(resp);
}

/**
 * 向后端 HTTP API 发送 DELETE 请求
 */
export async function apiDelete(path: string): Promise<void> {
  const url = `${getApiBase()}${path}`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API DELETE ${path} failed (${resp.status}): ${text}`);
  }
}

/**
 * 检测后端 HTTP API 是否可用（axum server 是否在运行）
 */
export async function isBackendApiAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${getApiBase()}/interface`, { method: 'HEAD' });
    return resp.ok || resp.status === 405; // 405 = Method Not Allowed（只接受 GET）
  } catch {
    return false;
  }
}
