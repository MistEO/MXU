import {
  TaskResultWaitAbortedError,
  TaskResultWaitTimeoutError,
  waitForTaskResult,
} from '@/components/connection/callbackCache';
import { useAppStore } from '@/stores/appStore';
import { normalizeAgentConfigs } from '@/types/interface';
import { loggers } from '@/utils/logger';

import { maaService } from './maaService';

const log = loggers.task;

const taskMonitorControllers = new Map<string, AbortController>();

function isAbortError(error: unknown): boolean {
  return error instanceof TaskResultWaitAbortedError;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof TaskResultWaitTimeoutError;
}

async function stopAgentIfNeeded(instanceId: string) {
  const agentConfigs = normalizeAgentConfigs(useAppStore.getState().projectInterface?.agent);
  if (!agentConfigs || agentConfigs.length === 0) {
    return;
  }

  try {
    await maaService.stopAgent(instanceId);
  } catch (error) {
    log.error(`[task-monitor#${instanceId}] 停止 Agent 失败:`, error);
  }
}

async function finalizeTaskRun(instanceId: string, status: 'Succeeded' | 'Failed') {
  await stopAgentIfNeeded(instanceId);

  const state = useAppStore.getState();
  state.setInstanceTaskStatus(instanceId, status);
  state.updateInstance(instanceId, { isRunning: false });
  state.setInstanceCurrentTaskId(instanceId, null);
  state.clearPendingTasks(instanceId);
  state.clearScheduleExecution(instanceId);
}

async function monitorTaskQueue(
  instanceId: string,
  taskIds: number[],
  controller: AbortController,
) {
  if (taskIds.length === 0) {
    log.error(`[task-monitor#${instanceId}] 后端未返回 task_id，终止本次运行`);
    taskMonitorControllers.delete(instanceId);
    await finalizeTaskRun(instanceId, 'Failed');
    return;
  }

  let hasFailed = false;

  for (const [index, taskId] of taskIds.entries()) {
    if (controller.signal.aborted || taskMonitorControllers.get(instanceId) !== controller) {
      return;
    }

    const state = useAppStore.getState();
    state.setCurrentTaskIndex(instanceId, index);
    state.setInstanceCurrentTaskId(instanceId, taskId);

    const selectedTaskId = state.findSelectedTaskIdByMaaTaskId(instanceId, taskId);
    if (selectedTaskId) {
      state.setTaskRunStatus(instanceId, selectedTaskId, 'running');
    }

    const result = await waitForTaskResult(taskId, { signal: controller.signal });

    if (controller.signal.aborted || taskMonitorControllers.get(instanceId) !== controller) {
      return;
    }

    const latestState = useAppStore.getState();
    const latestSelectedTaskId = latestState.findSelectedTaskIdByMaaTaskId(instanceId, taskId);
    if (latestSelectedTaskId) {
      latestState.setTaskRunStatus(
        instanceId,
        latestSelectedTaskId,
        result === 'succeeded' ? 'succeeded' : 'failed',
      );
    }

    if (result === 'failed') {
      hasFailed = true;
    }
  }

  if (taskMonitorControllers.get(instanceId) !== controller) {
    return;
  }

  taskMonitorControllers.delete(instanceId);
  await finalizeTaskRun(instanceId, hasFailed ? 'Failed' : 'Succeeded');
}

export function cancelTaskQueueMonitor(instanceId: string) {
  const controller = taskMonitorControllers.get(instanceId);
  if (!controller) {
    return;
  }

  controller.abort();
  taskMonitorControllers.delete(instanceId);
}

export function startTaskQueueMonitor(instanceId: string, taskIds: number[]) {
  cancelTaskQueueMonitor(instanceId);

  const controller = new AbortController();
  taskMonitorControllers.set(instanceId, controller);

  void monitorTaskQueue(instanceId, taskIds, controller).catch(async (error) => {
    if (isAbortError(error)) {
      return;
    }

    if (taskMonitorControllers.get(instanceId) === controller) {
      taskMonitorControllers.delete(instanceId);
      if (isTimeoutError(error)) {
        log.error(
          `[task-monitor#${instanceId}] 等待任务结果超时: task_id=${error.taskId}, timeout=${error.timeoutMs}ms`,
        );
      } else {
        log.error(`[task-monitor#${instanceId}] 监视任务队列失败:`, error);
      }
      await finalizeTaskRun(instanceId, 'Failed');
    }
  });
}
