import { loggers } from '@/utils/logger';
import { isTauri } from '@/utils/paths';

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

export async function exitAppDirectly(): Promise<boolean> {
  if (!isTauri()) {
    return true;
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