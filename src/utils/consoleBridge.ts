/**
 * 共享的控制台日志桥接模块
 * 用于 --log-mode 下将日志从前端转发到后端 stdout
 */

import { isTauri } from '@/utils/paths';

export type ConsoleOutputMode = 'off' | 'ui' | 'verbose';

// 缓存 invoke 函数和启用状态，避免每次调用都动态导入
let _consoleEnabled: boolean | null = null;
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let _consoleOutputMode: ConsoleOutputMode | null = null;
type InvokeFn = ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null;
let _initPromise: Promise<InvokeFn> | null = null;

export async function getConsoleInvoke() {
  if (_consoleEnabled === false) return null;
  if (_invoke && _consoleEnabled === true) return _invoke;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!isTauri()) {
      _consoleEnabled = false;
      return null;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    _invoke = invoke;
    try {
      _consoleEnabled = await invoke<boolean>('is_console_enabled');
    } catch {
      _consoleEnabled = false;
    }
    return _consoleEnabled ? _invoke : null;
  })();
  return _initPromise;
}

export function isConsoleDefinitelyOff(): boolean {
  return _consoleEnabled === false;
}

export function consoleLog(message: string) {
  if (!message || _consoleEnabled === false) return;
  getConsoleInvoke().then((inv) => {
    if (inv) inv('console_log', { message }).catch(() => {});
  });
}

export async function getConsoleOutputMode(): Promise<ConsoleOutputMode> {
  if (_consoleOutputMode) return _consoleOutputMode;
  const inv = await getConsoleInvoke();
  if (!inv) {
    _consoleOutputMode = 'off';
    return _consoleOutputMode;
  }
  try {
    const mode = await inv('get_console_mode');
    _consoleOutputMode = mode === 'verbose' ? 'verbose' : 'ui';
  } catch {
    _consoleOutputMode = 'ui';
  }
  return _consoleOutputMode;
}
