import { shouldSkipMxuScreenshot } from '@/types/specialTasks';
import { isPretaskName } from '@/types/pretasks';
import type { SelectedTask } from '@/types/interface';

/**
 * 是否为非视觉任务（跳过截图/识别，可放到 Dummy Controller 段执行）。
 * 包含 MXU 内置特殊任务与 pretask 前置任务。
 */
export function shouldSkipScreenshot(taskName: string): boolean {
  return shouldSkipMxuScreenshot(taskName) || isPretaskName(taskName);
}

/** 三段式任务切分结果：连接前特殊 / 连接中普通 / 连接后特殊 */
export interface ThreeSegmentSplit<T> {
  leading: T[];
  middle: T[];
  trailing: T[];
}

/**
 * 将任务列表按「连接前 / 连接中 / 连接后」严格三段切分：
 * - leading：第一个普通任务之前的特殊任务（连接前，Dummy 执行）
 * - middle：所有普通任务（连接中，真机执行）
 * - trailing：第一个普通任务及之后出现的全部特殊任务，含夹心与队尾（连接后，Dummy 执行）
 *
 * 注意：入参应为已排除 pretask 的可执行任务，`shouldSkipScreenshot` 在此等价于「特殊任务」。
 */
export function splitTasksIntoThreeSegments<T extends { taskName: string }>(
  tasks: T[],
): ThreeSegmentSplit<T> {
  if (tasks.length === 0) {
    return { leading: [], middle: [], trailing: [] };
  }

  const firstNormalIdx = tasks.findIndex((t) => !shouldSkipScreenshot(t.taskName));

  // 没有普通任务：全部作为连接前特殊任务（全程 Dummy）
  if (firstNormalIdx === -1) {
    return { leading: [...tasks], middle: [], trailing: [] };
  }

  const leading = tasks.slice(0, firstNormalIdx);
  const rest = tasks.slice(firstNormalIdx);
  const middle = rest.filter((t) => !shouldSkipScreenshot(t.taskName));
  const trailing = rest.filter((t) => shouldSkipScreenshot(t.taskName));

  return { leading, middle, trailing };
}

/**
 * 校验任务顺序是否满足三段式不变式 `S* N* S*`：
 * 忽略 pretask 后，特殊任务只能位于普通任务块之前或之后，不得夹在两个普通任务之间。
 * 用于拖拽/移动排序时拒绝会破坏分段的操作。
 */
export function isValidTaskOrder<T extends { taskName: string }>(tasks: T[]): boolean {
  // pretask 处于独立区块，不参与主列表的特殊/普通分段校验
  const relevant = tasks.filter((t) => !isPretaskName(t.taskName));

  // phase: 0=连接前特殊, 1=普通, 2=连接后特殊
  let phase: 0 | 1 | 2 = 0;
  for (const task of relevant) {
    const isSpecial = shouldSkipScreenshot(task.taskName);
    if (isSpecial) {
      if (phase === 1) phase = 2;
    } else {
      if (phase === 0) phase = 1;
      else if (phase === 2) return false; // 普通任务出现在连接后特殊任务之后，非法
    }
  }
  return true;
}

export type { SelectedTask };
