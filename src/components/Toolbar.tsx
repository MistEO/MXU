import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { startGlobalCallbackListener } from '@/components/connection/callbackCache';
import { cancelTaskQueueMonitor, startTaskQueueMonitor } from '@/services/taskMonitor';
import { scheduleService } from '@/services/scheduleService';
import { buildPiEnvVars } from '@/utils/piEnv';

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
    setAllTasksRunStatus,
    registerMaaTaskMapping,
    clearTaskRunStatus,
    // 任务队列管理
    setPendingTaskIds,
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
    // MaaFramework 版本
    maaVersion,
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
  const anyExpanded = tasks.some((t) => t.expanded);

  // 获取当前语言的翻译
  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  const instanceId = instance?.id || '';

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
        (savedDevice.adbDeviceName || savedDevice.windowName || savedDevice.wlrSocketPath || savedDevice.playcoverAddress),
      );

      let isTargetConnected = instanceConnectionStatus[targetId] === 'Connected';
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
        // 前置程序重启应用后需要强制重连（旧窗口句柄已失效）
        let needsReconnect = false;

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
              preAction.useCmd ?? false,
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
            // 注意：即使没有保存的设备配置，也需要等待（等待任意匹配的设备/窗口出现）
            if (!(preAction.waitForExit ?? true) && controller) {
              const controllerType = controller.type;
              const isWindowType = controllerType === 'Win32' || controllerType === 'Gamepad';
              log.info(`实例 ${targetInstance.name}: 等待${isWindowType ? '窗口' : '设备'}就绪...`);
              // 根据是否有保存的设备名，输出不同的等待提示
              if (isWindowType) {
                addLog(targetId, {
                  type: 'info',
                  message: savedDevice?.windowName
                    ? t('action.waitingForWindowNamed', { name: savedDevice.windowName })
                    : t('action.waitingForAnyWindow'),
                });
              } else {
                addLog(targetId, {
                  type: 'info',
                  message: savedDevice?.adbDeviceName
                    ? t('action.waitingForDeviceNamed', { name: savedDevice.adbDeviceName })
                    : t('action.waitingForAnyDevice'),
                });
              }
              let deviceFound = false;
              let attempts = 0;
              const maxAttempts = 300; // 最多等待 5 分钟

              while (!deviceFound && attempts < maxAttempts) {
                try {
                  if (controllerType === 'Adb') {
                    const devices = await maaService.findAdbDevices();
                    if (savedDevice?.adbDeviceName) {
                      // 有保存的设备名，精确匹配
                      deviceFound = devices.some((d) => d.name === savedDevice.adbDeviceName);
                    } else {
                      // 没有保存的设备，等待任意设备出现
                      deviceFound = devices.length > 0;
                    }
                  } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
                    const classRegex =
                      controller.win32?.class_regex || controller.gamepad?.class_regex;
                    const windowRegex =
                      controller.win32?.window_regex || controller.gamepad?.window_regex;
                    const windows = await maaService.findWin32Windows(classRegex, windowRegex);
                    if (savedDevice?.windowName) {
                      // 有保存的窗口名，精确匹配
                      deviceFound = windows.some((w) => w.window_name === savedDevice.windowName);
                    } else {
                      // 没有保存的窗口，等待任意匹配窗口出现
                      deviceFound = windows.length > 0;
                    }
                  } else if (controllerType === 'WlRoots') {
                    const sockets = await maaService.findWlrootsSockets();
                    if (savedDevice?.wlrSocketPath) {
                      // 有保存的套接字路径，精确匹配
                      deviceFound = sockets.includes(savedDevice.wlrSocketPath);
                    } else {
                      // 没有保存的套接字路径，等待任意匹配的套接字出现
                      deviceFound = sockets.length > 0;
                    }
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
                // 如果没有 savedDevice，说明是自动匹配的，需要给用户提示
                if (
                  !savedDevice?.windowName &&
                  !savedDevice?.adbDeviceName &&
                  !savedDevice?.wlrSocketPath &&
                  !savedDevice?.playcoverAddress
                ) {
                  // 尝试找出实际匹配到的名称用于提示
                  try {
                    if (controllerType === 'Adb') {
                      const devices = await maaService.findAdbDevices();
                      if (devices.length > 0) {
                        addLog(targetId, {
                          type: 'info',
                          message: t('taskList.autoConnect.autoSelectedDevice', {
                            name: devices[0].name || devices[0].address,
                          }),
                        });
                      }
                    } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
                      const classRegex =
                        controller.win32?.class_regex || controller.gamepad?.class_regex;
                      const windowRegex =
                        controller.win32?.window_regex || controller.gamepad?.window_regex;
                      const windows = await maaService.findWin32Windows(classRegex, windowRegex);
                      if (windows.length > 0) {
                        addLog(targetId, {
                          type: 'info',
                          message: t('taskList.autoConnect.autoSelectedWindow', {
                            name: windows[0].window_name || windows[0].class_name,
                          }),
                        });
                      }
                    } else if (controllerType === 'WlRoots') {
                      const sockets = await maaService.findWlrootsSockets();
                      if (sockets.length > 0) {
                        addLog(targetId, {
                          type: 'info',
                          message: t('taskList.autoConnect.autoSelectedDevice', {
                            name: sockets[0],
                          }),
                        });
                      }
                    }
                  } catch {
                    // 忽略二次搜索错误
                  }
                }

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

                // 前置程序（重新）启动了应用，旧窗口句柄已失效，必须重新连接
                needsReconnect = true;
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

        // 前置程序重启了应用，旧连接已失效，重置连接状态以强制重新连接
        if (needsReconnect && isTargetConnected) {
          log.info(`实例 ${targetInstance.name}: 前置程序已重启应用，重置连接状态以重新连接`);
          setInstanceConnectionStatus(targetId, 'Disconnected');
        }

        // 查询后端真实连接状态，纠正前端可能过时的缓存
        if (isTargetConnected && !needsReconnect) {
          const backendState = await maaService.getInstanceState(targetId);
          if (!backendState || backendState.connectionStatus !== 'Connected') {
            log.warn(
              `实例 ${targetInstance.name}: 后端${backendState ? '连接已断开' : '实例不存在'}，但前端缓存为已连接，强制重新连接`,
            );
            setInstanceConnectionStatus(targetId, 'Disconnected');
            isTargetConnected = false;
          }
        }

        // 如果未连接（或需要重连），尝试自动连接
        if ((!isTargetConnected || needsReconnect) && controller) {
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
            } else if (controllerType === 'WlRoots' && savedDevice.wlrSocketPath) {
              const sockets = await maaService.findWlrootsSockets();
              if (!sockets.includes(savedDevice.wlrSocketPath)) {
                log.warn(
                  `实例 ${targetInstance.name}: 未找到 WlRoots socket ${savedDevice.wlrSocketPath}`,
                );
                return false;
              }
              config = {
                type: 'WlRoots',
                wlr_socket_path: savedDevice.wlrSocketPath,
              };
              deviceName = savedDevice.wlrSocketPath;
              targetType = 'device';
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
              // 没有保存过设备，给出首次自动匹配提示
              addLog(targetId, {
                type: 'info',
                message: t('taskList.autoConnect.autoSelectedDevice', {
                  name: firstDevice.name || firstDevice.address,
                }),
              });
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
              // 没有保存过设备，给出首次自动匹配提示
              addLog(targetId, {
                type: 'info',
                message: t('taskList.autoConnect.autoSelectedWindow', {
                  name: firstWindow.window_name || firstWindow.class_name,
                }),
              });
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
            } else if (controllerType === 'WlRoots') {
              const sockets = await maaService.findWlrootsSockets();
              if (sockets.length === 0) {
                log.warn(`实例 ${targetInstance.name}: 未搜索到任何 WlRoots socket`);
                addLog(targetId, {
                  type: 'error',
                  message: t('taskList.autoConnect.noDeviceFound'),
                });
                return false;
              }
              const firstSocket = sockets[0];
              log.info(`实例 ${targetInstance.name}: 自动选择 WlRoots socket: ${firstSocket}`);
              addLog(targetId, {
                type: 'info',
                message: t('taskList.autoConnect.autoSelectedDevice', {
                  name: firstSocket,
                }),
              });
              config = {
                type: 'WlRoots',
                wlr_socket_path: firstSocket,
              };
              deviceName = firstSocket;
              targetType = 'device';
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

        // 查询后端真实状态，纠正前端可能过时的缓存
        const backendState = await maaService.getInstanceState(targetId);
        if (backendState && !backendState.resourceLoaded && instanceResourceLoaded[targetId]) {
          log.warn(
            `实例 ${targetInstance.name}: 后端资源未加载，但前端缓存为已加载，重置缓存并强制重载`,
          );
          setInstanceResourceLoaded(targetId, false);
        }
        const isResourceReallyLoaded = backendState
          ? backendState.resourceLoaded
          : (instanceResourceLoaded[targetId] ?? false);

        // 如果资源未加载，尝试自动加载
        if (!isResourceReallyLoaded && resource) {
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
            pipeline_override: generateTaskPipelineOverride(
              selectedTask,
              projectInterface,
              controllerName,
              resourceName,
            ),
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

        // PI v2.5.0: 构建 Agent 子进程环境变量
        const piEnvs = agentConfigs?.length
          ? buildPiEnvVars({
              projectInterface,
              controllerName,
              resourceName,
              translations,
              language,
              maaVersion,
            })
          : undefined;

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

        // 任务可能在 startTasks 返回前就瞬时结束，先启动全局回调缓存再提交。
        await startGlobalCallbackListener();

        // 启动任务
        const taskIds = await maaService.startTasks(
          targetId,
          taskConfigs,
          agentConfigs,
          basePath,
          tcpCompatMode,
          piEnvs,
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

        // 设置任务队列
        setPendingTaskIds(targetId, taskIds);
        startTaskQueueMonitor(targetId);

        return true;
      } catch (err) {
        log.error(`实例 ${targetInstance.name}: 任务启动异常:`, err);

        const errMsg = err instanceof Error ? err.message : String(err);
        addLog(targetId, {
          type: 'error',
          message: `${t('taskList.autoConnect.startFailed')}: ${errMsg}`,
        });

        const failedAgentConfigs = normalizeAgentConfigs(projectInterface?.agent);
        if (failedAgentConfigs && failedAgentConfigs.length > 0) {
          for (let i = 0; i < failedAgentConfigs.length; i++) {
            const agentCfg = failedAgentConfigs[i];
            const args = agentCfg.child_args?.join(' ') ?? '';
            const cmd = args ? `${agentCfg.child_exec} ${args}` : agentCfg.child_exec;
            addLog(targetId, {
              type: 'warning',
              message: t('taskList.autoConnect.agentStartParams', {
                index: i + 1,
                cmd,
                cwd: basePath,
              }),
            });
          }
          try {
            await maaService.stopAgent(targetId);
          } catch {
            // 忽略停止 agent 的错误
          }
        }

        updateInstance(targetId, { isRunning: false });
        setInstanceTaskStatus(targetId, 'Failed');
        setInstanceCurrentTaskId(targetId, null);
        clearTaskRunStatus(targetId);
        clearPendingTasks(targetId);
        clearScheduleExecution(targetId);
        cancelTaskQueueMonitor(targetId);

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
      setPendingTaskIds,
      clearTaskRunStatus,
      clearPendingTasks,
      setScheduleExecution,
      clearScheduleExecution,
      setShowAddTaskPanel,
      addLog,
      t,
    ],
  );

  // 调度服务：使用 ref 保持回调始终指向最新闭包
  const scheduleTriggerRef = useRef<typeof startTasksForInstance>(startTasksForInstance);
  scheduleTriggerRef.current = startTasksForInstance;

  const addLogRef = useRef(addLog);
  addLogRef.current = addLog;

  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
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
      cancelTaskQueueMonitor(targetInstanceId);
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
