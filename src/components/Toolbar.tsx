import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare,
  Square,
  ChevronsUpDown,
  ChevronsDownUp,
  Plus,
  Play,
  StopCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { isTaskCompatible } from '@/stores/helpers';
import { maaService } from '@/services/maaService';
import clsx from 'clsx';
import { loggers } from '@/utils';
import { SchedulePanel } from './SchedulePanel';
import { PermissionModal } from './toolbar/PermissionModal';
import { ScheduleButton } from './toolbar/ScheduleButton';
import { scheduleService } from '@/services/scheduleService';
import { isTauri } from '@/utils/paths';
import { useTaskRunner, type AutoConnectPhase } from '@/hooks/useTaskRunner';

const log = loggers.task;

interface ToolbarProps {
  showAddPanel: boolean;
  onToggleAddPanel: () => void;
  className?: string;
}

export function Toolbar({ showAddPanel, onToggleAddPanel, className }: ToolbarProps) {
  const { t } = useTranslation();
  const {
    getActiveInstance,
    selectAllTasks,
    collapseAllTasks,
    projectInterface,
    selectedController,
    selectedResource,
    // 定时执行状态
    scheduleExecutions,
    // 日志
    addLog,
  } = useAppStore();

  // 统一任务运行器（启动/停止/前置控制均由 hook 提供）
  const {
    startTasksForInstance,
    performStop,
    isStopping,
    preActionControlledInstanceId,
    lastStartCancelledRef,
  } = useTaskRunner();

  const [isStarting, setIsStarting] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);

  // 自动连接状态
  const [autoConnectPhase, setAutoConnectPhase] = useState<AutoConnectPhase>('idle');
  const [autoConnectError, setAutoConnectError] = useState<string | null>(null);

  // 权限提示弹窗状态
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isRestartingAsAdmin, setIsRestartingAsAdmin] = useState(false);

  const instance = getActiveInstance();
  const tasks = instance?.selectedTasks || [];
  const anyExpanded = tasks.some((t) => t.expanded);

  const instanceId = instance?.id || '';
  const isPreActionControlledInstance =
    Boolean(instanceId) && preActionControlledInstanceId === instanceId;
  const isStartStopRunning = Boolean(instance?.isRunning) || isPreActionControlledInstance;

  // 检查是否有保存的设备和资源配置（用于权限检查等）
  const currentControllerName =
    selectedController[instanceId] ||
    instance?.controllerName ||
    projectInterface?.controller[0]?.name;
  const currentResourceName =
    selectedResource[instanceId] || instance?.resourceName || projectInterface?.resource[0]?.name;
  const currentController = projectInterface?.controller.find(
    (c) => c.name === currentControllerName,
  );

  // 全选状态仅考虑兼容当前控制器/资源的任务
  const allEnabled = useMemo(() => {
    if (tasks.length === 0) return false;
    const compatibleTasks = tasks.filter((t) => {
      const taskDef = projectInterface?.task.find((td) => td.name === t.taskName);
      return isTaskCompatible(taskDef, currentControllerName, currentResourceName);
    });
    return compatibleTasks.length > 0 && compatibleTasks.every((t) => t.enabled);
  }, [tasks, projectInterface, currentControllerName, currentResourceName]);

  // 只要有启用的任务就可以运行（连接和资源加载会在 startTasksForInstance 中自动处理）
  const canRun = tasks.some((t) => t.enabled);

  const handleSelectAll = () => {
    if (!instance) return;
    selectAllTasks(instance.id, !allEnabled);
  };

  const handleCollapseAll = () => {
    if (!instance) return;
    collapseAllTasks(instance.id, !anyExpanded);
  };

  // 调度服务：使用 ref 保持回调始终指向最新闭包
  const scheduleTriggerRef = useRef<typeof startTasksForInstance>(startTasksForInstance);
  scheduleTriggerRef.current = startTasksForInstance;

  const addLogRef = useRef(addLog);
  addLogRef.current = addLog;

  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isTauri()) return;

    scheduleService.setTriggerCallback(async (inst, policyName, slotLabel, isCompensation) => {
      const currentT = tRef.current;
      const currentAddLog = addLogRef.current;

      const msgKey = isCompensation
        ? 'logs.messages.scheduleCompensating'
        : 'logs.messages.scheduleStarting';

      currentAddLog(inst.id, {
        type: 'info',
        message: currentT(msgKey, { policy: policyName, time: slotLabel }),
      });

      const started = await scheduleTriggerRef.current(inst, {
        schedulePolicyName: policyName,
      });

      if (started) {
        log.info(`定时任务启动成功: 实例 "${inst.name}"`);
      } else {
        log.warn(`定时任务启动失败或跳过: 实例 "${inst.name}"`);
      }

      return started;
    });

    scheduleService.start();

    return () => {
      scheduleService.stop();
      scheduleService.setTriggerCallback(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 检查当前控制器是否需要管理员权限
   * @returns 如果需要权限且当前不是管理员返回 true
   */
  const checkPermissionRequired = async (): Promise<boolean> => {
    // 检查当前控制器是否设置了 permission_required
    if (!currentController?.permission_required) {
      return false;
    }

    // 检查当前进程是否已经是管理员
    const isElevated = await maaService.isElevated();
    if (isElevated) {
      log.info('当前已是管理员权限');
      return false;
    }

    log.info('控制器需要管理员权限，但当前不是管理员');
    return true;
  };

  /**
   * 处理以管理员身份重启
   */
  const handleRestartAsAdmin = async () => {
    setIsRestartingAsAdmin(true);
    try {
      await maaService.restartAsAdmin();
      // 成功的话进程会退出，不会执行到这里
    } catch (err) {
      log.error('以管理员身份重启失败:', err);
      setIsRestartingAsAdmin(false);
    }
  };

  const handleStartStop = async () => {
    if (!instance) return;

    if (isStartStopRunning) {
      // 停止任务
      try {
        await performStop(instance.id);
      } catch (err) {
        log.error('停止任务失败:', err);
      }
    } else {
      // 启动任务
      if (!canRun) {
        log.warn('无法运行任务：没有启用的任务');
        return;
      }

      // 检查是否需要管理员权限
      const needsElevation = await checkPermissionRequired();
      if (needsElevation) {
        setShowPermissionModal(true);
        return;
      }

      setIsStarting(true);
      setAutoConnectError(null);

      try {
        // 调用统一入口启动任务，传入进度回调以更新 UI 状态
        const success = await startTasksForInstance(instance, {
          onPhaseChange: setAutoConnectPhase,
        });

        if (!success && !lastStartCancelledRef.current) {
          throw new Error(t('taskList.autoConnect.startFailed'));
        }
      } catch (err) {
        log.error('任务启动异常:', err);
        setAutoConnectError(err instanceof Error ? err.message : String(err));
        setAutoConnectPhase('idle');
      } finally {
        setIsStarting(false);
      }
    }
  };

  const hotkeyStartingRef = useRef(false);

  // 监听来自 App 的全局快捷键事件：F10 开始任务，F11 结束任务
  useEffect(() => {
    const handleStartTasks = async (evt: Event) => {
      if (hotkeyStartingRef.current) return;
      const currentInstance = useAppStore.getState().getActiveInstance();
      if (!currentInstance) return;

      const detail = (evt as CustomEvent | undefined)?.detail as
        | { source?: string; combo?: string }
        | undefined;
      const combo = detail?.combo || '';
      addLog(currentInstance.id, {
        type: 'info',
        message: t('logs.messages.hotkeyDetected', {
          combo,
          action: t('logs.messages.hotkeyActionStart'),
        }),
      });

      if (currentInstance.isRunning || preActionControlledInstanceId === currentInstance.id) {
        addLog(currentInstance.id, {
          type: 'error',
          message: t('logs.messages.hotkeyStartFailed'),
        });
        return;
      }

      // 直接使用从 store 获取的最新 instance，避免闭包捕获旧的 selectedTasks
      hotkeyStartingRef.current = true;
      try {
        const success = await startTasksForInstance(currentInstance, {
          onPhaseChange: setAutoConnectPhase,
        });
        addLog(currentInstance.id, {
          type: success ? 'success' : 'error',
          message: success
            ? t('logs.messages.hotkeyStartSuccess')
            : t('logs.messages.hotkeyStartFailed'),
        });
      } finally {
        hotkeyStartingRef.current = false;
      }
    };

    const handleStopTasks = async (evt: Event) => {
      const storeState = useAppStore.getState();
      const runningInstance =
        storeState.instances.find((i) => i.isRunning) ||
        (preActionControlledInstanceId
          ? storeState.instances.find((i) => i.id === preActionControlledInstanceId)
          : undefined);
      if (!runningInstance) return;
      if (isStopping) return;

      const detail = (evt as CustomEvent | undefined)?.detail as
        | { source?: string; combo?: string }
        | undefined;
      const combo = detail?.combo || '';
      addLog(runningInstance.id, {
        type: 'info',
        message: t('logs.messages.hotkeyDetected', {
          combo,
          action: t('logs.messages.hotkeyActionStop'),
        }),
      });

      try {
        await performStop(runningInstance.id);

        addLog(runningInstance.id, {
          type: 'success',
          message: t('logs.messages.hotkeyStopSuccess'),
        });
      } catch (err) {
        log.error('停止任务失败:', err);
        addLog(runningInstance.id, {
          type: 'error',
          message: t('logs.messages.hotkeyStopFailed'),
        });
      }
    };

    document.addEventListener('mxu-start-tasks', handleStartTasks);
    document.addEventListener('mxu-stop-tasks', handleStopTasks);

    return () => {
      document.removeEventListener('mxu-start-tasks', handleStartTasks);
      document.removeEventListener('mxu-stop-tasks', handleStopTasks);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id, instance?.isRunning, isStopping, preActionControlledInstanceId]);

  // canRun 只检查是否有启用的任务；运行中时按钮用于停止，不应禁用
  const isDisabled = (tasks.length === 0 || !canRun) && !isStartStopRunning;

  // 获取启动按钮的文本
  const getStartButtonText = () => {
    if (isStarting) {
      switch (autoConnectPhase) {
        case 'searching':
          return t('taskList.autoConnect.searching');
        case 'connecting':
          return t('taskList.autoConnect.connecting');
        case 'loading_resource':
          return t('taskList.autoConnect.loadingResource');
        default:
          return t('taskList.startingTasks');
      }
    }
    return t('taskList.startTasks');
  };

  // 获取按钮的 title 提示
  const getButtonTitle = () => {
    if (autoConnectError) {
      return autoConnectError;
    }
    return undefined;
  };

  return (
    <div
      className={clsx(
        'flex items-center justify-between px-3 py-2 bg-bg-secondary border-t border-border',
        className,
      )}
    >
      {/* 左侧工具按钮 */}
      <div className="flex items-center gap-1">
        {/* 全选/取消全选 */}
        <button
          onClick={handleSelectAll}
          disabled={tasks.length === 0}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
            tasks.length === 0
              ? 'text-text-muted cursor-not-allowed'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
          )}
          title={allEnabled ? t('taskList.deselectAll') : t('taskList.selectAll')}
        >
          {allEnabled ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          <span className="hidden sm:inline">
            {allEnabled ? t('taskList.deselectAll') : t('taskList.selectAll')}
          </span>
        </button>

        {/* 展开/折叠 */}
        <button
          onClick={handleCollapseAll}
          disabled={tasks.length === 0}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
            tasks.length === 0
              ? 'text-text-muted cursor-not-allowed'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
          )}
          title={anyExpanded ? t('taskList.collapseAll') : t('taskList.expandAll')}
        >
          {anyExpanded ? (
            <ChevronsDownUp className="w-4 h-4" />
          ) : (
            <ChevronsUpDown className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">
            {anyExpanded ? t('taskList.collapseAll') : t('taskList.expandAll')}
          </span>
        </button>

        {/* 添加任务 */}
        <button
          id="add-task-button"
          onClick={onToggleAddPanel}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
            showAddPanel
              ? 'bg-accent/10 text-accent'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
          )}
          title={t('taskList.addTask')}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t('taskList.addTask')}</span>
        </button>
      </div>

      {/* 右侧执行按钮组 */}
      <div className="flex items-center gap-2 relative">
        {/* 定时执行按钮和状态气泡 */}
        <ScheduleButton
          enabledCount={instance?.schedulePolicies?.filter((p) => p.enabled).length || 0}
          scheduleExecution={instance ? scheduleExecutions[instance.id] : null}
          showPanel={showSchedulePanel}
          onToggle={() => setShowSchedulePanel(!showSchedulePanel)}
        />

        {/* 定时执行面板 */}
        {showSchedulePanel && instance && (
          <SchedulePanel instanceId={instance.id} onClose={() => setShowSchedulePanel(false)} />
        )}

        {/* 权限提示弹窗 */}
        <PermissionModal
          isOpen={showPermissionModal}
          isRestarting={isRestartingAsAdmin}
          onCancel={() => setShowPermissionModal(false)}
          onRestart={handleRestartAsAdmin}
        />

        {/* 开始/停止按钮 */}
        <button
          data-role="start-stop-button"
          onClick={handleStartStop}
          disabled={isDisabled || isStopping || (isStarting && !isStartStopRunning)}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            isStopping
              ? 'bg-warning text-white'
              : isStartStopRunning
                ? 'bg-error hover:bg-error/90 text-white'
                : isStarting
                  ? 'bg-success text-white'
                  : isDisabled
                    ? 'bg-bg-active text-text-tertiary cursor-not-allowed'
                    : 'bg-accent hover:bg-accent-hover text-white',
          )}
          title={getButtonTitle()}
        >
          {isStopping ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('taskList.stoppingTasks')}</span>
            </>
          ) : isStartStopRunning ? (
            <>
              <StopCircle className="w-4 h-4" />
              <span>{t('taskList.stopTasks')}</span>
            </>
          ) : isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{getStartButtonText()}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>{t('taskList.startTasks')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
