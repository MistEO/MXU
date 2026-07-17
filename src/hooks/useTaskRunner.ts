import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/appStore';
import { isTaskCompatible } from '@/stores/helpers';
import { maaService } from '@/services/maaService';
import { loggers, generateTaskPipelineOverride, computeResourcePaths } from '@/utils';
import { getMxuSpecialTask } from '@/types/specialTasks';
import {
  isPretaskName,
  getPretaskItem,
  buildPretaskArgs,
  resolveCompatTaskDef,
} from '@/types/pretasks';
import { splitTasksIntoThreeSegments, shouldSkipScreenshot } from '@/utils/taskSegmentation';
import type { TaskConfig, ControllerConfig } from '@/types/maa';
import { normalizeAgentConfigs } from '@/types/interface';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';
import type { Instance, TaskItem, PretaskItem } from '@/types/interface';
import { resolveI18nText } from '@/services/contentResolver';
import { getInterfaceLangKey } from '@/i18n';
import {
  startGlobalCallbackListener,
  waitForResResult,
} from '@/components/connection/callbackCache';
import { stopInstanceTasks } from '@/services/taskStopService';
import { isTauri } from '@/utils/paths';
import { onStateChanged } from '@/services/wsService';
import { buildPiEnvVars } from '@/utils/piEnv';

const log = loggers.task;
const PRE_ACTION_CANCELLED_ERROR = 'MXU_PRE_ACTION_CANCELLED';

/** 自动连接阶段 */
export type AutoConnectPhase = 'idle' | 'searching' | 'connecting' | 'loading_resource';

export interface StartTasksOptions {
  /** 定时策略名称（定时执行时传入） */
  schedulePolicyName?: string;
  /** 自动连接阶段变化回调（用于 UI 状态更新） */
  onPhaseChange?: (phase: AutoConnectPhase) => void;
}

/**
 * 统一任务运行器：封装「连接前 / 连接中 / 连接后」三段式启动流程、前置程序控制与停止逻辑，
 * 供 Toolbar、DashboardView 等入口复用。
 */
