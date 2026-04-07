/**
 * 后端状态桥接模块
 * - 将前端 UI 日志转发到后端 stdout，便于终端调试和第三方调度工具读取
 * - 将运行日志推送到后端缓冲区，支持跨页面刷新持久化
 * - 将任务运行状态同步到后端，支持跨页面刷新持久化
 */

import { isTauri } from '@/utils/paths';
import { apiDelete, apiGet, apiPost, apiPut } from '@/utils/backendApi';

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

export interface LogEntryDto {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  html?: string;
}

/** 将一条运行日志推送到后端缓冲区（fire-and-forget） */
export function pushLogToBackend(instanceId: string, entry: LogEntryDto) {
  getInvoke().then((inv) => {
    if (inv) {
      inv('push_log', { instanceId, entry }).catch(() => {});
    } else {
      apiPost(`/logs/${instanceId}`, entry).catch(() => {});
    }
  });
}

/** 获取后端缓冲区中所有实例的运行日志 */
export async function getAllLogsFromBackend(): Promise<Record<string, LogEntryDto[]>> {
  const inv = await getInvoke();
  if (inv) {
    return (await inv('get_all_logs')) as Record<string, LogEntryDto[]>;
  }
  return apiGet<Record<string, LogEntryDto[]>>('/logs');
}

/** 清空后端缓冲区中指定实例的运行日志（fire-and-forget） */
export function clearLogsOnBackend(instanceId: string) {
  getInvoke().then((inv) => {
    if (inv) {
      inv('clear_instance_logs', { instanceId }).catch(() => {});
    } else {
      apiDelete(`/logs/${instanceId}`).catch(() => {});
    }
  });
}

// ============================================================================
// 任务运行状态同步
// ============================================================================

export interface InstanceTaskRunSnapshot {
  statuses: Record<string, string>;
  mappings: Record<string, string>; // Rust 端 key 是 i64, JSON 序列化为字符串 key
}

/** 将指定实例的任务运行状态快照同步到后端（fire-and-forget） */
export function syncTaskRunStatusToBackend(instanceId: string, snapshot: InstanceTaskRunSnapshot) {
  getInvoke().then((inv) => {
    if (inv) {
      inv('sync_task_run_status', { instanceId, snapshot }).catch(() => {});
    } else {
      apiPut(`/task-status/${instanceId}`, snapshot).catch(() => {});
    }
  });
}

/** 获取后端所有实例的任务运行状态快照 */
export async function getAllTaskRunStatusFromBackend(): Promise<
  Record<string, InstanceTaskRunSnapshot>
> {
  const inv = await getInvoke();
  if (inv) {
    return (await inv('get_all_task_run_status')) as Record<string, InstanceTaskRunSnapshot>;
  }
  return apiGet<Record<string, InstanceTaskRunSnapshot>>('/task-status');
}

/** 清空后端指定实例的任务运行状态（fire-and-forget） */
export function clearTaskRunStatusOnBackend(instanceId: string) {
  getInvoke().then((inv) => {
    if (inv) {
      inv('clear_task_run_status_backend', { instanceId }).catch(() => {});
    } else {
      apiDelete(`/task-status/${instanceId}`).catch(() => {});
    }
  });
}
