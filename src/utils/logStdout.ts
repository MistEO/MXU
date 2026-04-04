/**
 * 日志 stdout 输出桥接模块
 * 将前端 UI 日志转发到后端 stdout，便于终端调试和第三方调度工具读取
 */

import { isTauri } from '@/utils/paths';

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let _invoke: InvokeFn | null = null;
let _initPromise: Promise<InvokeFn | null> | null = null;

async function getInvoke(): Promise<InvokeFn | null> {
  if (_invoke) return _invoke;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!isTauri()) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    _invoke = invoke;
    return _invoke;
  })();
  return _initPromise;
}

export function logToStdout(message: string) {
  if (!message) return;
  getInvoke().then((inv) => {
    if (inv) inv('log_to_stdout', { message }).catch(() => {});
  });
}