export function useTaskRunner() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [isStopping, setIsStopping] = useState(false);
  const [preActionControlledInstanceId, setPreActionControlledInstanceId] = useState<string | null>(
    null,
  );
  const preActionControlledInstanceIdRef = useRef<string | null>(null);
  const preActionStopRequestedRef = useRef(false);
  const lastStartCancelledRef = useRef(false);

  const ensureMaaInitialized = useCallback(async () => {
    try {
      await maaService.getVersion();
      return true;
    } catch {
      await maaService.init();
      return true;
    }
  }, []);

  const beginPreActionControl = useCallback(async (targetInstanceId: string) => {
    await maaService.setPreActionStop(targetInstanceId, false);
    preActionControlledInstanceIdRef.current = targetInstanceId;
    preActionStopRequestedRef.current = false;
    setPreActionControlledInstanceId(targetInstanceId);
  }, []);

  const endPreActionControl = useCallback(async (targetInstanceId: string) => {
    if (preActionControlledInstanceIdRef.current === targetInstanceId) {
      preActionControlledInstanceIdRef.current = null;
      preActionStopRequestedRef.current = false;
      setPreActionControlledInstanceId((current) =>
        current === targetInstanceId ? null : current,
      );
    }
    try {
      await maaService.setPreActionStop(targetInstanceId, false);
    } catch (err) {
      log.warn('清理前置程序停止标记失败:', err);
    }
  }, []);

  const throwIfPreActionStopped = useCallback((targetInstanceId: string) => {
    if (
      preActionControlledInstanceIdRef.current === targetInstanceId &&
      preActionStopRequestedRef.current
    ) {
      throw new Error(PRE_ACTION_CANCELLED_ERROR);
    }
  }, []);

  const waitWithStopCheck = useCallback(
    async (totalMs: number, targetInstanceId: string) => {
      const intervalMs = 100;
      let elapsed = 0;
      while (elapsed < totalMs) {
        throwIfPreActionStopped(targetInstanceId);
        const sleepMs = Math.min(intervalMs, totalMs - elapsed);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        elapsed += sleepMs;
      }
      throwIfPreActionStopped(targetInstanceId);
    },
    [throwIfPreActionStopped],
  );

  /**
   * 停止任务的统一流程：复用公共 stop helper，保持各入口行为一致。
   */
  const performStop = useCallback(
    async (targetInstanceId: string) => {
      if (isStopping) return;
      setIsStopping(true);
      let keepStoppingForPreAction = false;
      try {
        if (preActionControlledInstanceIdRef.current === targetInstanceId) {
          preActionStopRequestedRef.current = true;
          try {
            await maaService.setPreActionStop(targetInstanceId, true);
            keepStoppingForPreAction = true;
          } catch (err) {
            preActionStopRequestedRef.current = false;
            log.error('发送前置程序停止请求失败:', err);
            throw err;
          }
          return;
        }
        const stopped = await stopInstanceTasks(targetInstanceId);
        if (!stopped) {
          log.warn('等待任务停止超时，保留运行状态以避免 UI 与实际不一致');
        }
      } finally {
        if (!keepStoppingForPreAction) {
          setIsStopping(false);
        }
      }
    },
    [isStopping],
  );

  const startTasksForInstance = useCallback(
    async (targetInstance: Instance, options?: StartTasksOptions): Promise<boolean> => {
      const { schedulePolicyName, onPhaseChange } = options || {};
      const targetId = targetInstance.id;
      const targetTasks = targetInstance.selectedTasks || [];
      lastStartCancelledRef.current = false;

      const t = tRef.current;
      const store = useAppStore.getState();
      const {
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
        setScheduleExecution,
        clearScheduleExecution,
        setShowAddTaskPanel,
        registerCtrlIdName,
        registerResIdName,
        registerResBatch,
        registerTaskIdName,
        registerEntryTaskName,
        addLog,
        clearLogs,
        collapseAllTasks,
        interfaceTranslations,
        language,
        maaVersion,
        tcpCompatMode,
        restoreBackendStates,
      } = store;

      const langKey = getInterfaceLangKey(language);
      const translations = interfaceTranslations[langKey];

      // 检查是否有启用的任务
      const enabledTasks = targetTasks.filter((tk) => tk.enabled);
      if (enabledTasks.length === 0) {
        log.warn(`实例 ${targetInstance.name} 没有启用的任务`);
        return false;
      }

      // 检查是否正在运行
      if (targetInstance.isRunning || preActionControlledInstanceIdRef.current === targetId) {
        log.warn(`实例 ${targetInstance.name} 正在运行中`);
        return false;
      }

      // 本次运行开始，清空上一轮遗留日志（任务结束断开时不再清空）
      clearLogs(targetId);

      // 获取控制器和资源配置
      const controllerName = selectedController[targetId] || projectInterface?.controller[0]?.name;
      const resourceName = selectedResource[targetId] || projectInterface?.resource[0]?.name;

      // 过滤掉不兼容当前控制器/资源的任务
      const compatibleTasks = enabledTasks.filter((tk) => {
        const taskDef = resolveCompatTaskDef(projectInterface, tk.taskName);
        return isTaskCompatible(taskDef, controllerName, resourceName);
      });

      // 如果有任务因不兼容被跳过，记录警告
      const compatibleTaskIds = new Set(compatibleTasks.map((tk) => tk.id));
      const skippedTasks = enabledTasks.filter((tk) => !compatibleTaskIds.has(tk.id));
      if (skippedTasks.length > 0) {
        log.warn(
          `实例 ${targetInstance.name}: ${t('taskList.tasksSkippedDueToIncompatibility', { count: skippedTasks.length })}`,
        );
        addLog(targetId, {
          type: 'warning',
          message: t('taskList.tasksSkippedDueToIncompatibility', { count: skippedTasks.length }),
        });
        skippedTasks.forEach((task) => {
          const taskDef = resolveCompatTaskDef(projectInterface, task.taskName);
          const taskLabel = taskDef?.label
            ? resolveI18nText(taskDef.label, translations)
            : task.taskName;

          const isControllerIncompatible =
            taskDef?.controller &&
            taskDef.controller.length > 0 &&
            controllerName &&
            !taskDef.controller.includes(controllerName);

          const isResourceIncompatible =
            taskDef?.resource &&
            taskDef.resource.length > 0 &&
            resourceName &&
            !taskDef.resource.includes(resourceName);

          if (isControllerIncompatible) {
            log.warn(`  - ${t('taskList.taskSkippedController', { taskName: taskLabel })}`);
          }
          if (isResourceIncompatible) {
            log.warn(`  - ${t('taskList.taskSkippedResource', { taskName: taskLabel })}`);
          }
        });
      }

      // 如果所有启用的任务都被过滤掉了，则无法启动
      if (compatibleTasks.length === 0) {
        log.warn(`实例 ${targetInstance.name}: ${t('taskList.noCompatibleTasks')}`);
        addLog(targetId, {
          type: 'error',
          message: t('taskList.noCompatibleTasks'),
        });
        return false;
      }

      const controller = projectInterface?.controller.find((c) => c.name === controllerName);
      const resource = projectInterface?.resource.find((r) => r.name === resourceName);
      const savedDevice = targetInstance.savedDevice;

      const hasSavedDevice = Boolean(
        savedDevice &&
        (savedDevice.adbDeviceName ||
          savedDevice.windowName ||
          savedDevice.wlrSocketPath ||
          savedDevice.playcoverAddress),
      );

      // 是否存在需要真机（视觉识别）的普通任务
      const hasNormalTasks = compatibleTasks.some((task) => !shouldSkipScreenshot(task.taskName));
      const shouldUseDummyController = !hasNormalTasks;

      if (shouldUseDummyController) {
        log.info(`实例 ${targetInstance.name}: 仅包含非视觉特殊任务，跳过截图/识别流程`);
      }

      const canUseSavedDevice = hasSavedDevice && savedDevice && hasNormalTasks;

      let isTargetConnected = instanceConnectionStatus[targetId] === 'Connected';
      const isTargetResourceLoaded = instanceResourceLoaded[targetId] || false;

      // 判断是否可以运行：无普通任务时只需资源；有普通任务时需要控制器/保存设备/已连接
      const canStartTask = hasNormalTasks
        ? (isTargetConnected && isTargetResourceLoaded) ||
          (hasSavedDevice && resource) ||
          (controller && resource)
        : Boolean(resource);

      if (!canStartTask) {
        log.warn(`实例 ${targetInstance.name} 无法启动：未连接且没有可用的控制器或资源配置`);
        return false;
      }

      // Agent 配置与环境变量（一次性构建）
      const agentConfigs = normalizeAgentConfigs(projectInterface?.agent);
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

      try {
        let needsReconnect = false;
        let shouldDelayAfterAdbConnected = false;

        // ============ 连接前：pretask（外部程序，先于前置程序） ============
        const enabledPretasks = compatibleTasks
          .filter((task) => isPretaskName(task.taskName))
          .map((task) => ({ task, item: getPretaskItem(projectInterface, task.taskName) }))
          .filter((p): p is { task: (typeof compatibleTasks)[0]; item: PretaskItem } => !!p.item);

        if (enabledPretasks.length > 0) {
          await beginPreActionControl(targetId);
          try {
            for (const { task, item } of enabledPretasks) {
              const args = buildPretaskArgs(
                item,
                task.optionValues ?? {},
                projectInterface,
                controllerName,
                resourceName,
              );
              const displayName =
                resolveI18nText(item.label, translations) || item.name || item.exec;

              log.info(`实例 ${targetInstance.name}: 执行预任务:`, item.exec, args);
              addLog(targetId, {
                type: 'info',
                message: t('action.pretaskStarting', { name: displayName }),
              });

              throwIfPreActionStopped(targetId);
              const exitCode = await maaService.runPretask(targetId, item.exec, args, basePath);
              throwIfPreActionStopped(targetId);

              if (exitCode !== 0) {
                log.warn(`实例 ${targetInstance.name}: 预任务退出码非零:`, exitCode);
                addLog(targetId, {
                  type: 'warning',
                  message: t('action.pretaskExitCode', { code: exitCode }),
                });
              } else {
                addLog(targetId, {
                  type: 'success',
                  message: t('action.pretaskCompleted', { name: displayName }),
                });
              }
            }
          } catch (err) {
            if ((err instanceof Error ? err.message : String(err)) === PRE_ACTION_CANCELLED_ERROR) {
              throw err;
            }
            log.error(`实例 ${targetInstance.name}: 预任务执行失败:`, err);
            addLog(targetId, {
              type: 'error',
              message: t('action.pretaskFailed', { error: String(err) }),
            });
          } finally {
            await endPreActionControl(targetId);
          }
        }

        // ============ 连接前：前置程序（外部程序） ============
        const allPreActions = (targetInstance.preActions ?? []).filter(
          (a) => a.enabled && a.program.trim(),
        );
        let preActionControlStarted = false;

        if (allPreActions.length > 0) {
          preActionControlStarted = true;
          await beginPreActionControl(targetId);

          try {
            for (const preAction of allPreActions) {
              const programPath = preAction.program.trim();
              const processName = programPath.split(/[/\\]/).pop() || programPath;

              if (preAction.skipIfRunning) {
                if (await maaService.isProcessRunning(programPath)) {
                  log.info(`实例 ${targetInstance.name}: 前置程序已在运行，跳过执行:`, processName);
                  addLog(targetId, {
                    type: 'info',
                    message: t('action.preActionSkipped', { name: processName }),
                  });
                  continue;
                }
              }

              log.info(`实例 ${targetInstance.name}: 执行前置动作:`, programPath);
              addLog(targetId, {
                type: 'info',
                message: t('action.preActionStartingNamed', { name: processName }),
              });

              throwIfPreActionStopped(targetId);
              const exitCode = await maaService.runAction(
                targetId,
                programPath,
                preAction.args,
                basePath,
                preAction.waitForExit ?? true,
                preAction.useCmd ?? false,
              );
              throwIfPreActionStopped(targetId);

              if (exitCode !== 0) {
                log.warn(`实例 ${targetInstance.name}: 前置动作退出码非零:`, exitCode);
                addLog(targetId, {
                  type: 'warning',
                  message: t('action.preActionExitCode', { code: exitCode }),
                });
              } else {
                addLog(targetId, {
                  type: 'success',
                  message: t('action.preActionCompletedNamed', { name: processName }),
                });
              }
            }

            // 所有前置程序执行完毕后，等待设备/窗口就绪再连接（仅在需要真机时）
            const shouldWaitAfterPreActions = !!controller && hasNormalTasks;
            if (shouldWaitAfterPreActions && controller) {
              const controllerType = controller.type;
              const isWindowType = controllerType === 'Win32' || controllerType === 'Gamepad';
              log.info(`实例 ${targetInstance.name}: 等待${isWindowType ? '窗口' : '设备'}就绪...`);
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
              const maxAttempts = 300;

              while (!deviceFound && attempts < maxAttempts) {
                throwIfPreActionStopped(targetId);
                try {
                  if (controllerType === 'Adb') {
                    const devices = await maaService.findAdbDevices();
                    if (savedDevice?.adbDeviceName) {
                      deviceFound = devices.some((d) => d.name === savedDevice.adbDeviceName);
                    } else {
                      deviceFound = devices.length > 0;
                    }
                  } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
                    const classRegex =
                      controller.win32?.class_regex || controller.gamepad?.class_regex;
                    const windowRegex =
                      controller.win32?.window_regex || controller.gamepad?.window_regex;
                    const windows = await maaService.findWin32Windows(classRegex, windowRegex);
                    if (savedDevice?.windowName) {
                      deviceFound = windows.some((w) => w.window_name === savedDevice.windowName);
                    } else {
                      deviceFound = windows.length > 0;
                    }
                  } else if (controllerType === 'WlRoots') {
                    const sockets = await maaService.findWlrootsSockets();
                    if (savedDevice?.wlrSocketPath) {
                      deviceFound = sockets.includes(savedDevice.wlrSocketPath);
                    } else {
                      deviceFound = sockets.length > 0;
                    }
                  } else {
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
                  await waitWithStopCheck(1000, targetId);
                }
              }

              if (deviceFound) {
                log.info(`实例 ${targetInstance.name}: ${isWindowType ? '窗口' : '设备'}已就绪`);
                addLog(targetId, {
                  type: 'success',
                  message: isWindowType ? t('action.windowReady') : t('action.deviceReady'),
                });
                if (
                  !savedDevice?.windowName &&
                  !savedDevice?.adbDeviceName &&
                  !savedDevice?.wlrSocketPath &&
                  !savedDevice?.playcoverAddress
                ) {
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

                needsReconnect = true;
                const settleSec = useAppStore.getState().preActionConnectDelaySec ?? 5;
                if (settleSec > 0) {
                  log.info(
                    `实例 ${targetInstance.name}: ${isWindowType ? '窗口' : '设备'}已就绪，等待 ${settleSec} 秒稳定后连接...`,
                  );
                  await waitWithStopCheck(settleSec * 1000, targetId);
                }
                shouldDelayAfterAdbConnected = true;
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
            if ((err instanceof Error ? err.message : String(err)) === PRE_ACTION_CANCELLED_ERROR) {
              throw err;
            }
            log.error(`实例 ${targetInstance.name}: 前置动作执行失败:`, err);
            addLog(targetId, {
              type: 'error',
              message: t('action.preActionFailed', { error: String(err) }),
            });
          } finally {
            if (preActionControlStarted) {
              await endPreActionControl(targetId);
            }
          }
        }

        // 前置程序重启了应用，旧连接已失效，重置连接状态以强制重新连接
        if (needsReconnect && isTargetConnected) {
          log.info(`实例 ${targetInstance.name}: 前置程序已重启应用，重置连接状态以重新连接`);
          setInstanceConnectionStatus(targetId, 'Disconnected');
          isTargetConnected = false;
        }

        // 查询后端真实连接状态，纠正前端可能过时的缓存
        if (isTargetConnected && !needsReconnect && hasNormalTasks) {
          const backendState = await maaService.getInstanceState(targetId);
          if (!backendState || backendState.connectionStatus !== 'Connected') {
            log.warn(
              `实例 ${targetInstance.name}: 后端${backendState ? '连接已断开' : '实例不存在'}，但前端缓存为已连接，强制重新连接`,
            );
            setInstanceConnectionStatus(targetId, 'Disconnected');
            isTargetConnected = false;
          }
        }

        await ensureMaaInitialized();
        await maaService.createInstance(targetId).catch((err) => {
          log.warn('创建实例失败（可能已存在）:', err);
        });

        // 已连接真机（手动预连接）且无需重连时可复用
        let realControllerReady = isTargetConnected && !needsReconnect && hasNormalTasks;
        let resourceEnsured = false;

        // -------- 内部 helper：连接真机控制器 --------
        const connectRealController = async (): Promise<boolean> => {
          if (realControllerReady) return true;
          const controllerType = controller?.type;

          let config: ControllerConfig | null = null;
          let deviceName = '';
          let targetType: 'device' | 'window' = 'device';

          if (canUseSavedDevice && savedDevice && controllerType) {
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
                display_short_side: controller.display_short_side,
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
                  display_short_side: controller.display_short_side,
                };
              } else {
                config = {
                  type: 'Gamepad',
                  handle: matchedWindow.handle,
                  display_short_side: controller.display_short_side,
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
                use_win32_vk_code: controller.wlroots?.use_win32_vk_code ?? false,
              };
              deviceName = savedDevice.wlrSocketPath;
              targetType = 'device';
            } else if (controllerType === 'PlayCover' && savedDevice.playcoverAddress) {
              config = {
                type: 'PlayCover',
                address: savedDevice.playcoverAddress,
                display_short_side: controller.display_short_side,
              };
              deviceName = savedDevice.playcoverAddress;
              targetType = 'device';
            }
          } else if (controllerType) {
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
                display_short_side: controller.display_short_side,
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
                  display_short_side: controller.display_short_side,
                };
              } else {
                config = {
                  type: 'Gamepad',
                  handle: firstWindow.handle,
                  display_short_side: controller.display_short_side,
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
                use_win32_vk_code: controller.wlroots?.use_win32_vk_code ?? false,
              };
              deviceName = firstSocket;
              targetType = 'device';
            } else if (controllerType === 'PlayCover') {
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

          const maxRetries = 3;
          let connectResult = false;

          for (let retry = 0; retry < maxRetries && !connectResult; retry++) {
            if (retry > 0) {
              throwIfPreActionStopped(targetId);
              log.info(`实例 ${targetInstance.name}: 连接失败，第 ${retry} 次重试...`);
              addLog(targetId, {
                type: 'info',
                message: t('taskList.autoConnect.retryConnect', { attempt: retry }),
              });
              await waitWithStopCheck(2000, targetId);
            }

            const collectedCallbacks: Array<{ message: string; details: { ctrl_id?: number } }> =
              [];
            const unsubscribe = await maaService.onCallback((message, details) => {
              if (
                message === 'Controller.Action.Succeeded' ||
                message === 'Controller.Action.Failed'
              ) {
                collectedCallbacks.push({ message, details });
              }
            });

            let ctrlId: number;
            try {
              ctrlId = await maaService.connectController(targetId, config);
            } catch (err) {
              unsubscribe();
              throw err;
            }

            registerCtrlIdName(targetId, ctrlId, deviceName, targetType);

            connectResult = await new Promise<boolean>((resolve) => {
              let resolved = false;

              const handleSuccess = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                unsubscribe();
                unlistenCb?.();
                unlistenState?.();
                setInstanceConnectionStatus(targetId, 'Connected');
                resolve(true);
              };

              const handleFailure = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                unsubscribe();
                unlistenCb?.();
                unlistenState?.();
                resolve(false);
              };

              const timeout = setTimeout(() => {
                if (!resolved) {
                  log.warn(`实例 ${targetInstance.name}: 连接超时`);
                  handleFailure();
                }
              }, 30000);

              let unlistenCb: (() => void) | undefined;
              let unlistenState: (() => void) | undefined;

              const match = collectedCallbacks.find((cb) => cb.details.ctrl_id === ctrlId);
              if (match) {
                if (match.message === 'Controller.Action.Succeeded') {
                  handleSuccess();
                } else {
                  handleFailure();
                }
                return;
              }

              maaService
                .onCallback((message, details) => {
                  if (resolved) return;
                  if (details.ctrl_id !== ctrlId) return;
                  if (message === 'Controller.Action.Succeeded') {
                    handleSuccess();
                  } else if (message === 'Controller.Action.Failed') {
                    handleFailure();
                  }
                })
                .then((cb) => {
                  if (!resolved) {
                    unlistenCb = cb;
                  } else {
                    cb();
                  }
                })
                .catch((err) => {
                  log.error(`实例 ${targetInstance.name}: 注册 maa-callback 监听失败:`, err);
                  handleFailure();
                });
              const handleStateChanged = (instanceId: string, kind: string) => {
                if (resolved) return;
                if (instanceId === targetId && kind === 'connected') {
                  log.info(`实例 ${targetInstance.name}: 通过 state-changed 兜底判定连接成功`);
                  handleSuccess();
                }
              };

              if (isTauri()) {
                import('@tauri-apps/api/event')
                  .then(({ listen }) =>
                    listen<{ instance_id: string; kind: string }>('state-changed', (event) =>
                      handleStateChanged(event.payload.instance_id, event.payload.kind),
                    ),
                  )
                  .then((dispose) => {
                    if (resolved) dispose();
                    else unlistenState = dispose;
                  })
                  .catch((err) => {
                    log.warn('注册 state-changed 监听失败:', err);
                  });
              } else {
                unlistenState = onStateChanged(handleStateChanged);
              }
            });
          }

          if (!connectResult) {
            log.warn(`实例 ${targetInstance.name}: 连接设备失败（已重试 ${maxRetries - 1} 次）`);
            return false;
          }

          if (shouldDelayAfterAdbConnected) {
            const delaySec = useAppStore.getState().preActionConnectDelaySec ?? 5;
            if (delaySec > 0) {
              log.info(`实例 ${targetInstance.name}: 连接成功，等待 ${delaySec} 秒后继续...`);
              addLog(targetId, {
                type: 'info',
                message: t('action.preActionConnectDelay', { seconds: delaySec }),
              });
              await waitWithStopCheck(delaySec * 1000, targetId);
            }
          }

          realControllerReady = true;
          return true;
        };

        // -------- 内部 helper：连接 Dummy 空控制器（释放真机） --------
        const connectDummyController = async (): Promise<boolean> => {
          onPhaseChange?.('connecting');
          log.info(`实例 ${targetInstance.name}: 连接 Dummy Controller`);
          const dummyCtrlId = await maaService.connectController(targetId, {
            type: 'Dummy',
            display_short_side: controller?.display_short_side,
          });
          registerCtrlIdName(targetId, dummyCtrlId, 'MXU Dummy Controller', 'device');
          setInstanceConnectionStatus(targetId, 'Connected');
          realControllerReady = false;
          return true;
        };

        // -------- 内部 helper：确保资源已加载（幂等） --------
        const ensureResourceLoaded = async (): Promise<boolean> => {
          if (resourceEnsured) return true;

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

          if (!isResourceReallyLoaded && resource) {
            log.info(`实例 ${targetInstance.name}: 加载资源...`);
            onPhaseChange?.('loading_resource');

            const resourcePaths = computeResourcePaths(resource, controller, basePath);
            const resIds = await maaService.loadResource(targetId, resourcePaths);

            const resDisplayName = resolveI18nText(resource.label, translations) || resource.name;
            registerResBatch(resIds);
            resIds.forEach((resId) => {
              registerResIdName(resId, resDisplayName);
            });

            const results = await Promise.all(
              resIds.map((resId) => waitForResResult(resId, 60000)),
            );
            const loadResult = results.every((r) => r === 'succeeded');
            if (loadResult) {
              setInstanceResourceLoaded(targetId, true);
            } else {
              log.warn(`实例 ${targetInstance.name}: 资源加载失败`);
              return false;
            }
          }

          resourceEnsured = true;
          return true;
        };

        // -------- 内部 helper：彻底断开连接 --------
        const disconnectInstance = async (): Promise<void> => {
          try {
            await maaService.destroyInstance(targetId);
          } catch (err) {
            log.warn(`实例 ${targetInstance.name}: 断开连接时销毁实例失败:`, err);
          }
          setInstanceConnectionStatus(targetId, 'Disconnected');
          setInstanceResourceLoaded(targetId, false);
        };

        // ============ 构建可运行任务列表并切分三段 ============
        interface RunnableTask {
          taskName: string;
          selectedTask: (typeof compatibleTasks)[0];
          taskDef: NonNullable<ReturnType<typeof getMxuSpecialTask>>['taskDef'] | TaskItem;
          specialTask: ReturnType<typeof getMxuSpecialTask>;
        }
        const runnableTasks: RunnableTask[] = [];
        for (const selectedTask of compatibleTasks) {
          // pretask 不进入 Tasker 队列，已在连接 Controller 前单独执行
          if (isPretaskName(selectedTask.taskName)) {
            continue;
          }
          const specialTask = getMxuSpecialTask(selectedTask.taskName);
          const taskDef =
            specialTask?.taskDef ||
            projectInterface?.task.find((tk) => tk.name === selectedTask.taskName);
          if (!taskDef) {
            log.warn(`跳过任务 ${selectedTask.taskName}: 未找到任务定义`);
            continue;
          }
          runnableTasks.push({
            taskName: selectedTask.taskName,
            selectedTask,
            taskDef,
            specialTask,
          });
        }

        if (runnableTasks.length === 0) {
          log.warn(`实例 ${targetInstance.name}: 没有可执行的任务`);
          return false;
        }

        const { leading, middle, trailing } = splitTasksIntoThreeSegments(runnableTasks);

        log.info(
          `实例 ${targetInstance.name}: 开始执行任务, 数量: ${runnableTasks.length}, 分段: ${[
            `连接前:${leading.length}`,
            `连接中:${middle.length}`,
            `连接后:${trailing.length}`,
          ].join(', ')}`,
        );

        const buildTaskConfigs = (batchTasks: RunnableTask[]): TaskConfig[] =>
          batchTasks.map(({ selectedTask, taskDef, specialTask }) => {
            const taskDisplayName =
              selectedTask.customName ||
              (specialTask && taskDef.label
                ? t(taskDef.label)
                : resolveI18nText(taskDef.label, translations)) ||
              selectedTask.taskName;
            registerEntryTaskName(taskDef.entry, taskDisplayName);

            return {
              entry: taskDef.entry,
              pipeline_override: generateTaskPipelineOverride(
                selectedTask,
                projectInterface,
                controllerName,
                resourceName,
                useAppStore.getState().globalOptionValues,
              ),
              selected_task_id: selectedTask.id,
            };
          });

        const startedTaskIds: number[] = [];
        let firstBatch = true;

        const submitBatch = async (batchTasks: RunnableTask[], batchName: string) => {
          const resetState = firstBatch;
          if (firstBatch) {
            // 首个批次提交前统一初始化运行态
            updateInstance(targetId, { isRunning: true });
            setInstanceTaskStatus(targetId, 'Running');
            setShowAddTaskPanel(false);
            collapseAllTasks(targetId, false);
            if (schedulePolicyName) {
              setScheduleExecution(targetId, {
                policyName: schedulePolicyName,
                startTime: Date.now(),
              });
            }
            // 任务可能在 startTasks 返回前就瞬时结束，先启动全局回调缓存再提交。
            await startGlobalCallbackListener();
            onPhaseChange?.('idle');
          }

          const batchTaskIds = await maaService.startTasks(
            targetId,
            buildTaskConfigs(batchTasks),
            agentConfigs,
            basePath,
            tcpCompatMode,
            piEnvs,
            resetState,
          );
          firstBatch = false;

          log.info(`实例 ${targetInstance.name}: ${batchName}任务已提交, task_ids:`, batchTaskIds);

          batchTaskIds.forEach((maaTaskId, index) => {
            const runnable = batchTasks[index];
            if (runnable) {
              const { selectedTask, taskDef, specialTask } = runnable;
              const taskDisplayName =
                selectedTask.customName ||
                (specialTask && taskDef.label
                  ? t(taskDef.label)
                  : resolveI18nText(taskDef.label, translations)) ||
                selectedTask.taskName;
              registerTaskIdName(maaTaskId, taskDisplayName);
            }
          });

          startedTaskIds.push(...batchTaskIds);
          return batchTaskIds;
        };

        // 段执行结果：ok=完成可继续，stopped=用户停止，failed=异常终止
        type PhaseResult = 'ok' | 'skip' | 'stopped' | 'failed';

        const runPhase = async (
          batchTasks: RunnableTask[],
          useDummy: boolean,
          batchName: string,
        ): Promise<PhaseResult> => {
          if (batchTasks.length === 0) return 'skip';

          if (useDummy) {
            await connectDummyController();
          } else if (!(await connectRealController())) {
            return 'failed';
          }

          if (!(await ensureResourceLoaded())) {
            return 'failed';
          }

          const ids = await submitBatch(batchTasks, batchName);
          if (ids.length === 0) return 'ok';

          const result = await maaService.waitForTasks(targetId, ids);
          if (result.stopped) return 'stopped';
          if (!result.allDone) return 'failed';
          return 'ok';
        };

        // ============ 三段式编排 ============
        const phases: Array<{ tasks: RunnableTask[]; dummy: boolean; name: string }> = [
          { tasks: leading, dummy: true, name: '连接前' },
          { tasks: middle, dummy: false, name: '连接中' },
          { tasks: trailing, dummy: true, name: '连接后' },
        ];

        for (const phase of phases) {
          const result = await runPhase(phase.tasks, phase.dummy, phase.name);
          if (result === 'stopped') {
            // 用户停止：清理由停止流程负责
            return false;
          }
          if (result === 'failed') {
            log.warn(`实例 ${targetInstance.name}: ${phase.name}段未正常结束`);
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
            setInstanceCurrentTaskId(targetId, null);
            clearScheduleExecution(targetId);
            return false;
          }
        }

        // ============ 运行结束：同步最终状态后彻底断开连接 ============
        log.info(`实例 ${targetInstance.name}: 任务全部完成, task_ids:`, startedTaskIds);
        try {
          const finalStates = await maaService.getAllStates();
          if (finalStates) {
            restoreBackendStates(finalStates);
          }
        } catch (err) {
          log.warn(`实例 ${targetInstance.name}: 断开前同步最终状态失败:`, err);
        }

        await disconnectInstance();
        updateInstance(targetId, { isRunning: false });
        setInstanceCurrentTaskId(targetId, null);

        return true;
      } catch (err) {
        log.error(`实例 ${targetInstance.name}: 任务启动异常:`, err);

        const errMsg = err instanceof Error ? err.message : String(err);
        const cancelled = errMsg === PRE_ACTION_CANCELLED_ERROR;
        if (!cancelled) {
          const localizedErrMsg = errMsg
            .replace(
              ' [[hint:spawn_file_not_found]]',
              ` ${t('taskList.autoConnect.agentSpawnHintFileNotFound')}`,
            )
            .replace(
              ' [[hint:spawn_app_control]]',
              ` ${t('taskList.autoConnect.agentSpawnHintAppControl')}`,
            );
          addLog(targetId, {
            type: 'error',
            message: `${t('taskList.autoConnect.startFailed')}: ${localizedErrMsg}`,
          });
        }

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
        setInstanceTaskStatus(targetId, cancelled ? null : 'Failed');
        setInstanceCurrentTaskId(targetId, null);
        clearScheduleExecution(targetId);
        if (cancelled) {
          lastStartCancelledRef.current = true;
          setIsStopping(false);
        }

        return false;
      }
    },
    [
      beginPreActionControl,
      endPreActionControl,
      ensureMaaInitialized,
      throwIfPreActionStopped,
      waitWithStopCheck,
    ],
  );

  return {
    startTasksForInstance,
    performStop,
    isStopping,
    setIsStopping,
    preActionControlledInstanceId,
    lastStartCancelledRef,
  };
}
