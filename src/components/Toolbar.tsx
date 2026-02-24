import { useState, useEffect, useRef, useCallback } from 'react';
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
import { maaService } from '@/services/maaService';
import clsx from 'clsx';
import { loggers, generateTaskPipelineOverride, computeResourcePaths } from '@/utils';
import { getMxuSpecialTask } from '@/types/specialTasks';
import type { TaskConfig, ControllerConfig } from '@/types/maa';
import { normalizeAgentConfigs } from '@/types/interface';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';
import { SchedulePanel } from './SchedulePanel';
import type { Instance } from '@/types/interface';
import { resolveI18nText } from '@/services/contentResolver';
import { getInterfaceLangKey } from '@/i18n';
import { PermissionModal } from './toolbar/PermissionModal';
import { ScheduleButton } from './toolbar/ScheduleButton';

const log = loggers.task;

interface ToolbarProps {
  showAddPanel: boolean;
  onToggleAddPanel: () => void;
}

// 自动连接阶段
type AutoConnectPhase = 'idle' | 'searching' | 'connecting' | 'loading_resource';

export function Toolbar({ showAddPanel, onToggleAddPanel }: ToolbarProps) {
  const { t } = useTranslation();
  const {
    instances,
    getActiveInstance,
    selectAllTasks,
    collapseAllTasks,
    updateInstance,
    projectInterface,
    basePath,
    instanceConnectionStatus,
    instanceResourceLoaded,
    setInstanceCurrentTaskId,
    setInstanceTaskStatus,
    setInstanceConnectionStatus,
    setInstanceResourceLoaded,
    selectedController,
    selectedResource,
    // 任务运行状态管理
    setTaskRunStatus,
    setAllTasksRunStatus,
    registerMaaTaskMapping,
    findSelectedTaskIdByMaaTaskId,
    clearTaskRunStatus,
    // 任务队列管理
    instancePendingTaskIds,
    instanceCurrentTaskIndex,
    setPendingTaskIds,
    setCurrentTaskIndex: setCurrentTaskIndexStore,
    advanceCurrentTaskIndex,
    clearPendingTasks,
    // 定时执行状态
    scheduleExecutions,
    setScheduleExecution,
    clearScheduleExecution,
    // 回调 ID 映射
    registerCtrlIdName,
    registerResIdName,
    registerResBatch,
    registerTaskIdName,
    registerEntryTaskName,
    // 日志
    addLog,
    // 添加任务面板
    setShowAddTaskPanel,
    // 国际化
    interfaceTranslations,
    language,
    // 调试设置
    tcpCompatMode,
  } = useAppStore();

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);

  // 自动连接状态
  const [autoConnectPhase, setAutoConnectPhase] = useState<AutoConnectPhase>('idle');
  const [autoConnectError, setAutoConnectError] = useState<string | null>(null);

  // 权限提示弹窗状态
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isRestartingAsAdmin, setIsRestartingAsAdmin] = useState(false);

  const instance = getActiveInstance();
  const tasks = instance?.selectedTasks || [];
  const allEnabled = tasks.length > 0 && tasks.every((t) => t.enabled);
  const anyExpanded = tasks.some((t) => t.expanded);

  // 获取当前语言的翻译
  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  const instanceId = instance?.id || '';

  // 任务队列状态（从 store 获取）
  const pendingTaskIds = instancePendingTaskIds[instanceId] || [];
  const currentTaskIndex = instanceCurrentTaskIndex[instanceId] || 0;
  const runningInstanceIdRef = useRef<string | null>(null);

  // 检查是否有保存的设备和资源配置（用于权限检查等）
  const currentControllerName =
    selectedController[instanceId] || projectInterface?.controller[0]?.name;
  const currentController = projectInterface?.controller.find(
    (c) => c.name === currentControllerName,
  );

  // 只要有启用的任务就可以运行（连接和资源加载会在 startTasksForInstance 中自动处理）
  const canRun = tasks.some((t) => t.enabled);

  // 监听任务完成回调
  useEffect(() => {
    if (pendingTaskIds.length === 0) return;

    const currentTaskId = pendingTaskIds[currentTaskIndex];
    if (currentTaskId === undefined) return;

    let unlisten: (() => void) | null = null;

    maaService
      .onCallback((message, details) => {
        if (details.task_id !== currentTaskId) return;

        const runningInstanceId = runningInstanceIdRef.current;
        if (!runningInstanceId) return;

        if (message === 'Tasker.Task.Succeeded') {
          log.info(`任务 ${currentTaskIndex + 1}/${pendingTaskIds.length} 完成`);

          // 更新当前任务状态为成功
          const selectedTaskId = findSelectedTaskIdByMaaTaskId(runningInstanceId, currentTaskId);
          if (selectedTaskId) {
            setTaskRunStatus(runningInstanceId, selectedTaskId, 'succeeded');
          }

          // 检查是否还有更多任务
          if (currentTaskIndex + 1 < pendingTaskIds.length) {
            // 移动到下一个任务
            advanceCurrentTaskIndex(runningInstanceId);
            const nextIndex = currentTaskIndex + 1;
            setInstanceCurrentTaskId(runningInstanceId, pendingTaskIds[nextIndex]);

            // 将下一个任务设为 running
            const nextSelectedTaskId = findSelectedTaskIdByMaaTaskId(
              runningInstanceId,
              pendingTaskIds[nextIndex],
            );
            if (nextSelectedTaskId) {
              setTaskRunStatus(runningInstanceId, nextSelectedTaskId, 'running');
            }
          } else {
            // 所有任务完成
            log.info('所有任务执行完成');

            // 停止 Agent（如果有）
            const agentConfigs = normalizeAgentConfigs(projectInterface?.agent);
            if (agentConfigs && agentConfigs.length > 0) {
              maaService.stopAgent(runningInstanceId).catch((err) => {
                log.error('停止 Agent 失败:', err);
              });
            }

            setInstanceTaskStatus(runningInstanceId, 'Succeeded');
            updateInstance(runningInstanceId, { isRunning: false });
            setInstanceCurrentTaskId(runningInstanceId, null);
            clearPendingTasks(runningInstanceId);
            runningInstanceIdRef.current = null;
          }
        } else if (message === 'Tasker.Task.Failed') {
          log.error('任务执行失败, task_id:', currentTaskId);

          // 更新当前任务状态为失败
          const selectedTaskId = findSelectedTaskIdByMaaTaskId(runningInstanceId, currentTaskId);
          if (selectedTaskId) {
            setTaskRunStatus(runningInstanceId, selectedTaskId, 'failed');
          }

          // 检查是否还有更多任务（失败的任务不阻止后续任务执行）
          if (currentTaskIndex + 1 < pendingTaskIds.length) {
            // 移动到下一个任务
            advanceCurrentTaskIndex(runningInstanceId);
            const nextIndex = currentTaskIndex + 1;
            setInstanceCurrentTaskId(runningInstanceId, pendingTaskIds[nextIndex]);

            // 将下一个任务设为 running
            const nextSelectedTaskId = findSelectedTaskIdByMaaTaskId(
              runningInstanceId,
              pendingTaskIds[nextIndex],
            );
            if (nextSelectedTaskId) {
              setTaskRunStatus(runningInstanceId, nextSelectedTaskId, 'running');
            }
          } else {
            // 所有任务执行完毕（至少有一个失败）
            log.info('所有任务执行完毕（有任务失败）');

            // 停止 Agent（如果有）
            const agentConfigs = normalizeAgentConfigs(projectInterface?.agent);
            if (agentConfigs && agentConfigs.length > 0) {
              maaService.stopAgent(runningInstanceId).catch((err) => {
                log.error('停止 Agent 失败:', err);
              });
            }

            setInstanceTaskStatus(runningInstanceId, 'Failed');
            updateInstance(runningInstanceId, { isRunning: false });
            setInstanceCurrentTaskId(runningInstanceId, null);
            clearPendingTasks(runningInstanceId);
            runningInstanceIdRef.current = null;
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [
    pendingTaskIds,
    currentTaskIndex,
    projectInterface?.agent,
    setInstanceCurrentTaskId,
    setInstanceTaskStatus,
    updateInstance,
    findSelectedTaskIdByMaaTaskId,
    setTaskRunStatus,
    advanceCurrentTaskIndex,
    clearPendingTasks,
  ]);

  const handleSelectAll = () => {
    if (!instance) return;
    selectAllTasks(instance.id, !allEnabled);
  };

  const handleCollapseAll = () => {
    if (!instance) return;
    collapseAllTasks(instance.id, !anyExpanded);
  };

  /**
   * 初始化 MaaFramework
   */
  const ensureMaaInitialized = async () => {
    try {
      await maaService.getVersion();
      return true;
    } catch {
      await maaService.init();
      return true;
    }
  };

  /**
   * 统一任务启动入口 - 供手动启动、定时启动、快捷键启动等场景复用
   * @param targetInstance 目标实例
   * @param options 启动选项
   * @returns 是否成功启动
   */
  const startTasksForInstance = useCallback(
    async (
      targetInstance: Instance,
      options?: {
        /** 定时策略名称（定时执行时传入） */
        schedulePolicyName?: string;
        /** 自动连接阶段变化回调（用于 UI 状态更新） */
        onPhaseChange?: (phase: AutoConnectPhase) => void;
      },
    ): Promise<boolean> => {
      const { schedulePolicyName, onPhaseChange } = options || {};
      const targetId = targetInstance.id;
      const targetTasks = targetInstance.selectedTasks || [];

      // 检查是否有启用的任务
      const enabledTasks = targetTasks.filter((t) => t.enabled);
      if (enabledTasks.length === 0) {
        log.warn(`实例 ${targetInstance.name} 没有启用的任务`);
        return false;
      }

      // 检查是否正在运行
      if (targetInstance.isRunning) {
        log.warn(`实例 ${targetInstance.name} 正在运行中`);
        return false;
      }

      // 获取控制器和资源配置
      const controllerName = selectedController[targetId] || projectInterface?.controller[0]?.name;
      const resourceName = selectedResource[targetId] || projectInterface?.resource[0]?.name;
      const controller = projectInterface?.controller.find((c) => c.name === controllerName);
      const resource = projectInterface?.resource.find((r) => r.name === resourceName);
      const savedDevice = targetInstance.savedDevice;

      // 检查是否有保存的设备配置
      const hasSavedDevice = Boolean(
        savedDevice &&
        (savedDevice.adbDeviceName || savedDevice.windowName || savedDevice.playcoverAddress),
      );

      const isTargetConnected = instanceConnectionStatus[targetId] === 'Connected';
      const isTargetResourceLoaded = instanceResourceLoaded[targetId] || false;

      // 判断是否可以运行：已连接+资源已加载、有保存设备+资源、或有控制器+资源（自动搜索）
      const canStartTask =
        (isTargetConnected && isTargetResourceLoaded) ||
        (hasSavedDevice && resource) ||
        (controller && resource);

      if (!canStartTask) {
        log.warn(`实例 ${targetInstance.name} 无法启动：未连接且没有可用的控制器或资源配置`);
        return false;
      }

      try {
        // 先执行前置动作（在连接设备之前）
        // 检查是否应跳过已运行的前置程序
        const preAction = targetInstance.preAction;
        let shouldRunPreAction = Boolean(preAction?.enabled && preAction.program.trim());

        if (shouldRunPreAction && preAction?.skipIfRunning) {
          const programPath = preAction.program.trim();
          const processName = programPath.split(/[/\\]/).pop() || programPath;
          if (await maaService.isProcessRunning(programPath)) {
            log.info(`实例 ${targetInstance.name}: 前置程序已在运行，跳过执行:`, processName);
            addLog(targetId, {
              type: 'info',
              message: t('action.preActionSkipped', { name: processName }),
            });
            shouldRunPreAction = false;
          }
        }

        if (shouldRunPreAction && preAction) {
          log.info(`实例 ${targetInstance.name}: 执行前置动作:`, preAction.program);
          addLog(targetId, {
            type: 'info',
            message: t('action.preActionStarting'),
          });
          try {
            const exitCode = await maaService.runAction(
              preAction.program,
              preAction.args,
              basePath,
              preAction.waitForExit ?? true,
            );
            if (exitCode !== 0) {
              log.warn(`实例 ${targetInstance.name}: 前置动作退出码非零:`, exitCode);
              addLog(targetId, {
                type: 'warning',
                message: t('action.preActionExitCode', { code: exitCode }),
              });
            } else {
              addLog(targetId, {
                type: 'success',
                message: t('action.preActionCompleted'),
              });
            }

            // 如果没勾选等待进程退出，则循环查找设备直到找到
            if (!(preAction.waitForExit ?? true) && savedDevice && controller) {
              const controllerType = controller.type;
              const isWindowType = controllerType === 'Win32' || controllerType === 'Gamepad';
              log.info(`实例 ${targetInstance.name}: 等待${isWindowType ? '窗口' : '设备'}就绪...`);
              addLog(targetId, {
                type: 'info',
                message: isWindowType ? t('action.waitingForWindow') : t('action.waitingForDevice'),
              });
              let deviceFound = false;
              let attempts = 0;
              const maxAttempts = 300; // 最多等待 5 分钟

              while (!deviceFound && attempts < maxAttempts) {
                try {
                  if (controllerType === 'Adb' && savedDevice.adbDeviceName) {
                    const devices = await maaService.findAdbDevices();
                    deviceFound = devices.some((d) => d.name === savedDevice.adbDeviceName);
                  } else if (
                    (controllerType === 'Win32' || controllerType === 'Gamepad') &&
                    savedDevice.windowName
                  ) {
                    const classRegex =
                      controller.win32?.class_regex || controller.gamepad?.class_regex;
                    const windowRegex =
                      controller.win32?.window_regex || controller.gamepad?.window_regex;
                    const windows = await maaService.findWin32Windows(classRegex, windowRegex);
                    deviceFound = windows.some((w) => w.window_name === savedDevice.windowName);
                  } else {
                    // 无法确定控制器类型，跳过等待
                    deviceFound = true;
                  }
                } catch (searchErr) {
                  log.warn(
                    `实例 ${targetInstance.name}: ${isWindowType ? '窗口' : '设备'}搜索出错:`,
                    searchErr,
                  );
                }

                if (!deviceFound) {
                  attempts++;
                  await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待 1 秒
                }
              }

              if (deviceFound) {
                log.info(`实例 ${targetInstance.name}: ${isWindowType ? '窗口' : '设备'}已就绪`);
                addLog(targetId, {
                  type: 'success',
                  message: isWindowType ? t('action.windowReady') : t('action.deviceReady'),
                });

                // 设备就绪后额外延迟，等待应用完全初始化
                const delaySec = useAppStore.getState().preActionConnectDelaySec ?? 5;
                if (delaySec > 0) {
                  log.info(`实例 ${targetInstance.name}: 等待 ${delaySec} 秒后再连接...`);
                  addLog(targetId, {
                    type: 'info',
                    message: t('action.preActionConnectDelay', { seconds: delaySec }),
                  });
                  await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
                }
              } else {
                log.warn(`实例 ${targetInstance.name}: 等待${isWindowType ? '窗口' : '设备'}超时`);
                addLog(targetId, {
                  type: 'warning',
                  message: isWindowType
                    ? t('action.windowWaitTimeout')
                    : t('action.deviceWaitTimeout'),
                });
              }
            }
          } catch (err) {
            log.error(`实例 ${targetInstance.name}: 前置动作执行失败:`, err);
            addLog(targetId, {
              type: 'error',
              message: t('action.preActionFailed', { error: String(err) }),
            });
            // 前置动作失败不阻止任务执行，继续
          }
        }

        // 如果未连接，尝试自动连接
        if (!isTargetConnected && controller) {
          const controllerType = controller.type;

          await ensureMaaInitialized();
          await maaService.createInstance(targetId).catch((err) => {
            log.warn('创建实例失败（可能已存在）:', err);
          });

          let config: ControllerConfig | null = null;
          let deviceName = '';
          let targetType: 'device' | 'window' = 'device';

          if (hasSavedDevice && savedDevice) {
            // 有保存的设备配置，按名称精确匹配
            log.info(`实例 ${targetInstance.name}: 自动连接已保存的设备...`);
            onPhaseChange?.('searching');

            if (controllerType === 'Adb' && savedDevice.adbDeviceName) {
              const devices = await maaService.findAdbDevices();
              const matchedDevice = devices.find((d) => d.name === savedDevice.adbDeviceName);
              if (!matchedDevice) {
                log.warn(`实例 ${targetInstance.name}: 未找到设备 ${savedDevice.adbDeviceName}`);
                return false;
              }
              config = {
                type: 'Adb',
                adb_path: matchedDevice.adb_path,
                address: matchedDevice.address,
                screencap_methods: matchedDevice.screencap_methods,
                input_methods: matchedDevice.input_methods,
                config: matchedDevice.config,
              };
              deviceName = matchedDevice.name || matchedDevice.address;
              targetType = 'device';
            } else if (
              (controllerType === 'Win32' || controllerType === 'Gamepad') &&
              savedDevice.windowName
            ) {
              const classRegex = controller.win32?.class_regex || controller.gamepad?.class_regex;
              const windowRegex =
                controller.win32?.window_regex || controller.gamepad?.window_regex;
              const windows = await maaService.findWin32Windows(classRegex, windowRegex);
              const matchedWindow = windows.find((w) => w.window_name === savedDevice.windowName);
              if (!matchedWindow) {
                log.warn(`实例 ${targetInstance.name}: 未找到窗口 ${savedDevice.windowName}`);
                return false;
              }
              if (controllerType === 'Win32') {
                config = {
                  type: 'Win32',
                  handle: matchedWindow.handle,
                  screencap_method: parseWin32ScreencapMethod(controller.win32?.screencap || ''),
                  mouse_method: parseWin32InputMethod(controller.win32?.mouse || ''),
                  keyboard_method: parseWin32InputMethod(controller.win32?.keyboard || ''),
                };
              } else {
                config = {
                  type: 'Gamepad',
                  handle: matchedWindow.handle,
                };
              }
              deviceName = matchedWindow.window_name || matchedWindow.class_name;
              targetType = 'window';
            } else if (controllerType === 'PlayCover' && savedDevice.playcoverAddress) {
              config = {
                type: 'PlayCover',
                address: savedDevice.playcoverAddress,
              };
              deviceName = savedDevice.playcoverAddress;
              targetType = 'device';
            }
          } else {
            // 没有保存的设备配置，自动搜索并连接第一个结果
            log.info(`实例 ${targetInstance.name}: 自动搜索设备并连接...`);
            onPhaseChange?.('searching');

            if (controllerType === 'Adb') {
              const devices = await maaService.findAdbDevices();
              if (devices.length === 0) {
                log.warn(`实例 ${targetInstance.name}: 未搜索到任何 ADB 设备`);
                addLog(targetId, {
                  type: 'error',
                  message: t('taskList.autoConnect.noDeviceFound'),
                });
                return false;
              }
              const firstDevice = devices[0];
              log.info(`实例 ${targetInstance.name}: 自动选择设备: ${firstDevice.name}`);
              config = {
                type: 'Adb',
                adb_path: firstDevice.adb_path,
                address: firstDevice.address,
                screencap_methods: firstDevice.screencap_methods,
                input_methods: firstDevice.input_methods,
                config: firstDevice.config,
              };
              deviceName = firstDevice.name || firstDevice.address;
              targetType = 'device';
            } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
              const classRegex = controller.win32?.class_regex || controller.gamepad?.class_regex;
              const windowRegex =
                controller.win32?.window_regex || controller.gamepad?.window_regex;
              const windows = await maaService.findWin32Windows(classRegex, windowRegex);
              if (windows.length === 0) {
                log.warn(`实例 ${targetInstance.name}: 未搜索到任何窗口`);
                addLog(targetId, {
                  type: 'error',
                  message: t('taskList.autoConnect.noWindowFound'),
                });
                return false;
              }
              const firstWindow = windows[0];
              log.info(`实例 ${targetInstance.name}: 自动选择窗口: ${firstWindow.window_name}`);
              if (controllerType === 'Win32') {
                config = {
                  type: 'Win32',
                  handle: firstWindow.handle,
                  screencap_method: parseWin32ScreencapMethod(controller.win32?.screencap || ''),
                  mouse_method: parseWin32InputMethod(controller.win32?.mouse || ''),
                  keyboard_method: parseWin32InputMethod(controller.win32?.keyboard || ''),
                };
              } else {
                config = {
                  type: 'Gamepad',
                  handle: firstWindow.handle,
                };
              }
              deviceName = firstWindow.window_name || firstWindow.class_name;
              targetType = 'window';
            } else if (controllerType === 'PlayCover') {
              // PlayCover 没有搜索功能，无法自动连接
              log.warn(`实例 ${targetInstance.name}: PlayCover 控制器需要手动配置地址`);
              addLog(targetId, {
                type: 'error',
                message: t('taskList.autoConnect.needConfig'),
              });
              return false;
            }
          }

          if (!config) {
            log.warn(`实例 ${targetInstance.name}: 无法构建控制器配置`);
            return false;
          }

          onPhaseChange?.('connecting');

          // 收集回调（避免快速连接时错过）
          const collectedCallbacks: Array<{ message: string; details: { ctrl_id?: number } }> = [];
          const unsubscribePromise = maaService.onCallback((message, details) => {
            if (
              message === 'Controller.Action.Succeeded' ||
              message === 'Controller.Action.Failed'
            ) {
              collectedCallbacks.push({ message, details });
            }
          });

          const ctrlId = await maaService.connectController(targetId, config);

          // 注册 ctrl_id 与设备名/类型的映射
          registerCtrlIdName(ctrlId, deviceName, targetType);

          // 等待初始回调收集器设置完成
          const unsubscribe = await unsubscribePromise;

          // 等待连接完成
          const connectResult = await new Promise<boolean>((resolve) => {
            let resolved = false;

            const cleanup = (unlisten?: () => void) => {
              unsubscribe();
              unlisten?.();
            };

            const timeout = setTimeout(() => {
              if (!resolved) {
                log.warn(`实例 ${targetInstance.name}: 连接超时`);
                cleanup();
                resolve(false);
              }
            }, 30000);

            // 检查已收集的回调
            const match = collectedCallbacks.find((cb) => cb.details.ctrl_id === ctrlId);
            if (match) {
              resolved = true;
              clearTimeout(timeout);
              cleanup();
              if (match.message === 'Controller.Action.Succeeded') {
                setInstanceConnectionStatus(targetId, 'Connected');
                resolve(true);
              } else {
                resolve(false);
              }
              return;
            }

            // 继续监听新回调
            maaService.onCallback((message, details) => {
              if (resolved) return;
              if (details.ctrl_id !== ctrlId) return;
              if (
                message === 'Controller.Action.Succeeded' ||
                message === 'Controller.Action.Failed'
              ) {
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                if (message === 'Controller.Action.Succeeded') {
                  setInstanceConnectionStatus(targetId, 'Connected');
                  resolve(true);
                } else {
                  resolve(false);
                }
              }
            });
          });

          if (!connectResult) {
            log.warn(`实例 ${targetInstance.name}: 连接设备失败`);
            return false;
          }
        }

        // 如果资源未加载，尝试自动加载
        if (!instanceResourceLoaded[targetId] && resource) {
          log.info(`实例 ${targetInstance.name}: 加载资源...`);
          onPhaseChange?.('loading_resource');

          // 计算完整的资源路径（包括 controller.attach_resource_path）
          const resourcePaths = computeResourcePaths(resource, controller, basePath);

          const resIds = await maaService.loadResource(targetId, resourcePaths);

          // 注册 res_id 与资源名的映射
          const resDisplayName = resolveI18nText(resource.label, translations) || resource.name;
          registerResBatch(resIds);
          resIds.forEach((resId) => {
            registerResIdName(resId, resDisplayName);
          });

          // 等待资源加载完成
          const loadResult = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 60000);
            let remaining = new Set(resIds);

            maaService.onCallback((message, details) => {
              if (details.res_id === undefined || !remaining.has(details.res_id)) return;
              if (message === 'Resource.Loading.Succeeded') {
                remaining.delete(details.res_id);
                if (remaining.size === 0) {
                  clearTimeout(timeout);
                  setInstanceResourceLoaded(targetId, true);
                  resolve(true);
                }
              } else if (message === 'Resource.Loading.Failed') {
                clearTimeout(timeout);
                resolve(false);
              }
            });
          });

          if (!loadResult) {
            log.warn(`实例 ${targetInstance.name}: 资源加载失败`);
            return false;
          }
        }

        onPhaseChange?.('idle');

        log.info(`实例 ${targetInstance.name}: 开始执行任务, 数量:`, enabledTasks.length);

        // 构建任务配置列表，同时预注册 entry -> taskName 映射（解决时序问题）
        const taskConfigs: TaskConfig[] = [];
        for (const selectedTask of enabledTasks) {
          // 先检查是否是 MXU 特殊任务
          const specialTask = getMxuSpecialTask(selectedTask.taskName);
          const taskDef =
            specialTask?.taskDef ||
            projectInterface?.task.find((t) => t.name === selectedTask.taskName);
          if (!taskDef) continue;
          taskConfigs.push({
            entry: taskDef.entry,
            pipeline_override: generateTaskPipelineOverride(selectedTask, projectInterface),
          });
          // 预注册 entry -> taskName 映射，确保回调时能找到任务名
          // MXU 特殊任务的 label 是 MXU i18n key（如 'specialTask.sleep.label'），需要用 t() 翻译
          const taskDisplayName =
            selectedTask.customName ||
            (specialTask && taskDef.label
              ? t(taskDef.label)
              : resolveI18nText(taskDef.label, translations)) ||
            selectedTask.taskName;
          registerEntryTaskName(taskDef.entry, taskDisplayName);
        }

        if (taskConfigs.length === 0) {
          log.warn(`实例 ${targetInstance.name}: 没有可执行的任务`);
          return false;
        }

        // 准备 Agent 配置（支持单个或多个 Agent）
        const agentConfigs = normalizeAgentConfigs(projectInterface?.agent);

        updateInstance(targetId, { isRunning: true });
        setInstanceTaskStatus(targetId, 'Running');
        setShowAddTaskPanel(false);

        // 如果是定时执行，记录状态
        if (schedulePolicyName) {
          setScheduleExecution(targetId, {
            policyName: schedulePolicyName,
            startTime: Date.now(),
          });
        }

        // 启动任务
        const taskIds = await maaService.startTasks(
          targetId,
          taskConfigs,
          agentConfigs,
          basePath,
          tcpCompatMode,
        );

        log.info(`实例 ${targetInstance.name}: 任务已提交, task_ids:`, taskIds);

        // 初始化任务运行状态
        const enabledTaskIds = enabledTasks.map((t) => t.id);
        setAllTasksRunStatus(targetId, enabledTaskIds, 'pending');

        // 开始任务时折叠所有任务
        collapseAllTasks(targetId, false);

        // 记录映射关系，并注册 task_id 与任务名的映射用于日志显示
        taskIds.forEach((maaTaskId, index) => {
          if (enabledTasks[index]) {
            registerMaaTaskMapping(targetId, maaTaskId, enabledTasks[index].id);
            // 注册 task_id 与任务名的映射（使用自定义名称或 label）
            // MXU 特殊任务的 label 需要用 t() 翻译
            const specialTask = getMxuSpecialTask(enabledTasks[index].taskName);
            const taskDef =
              specialTask?.taskDef ||
              projectInterface?.task.find((t) => t.name === enabledTasks[index].taskName);
            const taskDisplayName =
              enabledTasks[index].customName ||
              (specialTask && taskDef?.label
                ? t(taskDef.label)
                : resolveI18nText(taskDef?.label, translations)) ||
              enabledTasks[index].taskName;
            registerTaskIdName(maaTaskId, taskDisplayName);
          }
        });

        // 第一个任务设为 running
        if (enabledTasks.length > 0) {
          setTaskRunStatus(targetId, enabledTasks[0].id, 'running');
        }

        // 设置任务队列
        runningInstanceIdRef.current = targetId;
        setPendingTaskIds(targetId, taskIds);
        setCurrentTaskIndexStore(targetId, 0);
        setInstanceCurrentTaskId(targetId, taskIds[0]);

        return true;
      } catch (err) {
        log.error(`实例 ${targetInstance.name}: 任务启动异常:`, err);

        const failedAgentConfigs = normalizeAgentConfigs(projectInterface?.agent);
        if (failedAgentConfigs && failedAgentConfigs.length > 0) {
          try {
            await maaService.stopAgent(targetId);
          } catch {
            // 忽略停止 agent 的错误
          }
        }

        updateInstance(targetId, { isRunning: false });
        setInstanceTaskStatus(targetId, 'Failed');
        clearTaskRunStatus(targetId);
        clearPendingTasks(targetId);
        clearScheduleExecution(targetId);

        return false;
      }
    },
    [
      projectInterface,
      basePath,
      selectedController,
      selectedResource,
      instanceConnectionStatus,
      instanceResourceLoaded,
      setInstanceConnectionStatus,
      setInstanceResourceLoaded,
      updateInstance,
      setInstanceTaskStatus,
      setInstanceCurrentTaskId,
      setAllTasksRunStatus,
      registerMaaTaskMapping,
      setTaskRunStatus,
      setPendingTaskIds,
      setCurrentTaskIndexStore,
      clearTaskRunStatus,
      clearPendingTasks,
      setScheduleExecution,
      clearScheduleExecution,
      setShowAddTaskPanel,
      addLog,
      t,
    ],
  );

  /**
   * 检查并执行定时任务
   * 遍历所有实例的定时策略，如果当前时间匹配则启动任务
   */
  const checkAndExecuteScheduledTasks = useCallback(async () => {
    const now = new Date();
    const currentWeekday = now.getDay(); // 0-6, 0=周日
    const currentHour = now.getHours(); // 0-23

    log.info(`定时检查: 周${currentWeekday} ${currentHour}:00`);

    for (const inst of instances) {
      const policies = inst.schedulePolicies || [];

      for (const policy of policies) {
        if (!policy.enabled) continue;

        // 检查是否匹配当前时间
        const matchesWeekday = policy.weekdays.includes(currentWeekday);
        const matchesHour = policy.hours.includes(currentHour);

        if (matchesWeekday && matchesHour) {
          log.info(`定时策略命中: 实例 "${inst.name}", 策略 "${policy.name}"`);

          // 添加定时执行开始日志
          const timeStr = `${currentHour.toString().padStart(2, '0')}:00`;
          addLog(inst.id, {
            type: 'info',
            message: t('logs.messages.scheduleStarting', {
              policy: policy.name,
              time: timeStr,
            }),
          });

          // 启动任务（复用统一入口）
          const started = await startTasksForInstance(inst, {
            schedulePolicyName: policy.name,
          });
          if (started) {
            log.info(`定时任务启动成功: 实例 "${inst.name}"`);
          } else {
            log.warn(`定时任务启动失败或跳过: 实例 "${inst.name}"`);
          }

          // 一个实例只执行第一个匹配的策略，避免重复启动
          break;
        }
      }
    }
  }, [instances, startTasksForInstance, addLog, t]);

  // 定时任务检查：每个整小时检查一次
  useEffect(() => {
    // 计算距离下一个整小时的时间
    const now = new Date();
    const msUntilNextHour =
      (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

    // 立即检查一次（仅在整点时）
    if (now.getMinutes() === 0 && now.getSeconds() < 5) {
      checkAndExecuteScheduledTasks();
    }

    // 设置定时器，在下一个整小时执行
    const initialTimeout = setTimeout(() => {
      checkAndExecuteScheduledTasks();

      // 然后每小时执行一次
      const hourlyInterval = setInterval(
        () => {
          checkAndExecuteScheduledTasks();
        },
        60 * 60 * 1000,
      );

      // 保存 interval ID 以便清理
      (
        window as unknown as { __scheduleInterval?: ReturnType<typeof setInterval> }
      ).__scheduleInterval = hourlyInterval;
    }, msUntilNextHour);

    return () => {
      clearTimeout(initialTimeout);
      const hourlyInterval = (
        window as unknown as { __scheduleInterval?: ReturnType<typeof setInterval> }
      ).__scheduleInterval;
      if (hourlyInterval) {
        clearInterval(hourlyInterval);
      }
    };
  }, [checkAndExecuteScheduledTasks]);

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

  // 停止轮询 / 重发相关常量
  const STOP_TIMEOUT_MS = 8000; // 等待任务停止的最长时间
  const STOP_REPOST_INTERVAL_MS = 800; // 超时未停时重发 stop 的间隔
  const STOP_POLL_INTERVAL_MS = 100; // 轮询 isRunning 的间隔

  const waitForTaskStop = async (instanceId: string) => {
    const start = Date.now();
    let lastPost = start;
    while (Date.now() - start < STOP_TIMEOUT_MS) {
      const running = await maaService.isRunning(instanceId);
      if (!running) return true;
      if (Date.now() - lastPost >= STOP_REPOST_INTERVAL_MS) {
        try {
          await maaService.stopTask(instanceId);
          lastPost = Date.now();
        } catch (err) {
          log.warn('重复停止任务失败:', err);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
    }
    return false;
  };

  /**
   * 停止任务的统一流程：发送 stop → 轮询确认 → 断开 agent → 清理 UI 状态
   * handleStartStop 和 handleStopTasks 共用此逻辑以保持行为一致。
   */
  const performStop = async (targetInstanceId: string) => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      log.info('停止任务...', targetInstanceId);
      await maaService.stopTask(targetInstanceId);
      const stopped = await waitForTaskStop(targetInstanceId);
      if (!stopped) {
        log.warn('等待任务停止超时，保留运行状态以避免 UI 与实际不一致');
        return;
      }
      const agentConfigs = normalizeAgentConfigs(projectInterface?.agent);
      if (agentConfigs && agentConfigs.length > 0) {
        // 任务已停止后再断开 agent，避免释放顺序问题
        await maaService.stopAgent(targetInstanceId);
      }
      updateInstance(targetInstanceId, { isRunning: false });
      setInstanceTaskStatus(targetInstanceId, null);
      setInstanceCurrentTaskId(targetInstanceId, null);
      clearTaskRunStatus(targetInstanceId);
      clearPendingTasks(targetInstanceId);
      clearScheduleExecution(targetInstanceId);
      runningInstanceIdRef.current = null;
    } finally {
      setIsStopping(false);
    }
  };

  const handleStartStop = async () => {
    if (!instance) return;

    if (instance.isRunning) {
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

        if (!success) {
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

      if (currentInstance.isRunning) {
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
      const runningInstance = useAppStore.getState().instances.find((i) => i.isRunning);
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
  }, [instance?.id, instance?.isRunning]);

  // canRun 只检查是否有启用的任务；运行中时按钮用于停止，不应禁用
  const isDisabled = (tasks.length === 0 || !canRun) && !instance?.isRunning;

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
    <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary border-t border-border">
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
          disabled={isDisabled || isStarting || isStopping}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            isStarting
              ? 'bg-success text-white'
              : isStopping
                ? 'bg-warning text-white'
                : instance?.isRunning
                  ? 'bg-error hover:bg-error/90 text-white'
                  : isDisabled
                    ? 'bg-bg-active text-text-tertiary cursor-not-allowed'
                    : 'bg-accent hover:bg-accent-hover text-white',
          )}
          title={getButtonTitle()}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{getStartButtonText()}</span>
            </>
          ) : isStopping ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('taskList.stoppingTasks')}</span>
            </>
          ) : instance?.isRunning ? (
            <>
              <StopCircle className="w-4 h-4" />
              <span>{t('taskList.stopTasks')}</span>
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
