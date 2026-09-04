import type { Instance } from '@/types/interface';
import type { TaskRunFilterOptions } from '@/utils/taskRunFilter';

export type AutoConnectPhase = 'idle' | 'searching' | 'connecting' | 'loading_resource';

export interface TaskStartOptions extends TaskRunFilterOptions {
  /** 定时策略名称（定时执行时传入） */
  schedulePolicyName?: string;
  /** 自动连接阶段变化回调（用于 UI 状态更新） */
  onPhaseChange?: (phase: AutoConnectPhase) => void;
}

export type TaskStartHandler = (instance: Instance, options?: TaskStartOptions) => Promise<boolean>;

let handler: TaskStartHandler | null = null;

export const taskStartService = {
  setHandler(fn: TaskStartHandler | null) {
    handler = fn;
  },

  async start(instance: Instance, options?: TaskStartOptions): Promise<boolean> {
    if (!handler) return false;
    return handler(instance, options);
  },
};
