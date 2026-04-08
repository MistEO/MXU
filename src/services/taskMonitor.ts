/**
 * 任务监视器（简化版）
 *
 * 任务状态追踪已迁移到 Rust 后端（通过 MaaFramework tasker sink 回调）。
 * 本模块仅保留 cancelTaskQueueMonitor，用于停止任务时清理可能存在的历史监视器。
 */

const taskMonitorControllers = new Map<string, AbortController>();

/** 取消指定实例的任务队列监视器（如有） */
export function cancelTaskQueueMonitor(instanceId: string) {
  const controller = taskMonitorControllers.get(instanceId);
  if (!controller) {
    return;
  }

  controller.abort();
  taskMonitorControllers.delete(instanceId);
}
