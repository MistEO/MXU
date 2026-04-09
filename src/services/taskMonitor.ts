import {
  TaskResultWaitAbortedError,
  TaskResultWaitTimeoutError,
  waitForTaskResult,
} from '@/components/connection/callbackCache';
import { useAppStore } from '@/stores/appStore';
import { normalizeAgentConfigs } from '@/types/interface';
import { loggers } from '@/utils/logger';

import { maaService } from './maaService';
import {
  clearExitAfterTaskQueueSettled,
  consumeExitAfterTaskQueueSettled,
  exitAppDirectly,
} from './uiTaskService';

const log = loggers.task;

const taskMonitorControllers = new Map<string, AbortController>();

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
  const shouldExit = consumeExitAfterTaskQueueSettled(instanceId);

  await stopAgentIfNeeded(instanceId);

  const state = useAppStore.getState();
  state.setInstanceTaskStatus(instanceId, status);
  state.updateInstance(instanceId, { isRunning: false });
  state.setInstanceCurrentTaskId(instanceId, null);
  state.clearPendingTasks(instanceId);
  state.clearScheduleExecution(instanceId);

  if (shouldExit) {
    log.info(`[task-monitor#${instanceId}] 任务队列结束，执行前端关闭自身`);
    await exitAppDirectly();
  }
}

function getPendingTaskIds(instanceId: string) {
  return useAppStore.getState().instancePendingTaskIds[instanceId] || [];
}

async function monitorTaskQueue(instanceId: string, controller: AbortController) {
  const initialTaskIds = getPendingTaskIds(instanceId);
  if (initialTaskIds.length === 0) {
    log.error(`[task-monitor#${instanceId}] 后端未返回 task_id，终止本次运行`);
    taskMonitorControllers.delete(instanceId);
    await finalizeTaskRun(instanceId, 'Failed');
    return;
  }

  let hasFailed = false;
  let index = 0;

  while (true) {
    if (controller.signal.aborted || taskMonitorControllers.get(instanceId) !== controller) {
      return;
    }

    const taskIds = getPendingTaskIds(instanceId);
    const taskId = taskIds[index];
    if (taskId === undefined) {
      break;
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

    index += 1;
  }

  if (taskMonitorControllers.get(instanceId) !== controller) {
    return;
  }

  taskMonitorControllers.delete(instanceId);
  await finalizeTaskRun(instanceId, hasFailed ? 'Failed' : 'Succeeded');
}


function cancelTaskQueueMonitorInternal(instanceId: string, clearExitSchedule: boolean) {
  const controller = taskMonitorControllers.get(instanceId);
  if (!controller) {
    if (clearExitSchedule) {
      clearExitAfterTaskQueueSettled(instanceId);
    }
    return;
  }

  controller.abort();
  taskMonitorControllers.delete(instanceId);
  if (clearExitSchedule) {
    clearExitAfterTaskQueueSettled(instanceId);
  }
}

export function cancelTaskQueueMonitor(instanceId: string) {
  cancelTaskQueueMonitorInternal(instanceId, true);
}

export function startTaskQueueMonitor(instanceId: string) {
  cancelTaskQueueMonitorInternal(instanceId, false);

  const controller = new AbortController();
  taskMonitorControllers.set(instanceId, controller);
  monitorTaskQueue(instanceId, controller);
}
