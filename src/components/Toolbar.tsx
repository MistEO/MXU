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
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import clsx from 'clsx';
import { loggers, generateTaskPipelineOverride } from '@/utils';
import type { TaskConfig, AgentConfig, ControllerConfig } from '@/types/maa';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';
import { SchedulePanel } from './SchedulePanel';
import type { Instance } from '@/types/interface';
import { resolveI18nText } from '@/services/contentResolver';
import { getInterfaceLangKey } from '@/i18n';

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

  // 自动连接回调 ID
  const pendingCtrlIdRef = useRef<number | null>(null);
  const pendingResIdsRef = useRef<Set<number>>(new Set());

  const instance = getActiveInstance();
  const tasks = instance?.selectedTasks || [];
  const allEnabled = tasks.length > 0 && tasks.every((t) => t.enabled);
  const anyExpanded = tasks.some((t) => t.expanded);

  // 获取当前语言的翻译
  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  // 检查是否可以运行
  const instanceId = instance?.id || '';

  // 任务队列状态（从 store 获取）
  const pendingTaskIds = instancePendingTaskIds[instanceId] || [];
  const currentTaskIndex = instanceCurrentTaskIndex[instanceId] || 0;
  const runningInstanceIdRef = useRef<string | null>(null);
  const isConnected = instanceConnectionStatus[instanceId] === 'Connected';
  const isResourceLoaded = instanceResourceLoaded[instanceId] || false;

  // 检查是否有保存的设备和资源配置
  const currentControllerName =
    selectedController[instanceId] || projectInterface?.controller[0]?.name;
  const currentResourceName = selectedResource[instanceId] || projectInterface?.resource[0]?.name;
  const currentController = projectInterface?.controller.find(
    (c) => c.name === currentControllerName,
  );
  const currentResource = projectInterface?.resource.find((r) => r.name === currentResourceName);
  const savedDevice = instance?.savedDevice;

  // 判断是否有保存的设备配置可以自动连接
  const hasSavedDeviceConfig = Boolean(
    savedDevice &&
    (savedDevice.adbDeviceName || savedDevice.windowName || savedDevice.playcoverAddress),
  );

  // 允许在有保存配置时启动（即使未连接）
  const canRun =
    (isConnected && isResourceLoaded && tasks.some((t) => t.enabled)) ||
    (hasSavedDeviceConfig && currentResource && tasks.some((t) => t.enabled));

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
            if (projectInterface?.agent) {
              maaService.stopAgent(runningInstanceId).catch(() => {});
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
            if (projectInterface?.agent) {
              maaService.stopAgent(runningInstanceId).catch(() => {});
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
   * 自动搜索并连接设备
   */
  const autoConnectDevice = async (): Promise<boolean> => {
    if (!currentController || !savedDevice) return false;

    const controllerType = currentController.type;

    setAutoConnectPhase('searching');
    log.info('自动搜索设备...');

    try {
      await ensureMaaInitialized();
      await maaService.createInstance(instanceId).catch(() => {});

      let config: ControllerConfig | null = null;

      if (controllerType === 'Adb' && savedDevice.adbDeviceName) {
        const devices = await maaService.findAdbDevices();
        const matchedDevice = devices.find((d) => d.name === savedDevice.adbDeviceName);

        if (!matchedDevice) {
          throw new Error(
            t('taskList.autoConnect.deviceNotFound', { name: savedDevice.adbDeviceName }),
          );
        }

        log.info('匹配到 ADB 设备:', matchedDevice.name);
        config = {
          type: 'Adb',
          adb_path: matchedDevice.adb_path,
          address: matchedDevice.address,
          screencap_methods: matchedDevice.screencap_methods,
          input_methods: matchedDevice.input_methods,
          config: matchedDevice.config,
        };
      } else if (
        (controllerType === 'Win32' || controllerType === 'Gamepad') &&
        savedDevice.windowName
      ) {
        const classRegex =
          currentController.win32?.class_regex || currentController.gamepad?.class_regex;
        const windowRegex =
          currentController.win32?.window_regex || currentController.gamepad?.window_regex;
        const windows = await maaService.findWin32Windows(classRegex, windowRegex);
        const matchedWindow = windows.find((w) => w.window_name === savedDevice.windowName);

        if (!matchedWindow) {
          throw new Error(
            t('taskList.autoConnect.windowNotFound', { name: savedDevice.windowName }),
          );
        }

        log.info('匹配到窗口:', matchedWindow.window_name);
        if (controllerType === 'Win32') {
          config = {
            type: 'Win32',
            handle: matchedWindow.handle,
            screencap_method: parseWin32ScreencapMethod(currentController.win32?.screencap || ''),
            mouse_method: parseWin32InputMethod(currentController.win32?.mouse || ''),
            keyboard_method: parseWin32InputMethod(currentController.win32?.keyboard || ''),
          };
        } else {
          config = {
            type: 'Gamepad',
            handle: matchedWindow.handle,
          };
        }
      } else if (controllerType === 'PlayCover' && savedDevice.playcoverAddress) {
        log.info('使用 PlayCover 地址:', savedDevice.playcoverAddress);
        config = {
          type: 'PlayCover',
          address: savedDevice.playcoverAddress,
        };
      }

      if (!config) {
        throw new Error(t('taskList.autoConnect.noSavedDevice'));
      }

      // 连接设备
      setAutoConnectPhase('connecting');
      log.info('连接设备...');

      const ctrlId = await maaService.connectController(instanceId, config);
      pendingCtrlIdRef.current = ctrlId;

      // 注册 ctrl_id 与设备名/类型的映射
      let deviceName = '';
      let targetType: 'device' | 'window' = 'device';
      if (savedDevice?.adbDeviceName) {
        deviceName = savedDevice.adbDeviceName;
        targetType = 'device';
      } else if (savedDevice?.windowName) {
        deviceName = savedDevice.windowName;
        targetType = 'window';
      } else if (savedDevice?.playcoverAddress) {
        deviceName = savedDevice.playcoverAddress;
        targetType = 'device';
      }
      registerCtrlIdName(ctrlId, deviceName, targetType);

      // 等待连接回调
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          log.warn('连接超时');
          pendingCtrlIdRef.current = null;
          resolve(false);
        }, 30000);

        maaService.onCallback((message, details) => {
          if (details.ctrl_id !== ctrlId) return;

          clearTimeout(timeout);
          pendingCtrlIdRef.current = null;

          if (message === 'Controller.Action.Succeeded') {
            log.info('设备连接成功');
            setInstanceConnectionStatus(instanceId, 'Connected');
            resolve(true);
          } else if (message === 'Controller.Action.Failed') {
            log.error('设备连接失败');
            setInstanceConnectionStatus(instanceId, 'Disconnected');
            resolve(false);
          }
        });
      });
    } catch (err) {
      log.error('自动连接设备失败:', err);
      throw err;
    }
  };

  /**
   * 自动加载资源
   */
  const autoLoadResource = async (): Promise<boolean> => {
    if (!currentResource) return false;

    setAutoConnectPhase('loading_resource');
    log.info('加载资源...');

    try {
      const resourcePaths = currentResource.path.map((p) => {
        const cleanPath = p.replace(/^\.\//, '').replace(/^\.\\/, '');
        return `${basePath}/${cleanPath}`;
      });

      const resIds = await maaService.loadResource(instanceId, resourcePaths);
      pendingResIdsRef.current = new Set(resIds);

      // 注册 res_id 与资源名的映射
      const resourceName = currentResource.label || currentResource.name;
      resIds.forEach((resId) => {
        registerResIdName(resId, resourceName);
      });

      // 等待资源加载回调
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          log.warn('资源加载超时');
          pendingResIdsRef.current = new Set();
          resolve(false);
        }, 60000);

        let remaining = new Set(resIds);

        maaService.onCallback((message, details) => {
          if (details.res_id === undefined || !remaining.has(details.res_id)) return;

          if (message === 'Resource.Loading.Succeeded') {
            remaining.delete(details.res_id);
            if (remaining.size === 0) {
              clearTimeout(timeout);
              pendingResIdsRef.current = new Set();
              log.info('资源加载成功');
              setInstanceResourceLoaded(instanceId, true);
              resolve(true);
            }
          } else if (message === 'Resource.Loading.Failed') {
            clearTimeout(timeout);
            pendingResIdsRef.current = new Set();
            log.error('资源加载失败');
            setInstanceResourceLoaded(instanceId, false);
            resolve(false);
          }
        });
      });
    } catch (err) {
      log.error('加载资源失败:', err);
      throw err;
    }
  };

  /**
   * 为指定实例启动任务（可由定时任务调用）
   * @param targetInstance 目标实例
   * @param schedulePolicyName 定时策略名称（可选，用于标记定时执行）
   * @returns 是否成功启动
   */
  const startTasksForInstance = useCallback(
    async (targetInstance: Instance, schedulePolicyName?: string): Promise<boolean> => {
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

      // 判断是否可以运行
      const canStartTask =
        (isTargetConnected && isTargetResourceLoaded) || (hasSavedDevice && resource);

      if (!canStartTask) {
        log.warn(`实例 ${targetInstance.name} 无法启动：未连接且没有保存的设备配置`);
        return false;
      }

      try {
        // 如果未连接，尝试自动连接
        if (!isTargetConnected && hasSavedDevice && controller && savedDevice) {
          log.info(`实例 ${targetInstance.name}: 自动连接设备...`);

          await ensureMaaInitialized();
          await maaService.createInstance(targetId).catch(() => {});

          let config: ControllerConfig | null = null;
          const controllerType = controller.type;

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
          } else if (
            (controllerType === 'Win32' || controllerType === 'Gamepad') &&
            savedDevice.windowName
          ) {
            const classRegex = controller.win32?.class_regex || controller.gamepad?.class_regex;
            const windowRegex = controller.win32?.window_regex || controller.gamepad?.window_regex;
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
          } else if (controllerType === 'PlayCover' && savedDevice.playcoverAddress) {
            config = {
              type: 'PlayCover',
              address: savedDevice.playcoverAddress,
            };
          }

          if (!config) {
            log.warn(`实例 ${targetInstance.name}: 无法构建控制器配置`);
            return false;
          }

          const ctrlId = await maaService.connectController(targetId, config);

          // 注册 ctrl_id 与设备名/类型的映射
          let deviceName = '';
          let targetType: 'device' | 'window' = 'device';
          if (savedDevice?.adbDeviceName) {
            deviceName = savedDevice.adbDeviceName;
            targetType = 'device';
          } else if (savedDevice?.windowName) {
            deviceName = savedDevice.windowName;
            targetType = 'window';
          } else if (savedDevice?.playcoverAddress) {
            deviceName = savedDevice.playcoverAddress;
            targetType = 'device';
          }
          registerCtrlIdName(ctrlId, deviceName, targetType);

          // 等待连接完成
          const connectResult = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 30000);
            maaService.onCallback((message, details) => {
              if (details.ctrl_id !== ctrlId) return;
              clearTimeout(timeout);
              if (message === 'Controller.Action.Succeeded') {
                setInstanceConnectionStatus(targetId, 'Connected');
                resolve(true);
              } else {
                resolve(false);
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

          const resourcePaths = resource.path.map((p) => {
            const cleanPath = p.replace(/^\.\//, '').replace(/^\.\\/, '');
            return `${basePath}/${cleanPath}`;
          });

          const resIds = await maaService.loadResource(targetId, resourcePaths);

          // 注册 res_id 与资源名的映射
          const resourceName = resource.label || resource.name;
          resIds.forEach((resId) => {
            registerResIdName(resId, resourceName);
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

        log.info(`实例 ${targetInstance.name}: 开始执行任务, 数量:`, enabledTasks.length);

        // 构建任务配置列表，同时预注册 entry -> taskName 映射（解决时序问题）
        const taskConfigs: TaskConfig[] = [];
        for (const selectedTask of enabledTasks) {
          const taskDef = projectInterface?.task.find((t) => t.name === selectedTask.taskName);
          if (!taskDef) continue;
          taskConfigs.push({
            entry: taskDef.entry,
            pipeline_override: generateTaskPipelineOverride(selectedTask, projectInterface),
          });
          // 预注册 entry -> taskName 映射，确保回调时能找到任务名
          const taskDisplayName =
            selectedTask.customName ||
            resolveI18nText(taskDef.label, translations) ||
            selectedTask.taskName;
          registerEntryTaskName(taskDef.entry, taskDisplayName);
        }

        if (taskConfigs.length === 0) {
          log.warn(`实例 ${targetInstance.name}: 没有可执行的任务`);
          return false;
        }

        // 准备 Agent 配置
        let agentConfig: AgentConfig | undefined;
        if (projectInterface?.agent) {
          agentConfig = {
            child_exec: projectInterface.agent.child_exec,
            child_args: projectInterface.agent.child_args,
            identifier: projectInterface.agent.identifier,
            timeout: projectInterface.agent.timeout,
          };
        }

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
        const taskIds = await maaService.startTasks(targetId, taskConfigs, agentConfig, basePath, tcpCompatMode);

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
            const taskDef = projectInterface?.task.find(
              (t) => t.name === enabledTasks[index].taskName,
            );
            const taskDisplayName =
              enabledTasks[index].customName ||
              resolveI18nText(taskDef?.label, translations) ||
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

        if (projectInterface?.agent) {
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

          // 启动任务（复用启动函数）
          const started = await startTasksForInstance(inst, policy.name);
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

  const handleStartStop = async () => {
    if (!instance) return;

    if (instance.isRunning) {
      // 停止任务
      try {
        log.info('停止任务...');
        setIsStopping(true);
        await maaService.stopTask(instance.id);
        // 如果配置了 agent，也停止 agent
        if (projectInterface?.agent) {
          await maaService.stopAgent(instance.id);
        }
        updateInstance(instance.id, { isRunning: false });
        setInstanceTaskStatus(instance.id, null);
        setInstanceCurrentTaskId(instance.id, null);
        // 清空任务运行状态和定时执行状态
        clearTaskRunStatus(instance.id);
        clearPendingTasks(instance.id);
        clearScheduleExecution(instance.id);
        runningInstanceIdRef.current = null;
      } catch (err) {
        log.error('停止任务失败:', err);
      } finally {
        setIsStopping(false);
      }
    } else {
      // 启动任务
      if (!canRun) {
        log.warn('无法运行任务：未连接或资源未加载，且没有保存的设备配置');
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
        // 如果未连接，尝试自动连接
        if (!isConnected && hasSavedDeviceConfig) {
          log.info('检测到保存的设备配置，尝试自动连接...');
          const connected = await autoConnectDevice();
          if (!connected) {
            throw new Error(t('taskList.autoConnect.connectFailed'));
          }
        }

        // 如果资源未加载，尝试自动加载
        if (!instanceResourceLoaded[instanceId] && currentResource) {
          log.info('资源未加载，尝试自动加载...');
          const loaded = await autoLoadResource();
          if (!loaded) {
            throw new Error(t('taskList.autoConnect.resourceFailed'));
          }
        }

        setAutoConnectPhase('idle');

        const enabledTasks = tasks.filter((t) => t.enabled);
        log.info('开始执行任务, 数量:', enabledTasks.length);

        // 构建任务配置列表，同时预注册 entry -> taskName 映射（解决时序问题）
        const taskConfigs: TaskConfig[] = [];
        for (const selectedTask of enabledTasks) {
          const taskDef = projectInterface?.task.find((t) => t.name === selectedTask.taskName);
          if (!taskDef) continue;

          taskConfigs.push({
            entry: taskDef.entry,
            pipeline_override: generateTaskPipelineOverride(selectedTask, projectInterface),
          });
          // 预注册 entry -> taskName 映射，确保回调时能找到任务名
          const taskDisplayName =
            selectedTask.customName ||
            resolveI18nText(taskDef.label, translations) ||
            selectedTask.taskName;
          registerEntryTaskName(taskDef.entry, taskDisplayName);
        }

        if (taskConfigs.length === 0) {
          log.warn('没有可执行的任务');
          setIsStarting(false);
          return;
        }

        // 准备 Agent 配置（如果有）
        let agentConfig: AgentConfig | undefined;
        if (projectInterface?.agent) {
          agentConfig = {
            child_exec: projectInterface.agent.child_exec,
            child_args: projectInterface.agent.child_args,
            identifier: projectInterface.agent.identifier,
            timeout: projectInterface.agent.timeout,
          };
        }

        updateInstance(instance.id, { isRunning: true });
        setInstanceTaskStatus(instance.id, 'Running');
        setShowAddTaskPanel(false);

        // 启动任务（支持 Agent）
        const taskIds = await maaService.startTasks(
          instance.id,
          taskConfigs,
          agentConfig,
          basePath,
          tcpCompatMode,
        );

        log.info('任务已提交, task_ids:', taskIds);

        // 初始化任务运行状态：所有启用的任务设为 pending
        const enabledTaskIds = enabledTasks.map((t) => t.id);
        setAllTasksRunStatus(instance.id, enabledTaskIds, 'pending');

        // 开始任务时折叠所有任务
        collapseAllTasks(instance.id, false);

        // 记录 maaTaskId -> selectedTaskId 的映射关系，并注册 task_id 与任务名的映射
        taskIds.forEach((maaTaskId, index) => {
          if (enabledTasks[index]) {
            registerMaaTaskMapping(instance.id, maaTaskId, enabledTasks[index].id);
            // 注册 task_id 与任务名的映射（使用自定义名称或 label）
            const taskDef = projectInterface?.task.find(
              (t) => t.name === enabledTasks[index].taskName,
            );
            const taskDisplayName =
              enabledTasks[index].customName ||
              resolveI18nText(taskDef?.label, translations) ||
              enabledTasks[index].taskName;
            registerTaskIdName(maaTaskId, taskDisplayName);
          }
        });

        // 第一个任务设为 running
        if (enabledTasks.length > 0) {
          setTaskRunStatus(instance.id, enabledTasks[0].id, 'running');
        }

        // 设置任务队列，由回调监听处理完成状态
        runningInstanceIdRef.current = instance.id;
        setPendingTaskIds(instance.id, taskIds);
        setCurrentTaskIndexStore(instance.id, 0);
        setInstanceCurrentTaskId(instance.id, taskIds[0]);
        setIsStarting(false);
      } catch (err) {
        log.error('任务启动异常:', err);
        setAutoConnectError(err instanceof Error ? err.message : String(err));
        setAutoConnectPhase('idle');
        // 出错时也尝试停止 Agent
        if (projectInterface?.agent) {
          try {
            await maaService.stopAgent(instance.id);
          } catch {
            // 忽略停止 agent 的错误
          }
        }
        updateInstance(instance.id, { isRunning: false });
        setInstanceTaskStatus(instance.id, 'Failed');
        // 清空任务运行状态
        clearTaskRunStatus(instance.id);
        clearPendingTasks(instance.id);
        setIsStarting(false);
      }
    }
  };

  // 监听来自 App 的全局快捷键事件：F10 开始任务，F11 结束任务
  useEffect(() => {
    const handleStartTasks = () => {
      // 始终复用现有的开始/停止逻辑，由 handleStartStop 内部判断是否可运行
      handleStartStop();
    };

    const handleStopTasks = () => {
      // 仅在当前实例正在运行时响应停止事件
      if (!instance?.isRunning) return;
      handleStartStop();
    };

    document.addEventListener('mxu-start-tasks', handleStartTasks);
    document.addEventListener('mxu-stop-tasks', handleStopTasks);

    return () => {
      document.removeEventListener('mxu-start-tasks', handleStartTasks);
      document.removeEventListener('mxu-stop-tasks', handleStopTasks);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.isRunning]);

  const isDisabled =
    tasks.length === 0 || !tasks.some((t) => t.enabled) || (!canRun && !instance?.isRunning);

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
    if (!canRun && !instance?.isRunning) {
      if (hasSavedDeviceConfig) {
        return undefined; // 有保存配置，可以自动连接
      }
      return t('taskList.autoConnect.needConfig');
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
        {(() => {
          const enabledCount = instance?.schedulePolicies?.filter((p) => p.enabled).length || 0;
          const scheduleExecution = instance ? scheduleExecutions[instance.id] : null;

          // 格式化开始时间
          const formatStartTime = (timestamp: number) => {
            const date = new Date(timestamp);
            return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          };

          return (
            <div className="relative">
              <button
                onClick={() => setShowSchedulePanel(!showSchedulePanel)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors relative',
                  scheduleExecution
                    ? 'bg-success text-white'
                    : showSchedulePanel
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
                title={
                  scheduleExecution
                    ? t('schedule.executingPolicy', { name: scheduleExecution.policyName })
                    : t('schedule.title')
                }
              >
                <Clock className={clsx('w-4 h-4', scheduleExecution && 'animate-pulse')} />
                <span className="hidden sm:inline">{t('schedule.button')}</span>
                {/* 启用数量徽章 */}
                {enabledCount > 0 && !showSchedulePanel && !scheduleExecution && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-accent text-white text-xs font-medium rounded-full">
                    {enabledCount}
                  </span>
                )}
              </button>

              {/* 定时执行状态气泡 */}
              {scheduleExecution && !showSchedulePanel && (
                <div
                  className={clsx(
                    'absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
                    'px-3 py-2 rounded-lg shadow-lg',
                    'bg-success text-white text-xs whitespace-nowrap',
                    'animate-fade-in',
                  )}
                >
                  <div className="font-medium">
                    {t('schedule.executingPolicy', { name: scheduleExecution.policyName })}
                  </div>
                  <div className="text-white/80 mt-0.5">
                    {t('schedule.startedAt', {
                      time: formatStartTime(scheduleExecution.startTime),
                    })}
                  </div>
                  {/* 气泡箭头 */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-success" />
                </div>
              )}
            </div>
          );
        })()}

        {/* 定时执行面板 */}
        {showSchedulePanel && instance && (
          <SchedulePanel instanceId={instance.id} onClose={() => setShowSchedulePanel(false)} />
        )}

        {/* 权限提示弹窗 */}
        {showPermissionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-bg-primary rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
              {/* 标题栏 */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-bg-secondary">
                <ShieldAlert className="w-5 h-5 text-warning" />
                <h3 className="font-medium text-text-primary">{t('permission.title')}</h3>
              </div>

              {/* 内容 */}
              <div className="px-5 py-4">
                <p className="text-text-secondary text-sm leading-relaxed">
                  {t('permission.message')}
                </p>
                <p className="text-text-muted text-xs mt-3">{t('permission.hint')}</p>
              </div>

              {/* 按钮 */}
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-bg-secondary">
                <button
                  onClick={() => setShowPermissionModal(false)}
                  disabled={isRestartingAsAdmin}
                  className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleRestartAsAdmin}
                  disabled={isRestartingAsAdmin}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    isRestartingAsAdmin
                      ? 'bg-accent/70 text-white cursor-wait'
                      : 'bg-accent hover:bg-accent-hover text-white',
                  )}
                >
                  {isRestartingAsAdmin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('permission.restarting')}</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-4 h-4" />
                      <span>{t('permission.restart')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

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
                    ? 'bg-bg-active text-text-muted cursor-not-allowed'
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
