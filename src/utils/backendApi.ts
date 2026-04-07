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
  if (backendPort) {
    return `http://${window.location.hostname}:${backendPort}/api`;
  }
  return '/api';
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
  return resp.json() as Promise<T>;
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
  return resp.json() as Promise<T>;
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
  return resp.json() as Promise<T>;
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
