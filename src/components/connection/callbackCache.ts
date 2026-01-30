import { maaService } from '@/services/maaService';

// 回调结果类型
export type CallbackResult = 'succeeded' | 'failed';

// 控制器连接结果缓存
const ctrlCallbackCache = new Map<number, CallbackResult>();
// 资源加载结果缓存
const resCallbackCache = new Map<number, CallbackResult>();

// 缓存清理超时时间（30秒）
const CACHE_CLEANUP_TIMEOUT = 30000;

// 全局监听器是否已启动
let globalListenerStarted = false;

// 记录每个实例是否已尝试过自动重连
export const autoReconnectAttempted = new Set<string>();

/**
 * 启动全局回调监听器（只启动一次）
 */
export function startGlobalCallbackListener() {
  if (globalListenerStarted) return;
  globalListenerStarted = true;

  maaService.onCallback((message, details) => {
    // 缓存控制器连接结果
    if (details.ctrl_id !== undefined) {
      if (message === 'Controller.Action.Succeeded') {
        ctrlCallbackCache.set(details.ctrl_id, 'succeeded');
        setTimeout(() => ctrlCallbackCache.delete(details.ctrl_id!), CACHE_CLEANUP_TIMEOUT);
      } else if (message === 'Controller.Action.Failed') {
        ctrlCallbackCache.set(details.ctrl_id, 'failed');
        setTimeout(() => ctrlCallbackCache.delete(details.ctrl_id!), CACHE_CLEANUP_TIMEOUT);
      }
    }

    // 缓存资源加载结果
    if (details.res_id !== undefined) {
      if (message === 'Resource.Loading.Succeeded') {
        resCallbackCache.set(details.res_id, 'succeeded');
        setTimeout(() => resCallbackCache.delete(details.res_id!), CACHE_CLEANUP_TIMEOUT);
      } else if (message === 'Resource.Loading.Failed') {
        resCallbackCache.set(details.res_id, 'failed');
        setTimeout(() => resCallbackCache.delete(details.res_id!), CACHE_CLEANUP_TIMEOUT);
      }
    }
  });
}

/**
 * 等待控制器连接结果（先查缓存，没有则等待回调）
 */
export async function waitForCtrlResult(
  ctrlId: number,
  timeoutMs: number = 30000,
): Promise<CallbackResult> {
  // 先检查缓存
  const cached = ctrlCallbackCache.get(ctrlId);
  if (cached) {
    ctrlCallbackCache.delete(ctrlId);
    return cached;
  }

  // 缓存中没有，等待回调
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      const result = ctrlCallbackCache.get(ctrlId);
      if (result) {
        clearInterval(checkInterval);
        ctrlCallbackCache.delete(ctrlId);
        resolve(result);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve('failed'); // 超时视为失败
      }
    }, 50);
  });
}

/**
 * 等待资源加载结果（先查缓存，没有则等待回调）
 */
export async function waitForResResult(
  resId: number,
  timeoutMs: number = 30000,
): Promise<CallbackResult> {
  // 先检查缓存
  const cached = resCallbackCache.get(resId);
  if (cached) {
    resCallbackCache.delete(resId);
    return cached;
  }

  // 缓存中没有，等待回调
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      const result = resCallbackCache.get(resId);
      if (result) {
        clearInterval(checkInterval);
        resCallbackCache.delete(resId);
        resolve(result);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve('failed');
      }
    }, 50);
  });
}
