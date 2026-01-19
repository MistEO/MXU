import { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import clsx from 'clsx';
import { loggers, generateTaskPipelineOverride } from '@/utils';
import type { TaskConfig, AgentConfig, ControllerConfig } from '@/types/maa';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';
import { SchedulePanel } from './SchedulePanel';

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
    setTaskRunStatus,
    setAllTasksRunStatus,
    registerMaaTaskMapping,
    findSelectedTaskIdByMaaTaskId,
    clearTaskRunStatus,
  } = useAppStore();

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  
  // 自动连接状态
  const [autoConnectPhase, setAutoConnectPhase] = useState<AutoConnectPhase>('idle');
  const [autoConnectError, setAutoConnectError] = useState<string | null>(null);
  
  // 任务队列状态（用于回调处理）
  const [pendingTaskIds, setPendingTaskIds] = useState<number[]>([]);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const runningInstanceIdRef = useRef<string | null>(null);
  
  // 自动连接回调 ID
  const pendingCtrlIdRef = useRef<number | null>(null);
  const pendingResIdsRef = useRef<Set<number>>(new Set());

  const instance = getActiveInstance();
  const tasks = instance?.selectedTasks || [];
  const allEnabled = tasks.length > 0 && tasks.every((t) => t.enabled);
  const anyExpanded = tasks.some((t) => t.expanded);

  // 检查是否可以运行
  const instanceId = instance?.id || '';
  const isConnected = instanceConnectionStatus[instanceId] === 'Connected';
  const isResourceLoaded = instanceResourceLoaded[instanceId] || false;
  
  // 检查是否有保存的设备和资源配置
  const currentControllerName = selectedController[instanceId] || projectInterface?.controller[0]?.name;
  const currentResourceName = selectedResource[instanceId] || projectInterface?.resource[0]?.name;
  const currentController = projectInterface?.controller.find(c => c.name === currentControllerName);
  const currentResource = projectInterface?.resource.find(r => r.name === currentResourceName);
  const savedDevice = instance?.savedDevice;
  
  // 判断是否有保存的设备配置可以自动连接
  const hasSavedDeviceConfig = Boolean(
    savedDevice && (
      savedDevice.adbDeviceName ||
      savedDevice.windowName ||
      savedDevice.playcoverAddress
    )
  );
  
  // 允许在有保存配置时启动（即使未连接）
  const canRun = (isConnected && isResourceLoaded && tasks.some((t) => t.enabled)) ||
    (hasSavedDeviceConfig && currentResource && tasks.some((t) => t.enabled));
  
  // 监听任务完成回调
  useEffect(() => {
    if (pendingTaskIds.length === 0) return;
    
    const currentTaskId = pendingTaskIds[currentTaskIndex];
    if (currentTaskId === undefined) return;
    
    let unlisten: (() => void) | null = null;
    
    maaService.onCallback((message, details) => {
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
          const nextIndex = currentTaskIndex + 1;
          setCurrentTaskIndex(nextIndex);
          setInstanceCurrentTaskId(runningInstanceId, pendingTaskIds[nextIndex]);
          
          // 将下一个任务设为 running
          const nextSelectedTaskId = findSelectedTaskIdByMaaTaskId(runningInstanceId, pendingTaskIds[nextIndex]);
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
          setPendingTaskIds([]);
          setCurrentTaskIndex(0);
          runningInstanceIdRef.current = null;
        }
      } else if (message === 'Tasker.Task.Failed') {
        log.error('任务执行失败, task_id:', currentTaskId);
        
        // 更新当前任务状态为失败
        const selectedTaskId = findSelectedTaskIdByMaaTaskId(runningInstanceId, currentTaskId);
        if (selectedTaskId) {
          setTaskRunStatus(runningInstanceId, selectedTaskId, 'failed');
        }
        
        // 停止 Agent（如果有）
        if (projectInterface?.agent) {
          maaService.stopAgent(runningInstanceId).catch(() => {});
        }
        
        setInstanceTaskStatus(runningInstanceId, 'Failed');
        updateInstance(runningInstanceId, { isRunning: false });
        setInstanceCurrentTaskId(runningInstanceId, null);
        setPendingTaskIds([]);
        setCurrentTaskIndex(0);
        runningInstanceIdRef.current = null;
      }
    }).then(fn => {
      unlisten = fn;
    });
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [pendingTaskIds, currentTaskIndex, projectInterface?.agent, setInstanceCurrentTaskId, setInstanceTaskStatus, updateInstance, findSelectedTaskIdByMaaTaskId, setTaskRunStatus]);

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
        const matchedDevice = devices.find(d => d.name === savedDevice.adbDeviceName);
        
        if (!matchedDevice) {
          throw new Error(t('taskList.autoConnect.deviceNotFound', { name: savedDevice.adbDeviceName }));
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
      } else if ((controllerType === 'Win32' || controllerType === 'Gamepad') && savedDevice.windowName) {
        const classRegex = currentController.win32?.class_regex || currentController.gamepad?.class_regex;
        const windowRegex = currentController.win32?.window_regex || currentController.gamepad?.window_regex;
        const windows = await maaService.findWin32Windows(classRegex, windowRegex);
        const matchedWindow = windows.find(w => w.window_name === savedDevice.windowName);
        
        if (!matchedWindow) {
          throw new Error(t('taskList.autoConnect.windowNotFound', { name: savedDevice.windowName }));
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
      
      const agentPath = `${basePath}/MaaAgentBinary`;
      const ctrlId = await maaService.connectController(instanceId, config, agentPath);
      pendingCtrlIdRef.current = ctrlId;
      
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
      const resourcePaths = currentResource.path.map(p => {
        const cleanPath = p.replace(/^\.\//, '').replace(/^\.\\/, '');
        return `${basePath}/${cleanPath}`;
      });
      
      const resIds = await maaService.loadResource(instanceId, resourcePaths);
      pendingResIdsRef.current = new Set(resIds);
      
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
        // 清空任务运行状态
        clearTaskRunStatus(instance.id);
        setPendingTaskIds([]);
        setCurrentTaskIndex(0);
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
        
        const enabledTasks = tasks.filter(t => t.enabled);
        log.info('开始执行任务, 数量:', enabledTasks.length);

        // 构建任务配置列表
        const taskConfigs: TaskConfig[] = [];
        for (const selectedTask of enabledTasks) {
          const taskDef = projectInterface?.task.find(t => t.name === selectedTask.taskName);
          if (!taskDef) continue;

          taskConfigs.push({
            entry: taskDef.entry,
            pipeline_override: generateTaskPipelineOverride(selectedTask, projectInterface),
          });
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

        // 启动任务（支持 Agent）
        const taskIds = await maaService.startTasks(
          instance.id,
          taskConfigs,
          agentConfig,
          basePath
        );

        log.info('任务已提交, task_ids:', taskIds);

        // 初始化任务运行状态：所有启用的任务设为 pending
        const enabledTaskIds = enabledTasks.map(t => t.id);
        setAllTasksRunStatus(instance.id, enabledTaskIds, 'pending');
        
        // 记录 maaTaskId -> selectedTaskId 的映射关系
        taskIds.forEach((maaTaskId, index) => {
          if (enabledTasks[index]) {
            registerMaaTaskMapping(instance.id, maaTaskId, enabledTasks[index].id);
          }
        });
        
        // 第一个任务设为 running
        if (enabledTasks.length > 0) {
          setTaskRunStatus(instance.id, enabledTasks[0].id, 'running');
        }

        // 设置任务队列，由回调监听处理完成状态
        runningInstanceIdRef.current = instance.id;
        setPendingTaskIds(taskIds);
        setCurrentTaskIndex(0);
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
        setIsStarting(false);
      }
    }
  };

  const isDisabled = tasks.length === 0 || !tasks.some((t) => t.enabled) || (!canRun && !instance?.isRunning);
  
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
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          title={allEnabled ? t('taskList.deselectAll') : t('taskList.selectAll')}
        >
          {allEnabled ? (
            <CheckSquare className="w-4 h-4" />
          ) : (
            <Square className="w-4 h-4" />
          )}
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
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
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
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          title={t('taskList.addTask')}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t('taskList.addTask')}</span>
        </button>
      </div>

      {/* 右侧执行按钮组 */}
      <div className="flex items-center gap-2 relative">
        {/* 定时执行按钮 */}
        <button
          onClick={() => setShowSchedulePanel(!showSchedulePanel)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors',
            showSchedulePanel
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            // 有启用的定时策略时显示指示点
            instance?.schedulePolicies?.some(p => p.enabled) && !showSchedulePanel && 'relative'
          )}
          title={t('schedule.title')}
        >
          <Clock className="w-4 h-4" />
          <span className="hidden sm:inline">{t('schedule.button')}</span>
          {/* 启用指示点 */}
          {instance?.schedulePolicies?.some(p => p.enabled) && !showSchedulePanel && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent rounded-full" />
          )}
        </button>

        {/* 定时执行面板 */}
        {showSchedulePanel && instance && (
          <SchedulePanel
            instanceId={instance.id}
            onClose={() => setShowSchedulePanel(false)}
          />
        )}

        {/* 开始/停止按钮 */}
        <button
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
              : 'bg-accent hover:bg-accent-hover text-white'
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
