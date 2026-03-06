import { maaService } from '@/services/maaService';
import { loggers } from '@/utils/logger';

const log = loggers.maa;

// 回调结果类型
export type CallbackResult = 'succeeded' | 'failed';

// 控制器连接结果缓存
const ctrlCallbackCache = new Map<number, CallbackResult>();
// 资源加载结果缓存
const resCallbackCache = new Map<number, CallbackResult>();
// 任务执行结果缓存
const taskCallbackCache = new Map<number, CallbackResult>();

// 等待中的任务结果订阅者
const taskResultWaiters = new Map<number, Set<(result: CallbackResult) => void>>();

// 缓存清理超时时间（30秒）
const CACHE_CLEANUP_TIMEOUT = 30000;

// 全局监听器是否已启动
let globalListenerStarted = false;
let globalListenerPromise: Promise<void> | null = null;

// 记录每个实例是否已尝试过自动重连
export const autoReconnectAttempted = new Set<string>();

/**
 * 启动全局回调监听器（只启动一次）
 */
export function startGlobalCallbackListener(): Promise<void> {
  if (globalListenerStarted) {
    return Promise.resolve();
  }

  if (globalListenerPromise) {
    return globalListenerPromise;
  }

  globalListenerPromise = maaService
    .onCallback((message, details) => {
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

      // 缓存任务执行结果，并通知等待中的监视器
      if (details.task_id !== undefined) {
        let result: CallbackResult | null = null;

        if (message === 'Tasker.Task.Succeeded') {
          result = 'succeeded';
        } else if (message === 'Tasker.Task.Failed') {
          result = 'failed';
        }

        if (result) {
          taskCallbackCache.set(details.task_id, result);
          setTimeout(() => taskCallbackCache.delete(details.task_id!), CACHE_CLEANUP_TIMEOUT);

          const waiters = taskResultWaiters.get(details.task_id);
          if (waiters) {
            waiters.forEach((resolve) => resolve(result!));
            taskResultWaiters.delete(details.task_id);
          }
        }
      }
    })
    .then(() => {
      globalListenerStarted = true;
    })
    .catch((error) => {
      log.error('Failed to start global callback listener:', error);
      throw error;
    })
    .finally(() => {
      globalListenerPromise = null;
    });

  return globalListenerPromise;
}

/**
 * 等待控制器连接结果（先查缓存，没有则等待回调）
 */
export async function waitForCtrlResult(
  ctrlId: number,
  timeoutMs: number = 30000,
): Promise<CallbackResult> {
  void startGlobalCallbackListener().catch(() => {});

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
  void startGlobalCallbackListener().catch(() => {});

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

export class TaskResultWaitAbortedError extends Error {
  constructor() {
    super('Task result wait aborted');
    this.name = 'TaskResultWaitAbortedError';
  }
}

export class TaskResultWaitTimeoutError extends Error {
  taskId: number;
  timeoutMs: number;

  constructor(taskId: number, timeoutMs: number) {
    super(`Task result wait timed out: task_id=${taskId}, timeout=${timeoutMs}ms`);
    this.name = 'TaskResultWaitTimeoutError';
    this.taskId = taskId;
    this.timeoutMs = timeoutMs;
  }
}

function createAbortError() {
  return new TaskResultWaitAbortedError();
}

function createTimeoutError(taskId: number, timeoutMs: number) {
  return new TaskResultWaitTimeoutError(taskId, timeoutMs);
}

/**
 * 等待任务执行结果（先查缓存，没有则等待回调）。
 * 超时会抛出 TaskResultWaitTimeoutError，便于调用方与真实失败区分。
 */
export async function waitForTaskResult(
  taskId: number,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<CallbackResult> {
  void startGlobalCallbackListener().catch(() => {});

  const cached = taskCallbackCache.get(taskId);
  if (cached) {
    taskCallbackCache.delete(taskId);
    return cached;
  }

  const { timeoutMs, signal } = options || {};

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      const waiters = taskResultWaiters.get(taskId);
      if (waiters) {
        waiters.delete(handleResult);
        if (waiters.size === 0) {
          taskResultWaiters.delete(taskId);
        }
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      signal?.removeEventListener('abort', handleAbort);
    };

    const handleResult = (result: CallbackResult) => {
      cleanup();
      taskCallbackCache.delete(taskId);
      resolve(result);
    };

    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const waiters = taskResultWaiters.get(taskId) || new Set<(result: CallbackResult) => void>();
    waiters.add(handleResult);
    taskResultWaiters.set(taskId, waiters);

    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(createTimeoutError(taskId, timeoutMs));
      }, timeoutMs);
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}
