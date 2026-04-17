import { loggers } from '@/utils/logger';
import { isTauri } from '@/utils/paths';
import type { SelectedTask } from '@/types/interface';
import { isMxuKillProcSelfMode } from '@/types/specialTasks';

const log = loggers.task;

const exitAfterQueueSettled = new Set<string>();

export function scheduleExitAfterTaskQueueSettled(instanceId: string) {
  exitAfterQueueSettled.add(instanceId);
}

export function clearExitAfterTaskQueueSettled(instanceId: string) {
  exitAfterQueueSettled.delete(instanceId);
}

export function consumeExitAfterTaskQueueSettled(instanceId: string): boolean {
  const scheduled = exitAfterQueueSettled.has(instanceId);
  if (scheduled) {
    exitAfterQueueSettled.delete(instanceId);
  }
  return scheduled;
}

export interface SelfClosingTaskSplit {
  tasksToRun: SelectedTask[];
  shouldExitAfterQueue: boolean;
}

/**
 * 从启用的任务列表中分离出"关闭自身"任务。
 * 关闭自身任务及其之后的所有任务不会提交给 MaaFramework，
 * 而是由前端在队列结束后直接执行退出。
 */
export function splitSelfClosingTasks(enabledTasks: SelectedTask[]): SelfClosingTaskSplit {
  const selfIndex = enabledTasks.findIndex((task) => isMxuKillProcSelfMode(task));
  if (selfIndex < 0) {
    return { tasksToRun: enabledTasks, shouldExitAfterQueue: false };
  }

  const droppedCount = enabledTasks.length - selfIndex - 1;
  if (droppedCount > 0) {
    log.warn(
      `"关闭自身"任务之后还有 ${droppedCount} 个任务，这些任务将不会执行`,
    );
  }

  return {
    tasksToRun: enabledTasks.slice(0, selfIndex),
    shouldExitAfterQueue: true,
  };
}

export async function exitAppDirectly(): Promise<boolean> {
  if (!isTauri()) {
    log.warn('非 Tauri 环境，无法执行关闭自身');
    return false;
  }

  try {
    const { exit } = await import('@tauri-apps/plugin-process');
    await exit(0);
    return true;
  } catch (error) {
    log.error('前端执行关闭自身失败:', error);
    return false;
  }
}
