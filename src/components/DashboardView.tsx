import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutGrid,
  Monitor,
  Play,
  Pause,
  RefreshCw,
  Download,
  Unplug,
  Maximize2,
  Copy,
  X,
  Wifi,
  WifiOff,
  CheckCircle,
  Loader2,
  StopCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import { FrameRateSelector, getFrameInterval } from './FrameRateSelector';
import { resolveI18nText } from '@/services/contentResolver';
import { loggers, generateTaskPipelineOverride } from '@/utils';
import type { TaskConfig, AgentConfig } from '@/types/maa';
import { getInterfaceLangKey } from '@/i18n';

const log = loggers.ui;

interface InstanceCardProps {
  instanceId: string;
  instanceName: string;
  isActive: boolean;
  onSelect: () => void;
}

function InstanceCard({ instanceId, instanceName, isActive, onSelect }: InstanceCardProps) {
  const { t } = useTranslation();
  const {
    instances,
    instanceConnectionStatus,
    instanceTaskStatus,
    instanceScreenshotStreaming,
    setInstanceScreenshotStreaming,
    setInstanceConnectionStatus,
    projectInterface,
    selectedController,
    selectedResource,
    interfaceTranslations,
    language,
    instanceTaskRunStatus,
    instanceResourceLoaded,
    resolveI18nText: storeResolveI18nText,
    // 任务控制相关
    updateInstance,
    setInstanceTaskStatus,
    setInstanceCurrentTaskId,
    setAllTasksRunStatus,
    registerMaaTaskMapping,
    setTaskRunStatus,
    clearTaskRunStatus,
    setPendingTaskIds,
    setCurrentTaskIndex,
    clearPendingTasks,
    basePath,
    registerTaskIdName,
    registerEntryTaskName,
    screenshotFrameRate,
    setShowAddTaskPanel,
    tcpCompatMode,
  } = useAppStore();

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const streamingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const frameIntervalRef = useRef(getFrameInterval(screenshotFrameRate));
  const runningInstanceIdRef = useRef<string | null>(null);

  // 帧率配置变化时更新帧间隔
  useEffect(() => {
    frameIntervalRef.current = getFrameInterval(screenshotFrameRate);
  }, [screenshotFrameRate]);

  const connectionStatus = instanceConnectionStatus[instanceId];
  const taskStatus = instanceTaskStatus[instanceId];
  const isStreaming = instanceScreenshotStreaming[instanceId] ?? false;
  const isConnected = connectionStatus === 'Connected';
  const isResourceLoaded = instanceResourceLoaded[instanceId] || false;

  // 获取当前实例
  const instance = instances.find((i) => i.id === instanceId);
  const isRunning = instance?.isRunning || false;
  const tasks = instance?.selectedTasks || [];
  const enabledTasks = tasks.filter((t) => t.enabled);
  const canRun = isConnected && isResourceLoaded && enabledTasks.length > 0;

  // 获取连接状态信息
  const getStatusInfo = useCallback(() => {
    const controllers = projectInterface?.controller || [];
    const resources = projectInterface?.resource || [];
    const currentControllerName = selectedController[instanceId] || controllers[0]?.name;
    const currentResourceName = selectedResource[instanceId] || resources[0]?.name;
    const currentController = controllers.find((c) => c.name === currentControllerName);
    const currentResource = resources.find((r) => r.name === currentResourceName);

    // 获取设备名称
    const savedDevice = instance?.savedDevice;
    let deviceName = '';
    if (savedDevice?.adbDeviceName) {
      deviceName = savedDevice.adbDeviceName;
    } else if (savedDevice?.windowName) {
      deviceName = savedDevice.windowName;
    } else if (savedDevice?.playcoverAddress) {
      deviceName = savedDevice.playcoverAddress;
    }

    const controllerLabel = currentController
      ? resolveI18nText(currentController.label, translations) || currentController.name
      : '';
    const resourceLabel = currentResource
      ? resolveI18nText(currentResource.label, translations) || currentResource.name
      : '';

    return { controllerLabel, resourceLabel, deviceName };
  }, [projectInterface, selectedController, selectedResource, instance, instanceId, translations]);

  const statusInfo = getStatusInfo();

  // 获取当前正在运行的任务名称
  const getRunningTaskName = useCallback(() => {
    if (!instance?.isRunning) return null;

    const taskRunStatus = instanceTaskRunStatus[instanceId];
    if (!taskRunStatus) return null;

    // 找到状态为 running 的任务
    const runningTaskId = Object.entries(taskRunStatus).find(
      ([, status]) => status === 'running',
    )?.[0];

    if (!runningTaskId) return null;

    // 找到对应的 selectedTask
    const selectedTask = instance.selectedTasks.find((t) => t.id === runningTaskId);
    if (!selectedTask) return null;

    // 如果有自定义名称，使用自定义名称
    if (selectedTask.customName) return selectedTask.customName;

    // 否则从 projectInterface 获取任务的显示名称
    const taskDef = projectInterface?.task.find((t) => t.name === selectedTask.taskName);
    if (taskDef) {
      return storeResolveI18nText(taskDef.label, langKey) || taskDef.name;
    }

    return selectedTask.taskName;
  }, [
    instance,
    instanceId,
    instanceTaskRunStatus,
    projectInterface,
    storeResolveI18nText,
    langKey,
  ]);

  const runningTaskName = getRunningTaskName();

  // 启动/停止任务
  const handleStartStop = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();

      if (!instance || (!canRun && !isRunning)) return;

      if (isRunning) {
        // 停止任务
        try {
          log.info(`[${instanceName}] 停止任务...`);
          setIsStopping(true);
          await maaService.stopTask(instanceId);
          if (projectInterface?.agent) {
            await maaService.stopAgent(instanceId);
          }
          updateInstance(instanceId, { isRunning: false });
          setInstanceTaskStatus(instanceId, null);
          setInstanceCurrentTaskId(instanceId, null);
          clearTaskRunStatus(instanceId);
          clearPendingTasks(instanceId);
          runningInstanceIdRef.current = null;
        } catch (err) {
          log.error(`[${instanceName}] 停止任务失败:`, err);
        } finally {
          setIsStopping(false);
        }
      } else {
        // 启动任务
        if (!canRun) return;

        setIsStarting(true);

        try {
          log.info(`[${instanceName}] 开始执行任务, 数量:`, enabledTasks.length);

          // 构建任务配置列表
          const taskConfigs: TaskConfig[] = [];
          for (const selectedTask of enabledTasks) {
            const taskDef = projectInterface?.task.find((t) => t.name === selectedTask.taskName);
            if (!taskDef) continue;

            taskConfigs.push({
              entry: taskDef.entry,
              pipeline_override: generateTaskPipelineOverride(selectedTask, projectInterface),
            });
            const taskDisplayName =
              selectedTask.customName ||
              resolveI18nText(taskDef.label, translations) ||
              selectedTask.taskName;
            registerEntryTaskName(taskDef.entry, taskDisplayName);
          }

          if (taskConfigs.length === 0) {
            log.warn(`[${instanceName}] 没有可执行的任务`);
            setIsStarting(false);
            return;
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

          updateInstance(instanceId, { isRunning: true });
          setInstanceTaskStatus(instanceId, 'Running');
          setShowAddTaskPanel(false);

          // 启动任务
          const taskIds = await maaService.startTasks(
            instanceId,
            taskConfigs,
            agentConfig,
            basePath,
            tcpCompatMode,
          );

          log.info(`[${instanceName}] 任务已提交, task_ids:`, taskIds);

          // 初始化任务运行状态
          const enabledTaskIds = enabledTasks.map((t) => t.id);
          setAllTasksRunStatus(instanceId, enabledTaskIds, 'pending');

          // 记录映射关系
          taskIds.forEach((maaTaskId, index) => {
            if (enabledTasks[index]) {
              registerMaaTaskMapping(instanceId, maaTaskId, enabledTasks[index].id);
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
            setTaskRunStatus(instanceId, enabledTasks[0].id, 'running');
          }

          // 设置任务队列
          runningInstanceIdRef.current = instanceId;
          setPendingTaskIds(instanceId, taskIds);
          setCurrentTaskIndex(instanceId, 0);
          setInstanceCurrentTaskId(instanceId, taskIds[0]);
          setIsStarting(false);
        } catch (err) {
          log.error(`[${instanceName}] 任务启动异常:`, err);
          if (projectInterface?.agent) {
            try {
              await maaService.stopAgent(instanceId);
            } catch {
              // 忽略
            }
          }
          updateInstance(instanceId, { isRunning: false });
          setInstanceTaskStatus(instanceId, 'Failed');
          clearTaskRunStatus(instanceId);
          clearPendingTasks(instanceId);
          setIsStarting(false);
        }
      }
    },
    [
      instance,
      instanceId,
      instanceName,
      isRunning,
      canRun,
      enabledTasks,
      projectInterface,
      basePath,
      updateInstance,
      setInstanceTaskStatus,
      setInstanceCurrentTaskId,
      clearTaskRunStatus,
      clearPendingTasks,
      setAllTasksRunStatus,
      registerMaaTaskMapping,
      setTaskRunStatus,
      setPendingTaskIds,
      setCurrentTaskIndex,
      registerTaskIdName,
      registerEntryTaskName,
      setShowAddTaskPanel,
    ],
  );

  // 获取截图
  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!instanceId) return null;

    try {
      const isRunning = await maaService.isRunning(instanceId);

      if (isRunning) {
        const imageData = await maaService.getCachedImage(instanceId);
        return imageData || null;
      } else {
        const screencapId = await maaService.postScreencap(instanceId);
        if (screencapId < 0) return null;

        // 等待截图完成
        const success = await maaService.waitForScreencap(screencapId, 10000);
        if (!success) return null;

        const imageData = await maaService.getCachedImage(instanceId);
        return imageData || null;
      }
    } catch {
      return null;
    }
  }, [instanceId]);

  // 截图流循环
  const streamLoop = useCallback(async () => {
    // 初始化下一帧时间
    let nextFrameTime = Date.now();

    while (streamingRef.current) {
      // 计算需要等待的时间（sleep until 下一帧时间点）
      const now = Date.now();
      const sleepTime = nextFrameTime - now;
      if (sleepTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }

      // 计算下一帧时间
      const frameInterval = frameIntervalRef.current;
      if (frameInterval > 0) {
        nextFrameTime += frameInterval;
        // 如果已经落后太多，重置到当前时间
        if (nextFrameTime < Date.now()) {
          nextFrameTime = Date.now() + frameInterval;
        }
      } else {
        // unlimited 模式，立即执行下一帧
        nextFrameTime = Date.now();
      }

      lastFrameTimeRef.current = Date.now();

      try {
        const imageData = await captureFrame();
        if (imageData && streamingRef.current) {
          setScreenshotUrl(imageData);
        }
      } catch {
        // 静默处理
      }
    }
  }, [instanceId, captureFrame]);

  // 组件卸载时停止流
  useEffect(() => {
    return () => {
      streamingRef.current = false;
    };
  }, []);

  // 响应 store 中 isStreaming 状态变化
  useEffect(() => {
    // 同步 ref 与 store 状态
    streamingRef.current = isStreaming;

    // 如果状态变为开启且已连接，启动流
    if (isStreaming && isConnected) {
      streamLoop();
    }
  }, [isStreaming, isConnected, streamLoop]);

  // 连接后自动开始截图流
  const prevConnectedRef = useRef(false);
  const hasAutoStartedRef = useRef(false);

  // 组件挂载或状态恢复后，如果已连接，自动启动截图流
  useEffect(() => {
    // 避免重复启动
    if (hasAutoStartedRef.current) return;

    if (isConnected && !isStreaming) {
      hasAutoStartedRef.current = true;
      streamingRef.current = true;
      setInstanceScreenshotStreaming(instanceId, true);
      streamLoop();
    }
  }, [isConnected, isStreaming, instanceId, setInstanceScreenshotStreaming, streamLoop]);

  // 连接状态变化时的处理（从未连接变为已连接时重新启动）
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    // 从未连接变为已连接时，重置自动启动标记并启动
    if (isConnected && !wasConnected && !isStreaming) {
      hasAutoStartedRef.current = true;
      streamingRef.current = true;
      setInstanceScreenshotStreaming(instanceId, true);
      streamLoop();
    }
  }, [isConnected, isStreaming, instanceId, setInstanceScreenshotStreaming, streamLoop]);

  // 全屏模式切换
  const toggleFullscreen = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      setIsFullscreen(!isFullscreen);
    },
    [isFullscreen],
  );

  // ESC 键退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // 保存截图
  const saveScreenshot = useCallback(async () => {
    if (!screenshotUrl) return;
    try {
      const link = document.createElement('a');
      link.href = screenshotUrl;
      link.download = `screenshot_${instanceName}_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // 静默处理
    }
  }, [screenshotUrl, instanceName]);

  // 复制截图到剪贴板
  const copyScreenshot = useCallback(async () => {
    if (!screenshotUrl) return;
    try {
      const response = await fetch(screenshotUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (err) {
      log.warn('复制截图失败:', err);
    }
  }, [screenshotUrl]);

  // 断开连接
  const disconnect = useCallback(async () => {
    try {
      await maaService.destroyInstance(instanceId);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setScreenshotUrl(null);
      streamingRef.current = false;
      setInstanceScreenshotStreaming(instanceId, false);
    } catch {
      // 静默处理
    }
  }, [instanceId, setInstanceConnectionStatus, setInstanceScreenshotStreaming]);

  // 强制刷新
  const forceRefresh = useCallback(async () => {
    const imageData = await captureFrame();
    if (imageData) {
      setScreenshotUrl(imageData);
    }
  }, [captureFrame]);

  // 右键菜单（复用首页截图面板的菜单结构）
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const menuItems: MenuItem[] = [
        {
          id: 'stream',
          label: isStreaming ? t('contextMenu.stopStream') : t('contextMenu.startStream'),
          icon: isStreaming ? Pause : Play,
          disabled: !isConnected,
          onClick: () => {
            if (!instanceId || !isConnected) return;
            if (isStreaming) {
              streamingRef.current = false;
              setInstanceScreenshotStreaming(instanceId, false);
            } else {
              streamingRef.current = true;
              setInstanceScreenshotStreaming(instanceId, true);
              streamLoop();
            }
          },
        },
        {
          id: 'refresh',
          label: t('contextMenu.forceRefresh'),
          icon: RefreshCw,
          disabled: !isConnected,
          onClick: forceRefresh,
        },
        { id: 'divider-1', label: '', divider: true },
        {
          id: 'fullscreen',
          label: t('contextMenu.fullscreen'),
          icon: Maximize2,
          disabled: !screenshotUrl,
          onClick: () => setIsFullscreen(true),
        },
        { id: 'divider-2', label: '', divider: true },
        {
          id: 'save',
          label: t('contextMenu.saveScreenshot'),
          icon: Download,
          disabled: !screenshotUrl,
          onClick: saveScreenshot,
        },
        {
          id: 'copy',
          label: t('contextMenu.copyScreenshot'),
          icon: Copy,
          disabled: !screenshotUrl,
          onClick: copyScreenshot,
        },
        { id: 'divider-3', label: '', divider: true },
        {
          id: 'disconnect',
          label: t('contextMenu.disconnect'),
          icon: Unplug,
          disabled: !isConnected,
          danger: true,
          onClick: disconnect,
        },
      ];

      showMenu(e, menuItems);
    },
    [
      t,
      instanceId,
      isConnected,
      isStreaming,
      screenshotUrl,
      setInstanceScreenshotStreaming,
      streamLoop,
      forceRefresh,
      saveScreenshot,
      copyScreenshot,
      disconnect,
      showMenu,
    ],
  );

  return (
    <div
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      className={clsx(
        'group relative bg-bg-secondary rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg',
        isActive ? 'border-accent shadow-md' : 'border-border hover:border-accent/50',
      )}
    >
      {/* 截图区域 */}
      <div className="aspect-video bg-bg-tertiary relative overflow-hidden">
        {screenshotUrl ? (
          <>
            <img src={screenshotUrl} alt="Screenshot" className="w-full h-full object-contain" />
            {/* 流状态指示器 */}
            {isStreaming && (
              <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-success/80 rounded text-white text-xs">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                LIVE
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <Monitor className="w-8 h-8 opacity-30 mb-1" />
            <span className="text-xs">
              {isConnected ? t('screenshot.noScreenshot') : t('screenshot.connectFirst')}
            </span>
          </div>
        )}

        {/* 任务控制按钮 */}
        {isConnected && (
          <button
            onClick={handleStartStop}
            disabled={isStarting || isStopping || (!canRun && !isRunning)}
            className={clsx(
              'absolute bottom-2 right-2 p-1.5 rounded-md transition-all',
              isStarting || isStopping
                ? 'bg-yellow-500/80 text-white'
                : isRunning
                  ? 'bg-red-500/80 hover:bg-red-600/80 text-white'
                  : canRun
                    ? 'bg-success/80 hover:bg-success text-white'
                    : 'bg-black/30 text-white/50 cursor-not-allowed',
              'opacity-0 group-hover:opacity-100',
            )}
            title={
              isStarting
                ? t('taskList.startingTasks')
                : isStopping
                  ? t('taskList.stoppingTasks')
                  : isRunning
                    ? t('taskList.stopTasks')
                    : canRun
                      ? t('taskList.startTasks')
                      : t('dashboard.noEnabledTasks')
            }
          >
            {isStarting || isStopping ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : isRunning ? (
              <StopCircle className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3" />
            )}
          </button>
        )}
      </div>

      {/* 实例信息栏 */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          {/* 左侧：实例名称 + 控制器/设备信息 */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={clsx(
                'font-medium truncate flex-shrink-0',
                isActive ? 'text-accent' : 'text-text-primary',
              )}
            >
              {instanceName}
            </span>
            {/* 控制器/设备信息标签 */}
            {(statusInfo.controllerLabel || statusInfo.deviceName) && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary text-xs truncate min-w-0">
                {isConnected ? (
                  <Wifi className="w-3 h-3 text-success flex-shrink-0" />
                ) : (
                  <WifiOff className="w-3 h-3 text-text-muted flex-shrink-0" />
                )}
                <span className="truncate">
                  {statusInfo.deviceName || statusInfo.controllerLabel}
                </span>
              </div>
            )}
            {/* 资源信息标签 - 单独显示以增加间距 */}
            {statusInfo.resourceLabel && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary text-xs truncate min-w-0">
                <CheckCircle className="w-3 h-3 text-success flex-shrink-0" />
                <span className="truncate">{statusInfo.resourceLabel}</span>
              </div>
            )}
          </div>

          {/* 右侧：状态按钮（类似"开始任务"按钮样式） */}
          <div
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex-shrink-0',
              isRunning || taskStatus === 'Running'
                ? 'bg-success text-white'
                : taskStatus === 'Failed'
                  ? 'bg-error text-white'
                  : taskStatus === 'Succeeded'
                    ? 'bg-accent text-white'
                    : isConnected
                      ? 'bg-bg-tertiary text-text-secondary'
                      : 'bg-bg-active text-text-muted',
            )}
          >
            {isRunning || taskStatus === 'Running' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="truncate max-w-[80px]">
                  {runningTaskName || t('dashboard.running')}
                </span>
              </>
            ) : taskStatus === 'Failed' ? (
              <>
                <StopCircle className="w-3 h-3" />
                <span>{t('dashboard.failed')}</span>
              </>
            ) : taskStatus === 'Succeeded' ? (
              <>
                <CheckCircle className="w-3 h-3" />
                <span>{t('dashboard.succeeded')}</span>
              </>
            ) : isConnected ? (
              <>
                <Play className="w-3 h-3" />
                <span>{t('controller.connected')}</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                <span>{t('controller.disconnected')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 运行中动画边框 */}
      {taskStatus === 'Running' && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 rounded-xl border-2 border-green-500/50 animate-pulse" />
        </div>
      )}

      {/* 右键菜单 */}
      {menuState.isOpen && (
        <ContextMenu items={menuState.items} position={menuState.position} onClose={hideMenu} />
      )}

      {/* 全屏模态框 */}
      {isFullscreen && screenshotUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-8"
          onClick={toggleFullscreen}
        >
          {/* 卡片容器 */}
          <div
            className="relative bg-bg-secondary rounded-xl border border-border shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={handleContextMenu}
          >
            {/* 卡片标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-tertiary/50">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-text-secondary" />
                <span className="text-sm font-medium text-text-primary">{instanceName}</span>
                {/* 流模式指示器 */}
                {isStreaming && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-success/90 rounded text-white text-xs ml-2">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                  </div>
                )}
              </div>
              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
                title={t('screenshot.exitFullscreen')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 图片内容区 */}
            <div className="p-4 bg-bg-primary flex items-center justify-center overflow-auto">
              <img
                src={screenshotUrl}
                alt="Screenshot"
                className="max-w-full max-h-[calc(90vh-80px)] object-contain rounded-md"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface DashboardViewProps {
  onClose?: () => void;
}

export function DashboardView({ onClose }: DashboardViewProps) {
  const { t } = useTranslation();
  const { instances, activeInstanceId, setActiveInstance, toggleDashboardView } = useAppStore();

  const handleClose = onClose ?? toggleDashboardView;

  const handleSelectInstance = (instanceId: string) => {
    setActiveInstance(instanceId);
    handleClose();
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      {/* 实例网格 */}
      <div className="flex-1 overflow-auto p-6">
        {instances.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted">
            <p>{t('dashboard.noInstances')}</p>
          </div>
        ) : (
          <div
            className={clsx(
              'grid gap-4',
              instances.length === 1
                ? 'grid-cols-1 max-w-2xl mx-auto'
                : instances.length === 2
                  ? 'grid-cols-2 max-w-4xl mx-auto'
                  : instances.length <= 4
                    ? 'grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto'
                    : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
            )}
          >
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instanceId={instance.id}
                instanceName={instance.name}
                isActive={instance.id === activeInstanceId}
                onSelect={() => handleSelectInstance(instance.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-secondary">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-5 h-5 text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">{t('dashboard.title')}</h1>
          <span className="px-2 py-0.5 text-xs bg-accent/10 text-accent rounded-full">
            {instances.length} {t('dashboard.instances')}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <FrameRateSelector compact />
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-sm bg-bg-hover hover:bg-bg-active text-text-secondary rounded-lg transition-colors"
          >
            {t('dashboard.exit')}
          </button>
        </div>
      </div>
    </div>
  );
}
