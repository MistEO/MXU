/**
 * 日志 stdout 输出桥接模块
 * 用于 --log-stdout 下将日志从前端转发到后端 stdout
 */

import { isTauri } from '@/utils/paths';

// 缓存 invoke 函数和启用状态，避免每次调用都动态导入
let _logStdoutEnabled: boolean | null = null;
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
type InvokeFn = ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null;
let _initPromise: Promise<InvokeFn> | null = null;

async function getStdoutInvoke() {
  if (_logStdoutEnabled === false) return null;
  if (_invoke && _logStdoutEnabled === true) return _invoke;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!isTauri()) {
      _logStdoutEnabled = false;
      return null;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    _invoke = invoke;
    try {
      _logStdoutEnabled = await invoke<boolean>('is_log_stdout');
    } catch {
      _logStdoutEnabled = false;
    }
    return _logStdoutEnabled ? _invoke : null;
  })();
  return _initPromise;
}

export function isLogStdoutOff(): boolean {
  return _logStdoutEnabled === false;
}

export function logToStdout(message: string) {
  if (!message || _logStdoutEnabled === false) return;
  getStdoutInvoke().then((inv) => {
    if (inv) inv('log_to_stdout', { message }).catch(() => {});
  });
}
