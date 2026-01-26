import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  ProjectInterface,
  Instance,
  SelectedTask,
  OptionValue,
  TaskItem,
  OptionDefinition,
  SavedDeviceInfo,
} from '@/types/interface';
import type {
  MxuConfig,
  WindowSize,
  UpdateChannel,
  MirrorChyanSettings,
  RecentlyClosedInstance,
  ScreenshotFrameRate,
} from '@/types/config';
import {
  defaultWindowSize,
  defaultMirrorChyanSettings,
  defaultScreenshotFrameRate,
} from '@/types/config';

// 最近关闭列表最大条目数
const MAX_RECENTLY_CLOSED = 30;
import type { ConnectionStatus, TaskStatus, AdbDevice, Win32Window } from '@/types/maa';
import { saveConfig } from '@/services/configService';
import i18n, { getInterfaceLangKey } from '@/i18n';
import { applyTheme, resolveThemeMode, type AccentColor } from '@/themes';
import { loggers } from '@/utils/logger';

/** 单个任务的运行状态 */
export type TaskRunStatus = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed';

/** 日志条目类型 */
export type LogType = 'info' | 'success' | 'warning' | 'error' | 'agent' | 'focus';

/** 日志条目 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  type: LogType;
  message: string;
}

export type Theme = 'light' | 'dark' | 'system';
export type Language = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR';
export type PageView = 'main' | 'settings';

interface AppState {
  // 主题和语言
  theme: Theme;
  accentColor: AccentColor;
  language: Language;
  setTheme: (theme: Theme) => void;
  setAccentColor: (accent: AccentColor) => void;
  setLanguage: (lang: Language) => void;

  // 当前页面
  currentPage: PageView;
  setCurrentPage: (page: PageView) => void;

  // 调试选项（不落盘，每次启动默认关闭）
  saveDraw: boolean;
  setSaveDraw: (enabled: boolean) => void;

  // Interface 数据
  projectInterface: ProjectInterface | null;
  interfaceTranslations: Record<string, Record<string, string>>;
  basePath: string; // 资源基础路径，用于保存配置
  setProjectInterface: (pi: ProjectInterface) => void;
  setInterfaceTranslations: (lang: string, translations: Record<string, string>) => void;
  setBasePath: (path: string) => void;

  // 多开实例
  instances: Instance[];
  activeInstanceId: string | null;
  nextInstanceNumber: number; // 递增计数器，确保实例名字编号不重复
  createInstance: (name?: string) => string;
  removeInstance: (id: string) => void;
  setActiveInstance: (id: string) => void;
  updateInstance: (id: string, updates: Partial<Instance>) => void;
  renameInstance: (id: string, newName: string) => void;
  reorderInstances: (oldIndex: number, newIndex: number) => void;

  // 获取活动实例
  getActiveInstance: () => Instance | null;

  // 任务操作
  addTaskToInstance: (instanceId: string, task: TaskItem) => void;
  removeTaskFromInstance: (instanceId: string, taskId: string) => void;
  reorderTasks: (instanceId: string, oldIndex: number, newIndex: number) => void;
  toggleTaskEnabled: (instanceId: string, taskId: string) => void;
  toggleTaskExpanded: (instanceId: string, taskId: string) => void;
  setTaskOptionValue: (
    instanceId: string,
    taskId: string,
    optionKey: string,
    value: OptionValue,
  ) => void;
  selectAllTasks: (instanceId: string, enabled: boolean) => void;
  collapseAllTasks: (instanceId: string, expanded: boolean) => void;
  renameTask: (instanceId: string, taskId: string, newName: string) => void;

  // 任务右键菜单操作
  duplicateTask: (instanceId: string, taskId: string) => void;
  moveTaskUp: (instanceId: string, taskId: string) => void;
  moveTaskDown: (instanceId: string, taskId: string) => void;
  moveTaskToTop: (instanceId: string, taskId: string) => void;
  moveTaskToBottom: (instanceId: string, taskId: string) => void;

  // 实例右键菜单操作
  duplicateInstance: (instanceId: string) => string;

  // 全局 UI 状态
  showAddTaskPanel: boolean;
  setShowAddTaskPanel: (show: boolean) => void;

  // 最近添加的任务 ID（用于自动滚动和展开）
  lastAddedTaskId: string | null;
  clearLastAddedTaskId: () => void;

  // 正在播放入场动画的任务 ID 列表
  animatingTaskIds: string[];
  removeAnimatingTaskId: (taskId: string) => void;

  // 标签页动画状态
  animatingTabIds: string[]; // 正在播放进入动画的标签页
  closingTabIds: string[]; // 正在播放退出动画的标签页
  removeAnimatingTabId: (tabId: string) => void;
  startTabCloseAnimation: (tabId: string) => void;

  // 新增任务名称列表（interface.json 快照对比检测到的新增任务）
  newTaskNames: string[];
  setNewTaskNames: (names: string[]) => void;
  removeNewTaskName: (name: string) => void;
  clearNewTaskNames: () => void;

  // 国际化文本解析
  resolveI18nText: (text: string | undefined, lang: string) => string;

  // 配置导入
  importConfig: (config: MxuConfig) => void;

  // MaaFramework 状态
  maaInitialized: boolean;
  maaVersion: string | null;
  setMaaInitialized: (initialized: boolean, version?: string) => void;

  // 实例运行时状态
  instanceConnectionStatus: Record<string, ConnectionStatus>;
  instanceResourceLoaded: Record<string, boolean>;
  instanceCurrentTaskId: Record<string, number | null>;
  instanceTaskStatus: Record<string, TaskStatus | null>;

  setInstanceConnectionStatus: (instanceId: string, status: ConnectionStatus) => void;
  setInstanceResourceLoaded: (instanceId: string, loaded: boolean) => void;
  setInstanceCurrentTaskId: (instanceId: string, taskId: number | null) => void;
  setInstanceTaskStatus: (instanceId: string, status: TaskStatus | null) => void;

  // 选中的控制器和资源（运行时状态，与 Instance 中的保持同步）
  selectedController: Record<string, string>;
  selectedResource: Record<string, string>;
  setSelectedController: (instanceId: string, controllerName: string) => void;
  setSelectedResource: (instanceId: string, resourceName: string) => void;

  // 设备信息保存
  setInstanceSavedDevice: (instanceId: string, savedDevice: SavedDeviceInfo) => void;

  // 设备列表缓存（避免切换页面时丢失）
  cachedAdbDevices: AdbDevice[];
  cachedWin32Windows: Win32Window[];
  setCachedAdbDevices: (devices: AdbDevice[]) => void;
  setCachedWin32Windows: (windows: Win32Window[]) => void;

  // 从后端恢复 MAA 运行时状态
  restoreBackendStates: (states: {
    instances: Record<
      string,
      {
        connected: boolean;
        resourceLoaded: boolean;
        taskerInited: boolean;
        isRunning: boolean;
        taskIds: number[];
      }
    >;
    cachedAdbDevices: AdbDevice[];
    cachedWin32Windows: Win32Window[];
  }) => void;

  // 截图流状态（按实例独立）
  instanceScreenshotStreaming: Record<string, boolean>;
  setInstanceScreenshotStreaming: (instanceId: string, streaming: boolean) => void;

  // 右侧面板折叠状态（控制连接设置和截图面板的显示）
  sidePanelExpanded: boolean;
  setSidePanelExpanded: (expanded: boolean) => void;
  toggleSidePanelExpanded: () => void;

  // 右侧面板宽度和折叠状态
  rightPanelWidth: number;
  rightPanelCollapsed: boolean;
  setRightPanelWidth: (width: number) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;

  // 卡片展开状态
  connectionPanelExpanded: boolean;
  screenshotPanelExpanded: boolean;
  setConnectionPanelExpanded: (expanded: boolean) => void;
  setScreenshotPanelExpanded: (expanded: boolean) => void;

  // 中控台视图模式（同时显示所有实例的截图和日志）
  dashboardView: boolean;
  setDashboardView: (enabled: boolean) => void;
  toggleDashboardView: () => void;

  // 窗口大小
  windowSize: WindowSize;
  setWindowSize: (size: WindowSize) => void;

  // MirrorChyan 更新设置
  mirrorChyanSettings: MirrorChyanSettings;
  setMirrorChyanCdk: (cdk: string) => void;
  setMirrorChyanChannel: (channel: UpdateChannel) => void;

  // 任务选项预览显示设置
  showOptionPreview: boolean;
  setShowOptionPreview: (show: boolean) => void;

  // 实时截图帧率设置
  screenshotFrameRate: ScreenshotFrameRate;
  setScreenshotFrameRate: (rate: ScreenshotFrameRate) => void;

  // Welcome 弹窗显示记录
  welcomeShownHash: string;
  setWelcomeShownHash: (hash: string) => void;

  // 开发模式
  devMode: boolean;
  setDevMode: (devMode: boolean) => void;

  // 新用户引导
  onboardingCompleted: boolean;
  setOnboardingCompleted: (completed: boolean) => void;

  // 更新检查状态
  updateInfo: UpdateInfo | null;
  updateCheckLoading: boolean;
  showUpdateDialog: boolean;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateCheckLoading: (loading: boolean) => void;
  setShowUpdateDialog: (show: boolean) => void;

  // 下载状态
  downloadStatus: DownloadStatus;
  downloadProgress: DownloadProgress | null;
  downloadSavePath: string | null;
  setDownloadStatus: (status: DownloadStatus) => void;
  setDownloadProgress: (progress: DownloadProgress | null) => void;
  setDownloadSavePath: (path: string | null) => void;
  resetDownloadState: () => void;

  // 安装状态
  showInstallConfirmModal: boolean;
  installStatus: InstallStatus;
  installError: string | null;
  justUpdatedInfo: JustUpdatedInfo | null;
  setShowInstallConfirmModal: (show: boolean) => void;
  setInstallStatus: (status: InstallStatus) => void;
  setInstallError: (error: string | null) => void;
  setJustUpdatedInfo: (info: JustUpdatedInfo | null) => void;
  resetInstallState: () => void;

  // 最近关闭的实例
  recentlyClosed: RecentlyClosedInstance[];
  reopenRecentlyClosed: (id: string) => string | null;
  removeFromRecentlyClosed: (id: string) => void;
  clearRecentlyClosed: () => void;

  // 任务运行状态（用于显示任务执行进度）
  // instanceTaskRunStatus[instanceId][selectedTaskId] = status
  instanceTaskRunStatus: Record<string, Record<string, TaskRunStatus>>;
  // maaTaskId -> selectedTaskId 的映射
  maaTaskIdMapping: Record<string, Record<number, string>>;
  // 设置任务运行状态
  setTaskRunStatus: (instanceId: string, selectedTaskId: string, status: TaskRunStatus) => void;
  // 批量设置任务运行状态（用于任务开始时初始化所有任务为 pending）
  setAllTasksRunStatus: (instanceId: string, taskIds: string[], status: TaskRunStatus) => void;
  // 注册 maaTaskId -> selectedTaskId 映射
  registerMaaTaskMapping: (instanceId: string, maaTaskId: number, selectedTaskId: string) => void;
  // 根据 maaTaskId 查找 selectedTaskId
  findSelectedTaskIdByMaaTaskId: (instanceId: string, maaTaskId: number) => string | null;
  // 根据 selectedTaskId 查找 maaTaskId（反向查找）
  findMaaTaskIdBySelectedTaskId: (instanceId: string, selectedTaskId: string) => number | null;
  // 清空实例的任务运行状态
  clearTaskRunStatus: (instanceId: string) => void;

  // 运行中任务队列管理
  instancePendingTaskIds: Record<string, number[]>;
  instanceCurrentTaskIndex: Record<string, number>;
  setPendingTaskIds: (instanceId: string, taskIds: number[]) => void;
  appendPendingTaskId: (instanceId: string, taskId: number) => void;
  setCurrentTaskIndex: (instanceId: string, index: number) => void;
  advanceCurrentTaskIndex: (instanceId: string) => void;
  clearPendingTasks: (instanceId: string) => void;

  // 定时执行状态
  scheduleExecutions: Record<string, ScheduleExecutionInfo>;
  setScheduleExecution: (instanceId: string, info: ScheduleExecutionInfo | null) => void;
  clearScheduleExecution: (instanceId: string) => void;

  // 日志管理
  instanceLogs: Record<string, LogEntry[]>;
  addLog: (instanceId: string, log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: (instanceId: string) => void;

  // 回调 ID 与名称的映射（用于日志显示）
  ctrlIdToName: Record<number, string>;
  ctrlIdToType: Record<number, 'device' | 'window'>; // 控制器类型：设备或窗口
  resIdToName: Record<number, string>;
  taskIdToName: Record<number, string>;
  entryToTaskName: Record<string, string>; // entry -> 任务显示名（解决时序问题）
  registerCtrlIdName: (ctrlId: number, name: string, type: 'device' | 'window') => void;
  registerResIdName: (resId: number, name: string) => void;
  registerTaskIdName: (taskId: number, name: string) => void;
  registerEntryTaskName: (entry: string, name: string) => void;
  getCtrlName: (ctrlId: number) => string | undefined;
  getCtrlType: (ctrlId: number) => 'device' | 'window' | undefined;
  getResName: (resId: number) => string | undefined;
  getTaskName: (taskId: number) => string | undefined;
  getTaskNameByEntry: (entry: string) => string | undefined;
}

// 定时执行状态信息
export interface ScheduleExecutionInfo {
  policyName: string;
  startTime: number; // timestamp
}

// 更新信息类型
export interface UpdateInfo {
  hasUpdate: boolean;
  versionName: string;
  releaseNote: string;
  downloadUrl?: string;
  updateType?: 'incremental' | 'full';
  channel?: string;
  fileSize?: number;
  filename?: string;
  downloadSource?: 'mirrorchyan' | 'github';
  // MirrorChyan API 错误信息
  errorCode?: number;
  errorMessage?: string;
}

// 下载进度类型
export interface DownloadProgress {
  downloadedSize: number;
  totalSize: number;
  speed: number;
  progress: number; // 0-100
}

// 下载状态类型
export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'failed';

// 安装状态类型
export type InstallStatus = 'idle' | 'installing' | 'completed' | 'failed';

// 更新完成信息（重启后显示）
export interface JustUpdatedInfo {
  previousVersion: string;
  newVersion: string;
  releaseNote: string;
  channel?: string;
}

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// 创建默认选项值
const createDefaultOptionValue = (optionDef: OptionDefinition): OptionValue => {
  if (optionDef.type === 'input') {
    const values: Record<string, string> = {};
    optionDef.inputs.forEach((input) => {
      values[input.name] = input.default || '';
    });
    return { type: 'input', values };
  }

  if (optionDef.type === 'switch') {
    const defaultCase = optionDef.default_case || optionDef.cases[1]?.name || 'No';
    const isYes = ['Yes', 'yes', 'Y', 'y'].includes(defaultCase);
    return { type: 'switch', value: isYes };
  }

  // select type (default)
  const defaultCase = optionDef.default_case || optionDef.cases[0]?.name || '';
  return { type: 'select', caseName: defaultCase };
};

/**
 * 递归初始化所有选项（包括嵌套选项）的默认值
 * @param optionKeys 顶层选项键列表
 * @param allOptions 所有选项定义
 * @param result 结果对象（用于递归累积）
 */
const initializeAllOptionValues = (
  optionKeys: string[],
  allOptions: Record<string, OptionDefinition>,
  result: Record<string, OptionValue> = {},
): Record<string, OptionValue> => {
  for (const optKey of optionKeys) {
    const optDef = allOptions[optKey];
    if (!optDef) continue;

    // 如果已经初始化过，跳过（避免循环引用）
    if (result[optKey]) continue;

    // 创建当前选项的默认值
    result[optKey] = createDefaultOptionValue(optDef);

    // 处理嵌套选项：根据当前默认值找到对应的 case，递归初始化其子选项
    if (optDef.type === 'switch' || optDef.type === 'select' || !optDef.type) {
      const currentValue = result[optKey];
      let selectedCase;

      if (optDef.type === 'switch' && 'cases' in optDef) {
        const isChecked = currentValue.type === 'switch' && currentValue.value;
        selectedCase = optDef.cases?.find((c) => {
          if (isChecked) {
            return ['Yes', 'yes', 'Y', 'y'].includes(c.name);
          }
          return ['No', 'no', 'N', 'n'].includes(c.name);
        });
      } else if ('cases' in optDef) {
        const caseName =
          currentValue.type === 'select' ? currentValue.caseName : optDef.cases?.[0]?.name;
        selectedCase = optDef.cases?.find((c) => c.name === caseName);
      }

      // 递归初始化嵌套选项
      if (selectedCase?.option && selectedCase.option.length > 0) {
        initializeAllOptionValues(selectedCase.option, allOptions, result);
      }
    }
  }

  return result;
};

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    // 主题和语言
    theme: 'light',
    accentColor: 'emerald',
    language: 'zh-CN',
    setTheme: (theme) => {
      set({ theme });
      const mode = resolveThemeMode(theme);
      applyTheme(mode, get().accentColor);
    },
    setAccentColor: (accent) => {
      set({ accentColor: accent });
      const { theme } = get();
      const mode = resolveThemeMode(theme);
      applyTheme(mode, accent);
    },
    setLanguage: (lang) => {
      set({ language: lang });
      localStorage.setItem('mxu-language', lang);
    },

    // 当前页面
    currentPage: 'main',
    setCurrentPage: (page) => set({ currentPage: page }),

    // 调试选项（不落盘，每次启动默认关闭）
    saveDraw: false,
    setSaveDraw: async (enabled) => {
      set({ saveDraw: enabled });
      // 调用 MaaFramework API 设置全局选项
      try {
        const { maaService } = await import('@/services/maaService');
        await maaService.setSaveDraw(enabled);
      } catch (err) {
        loggers.app.error('设置保存调试图像失败:', err);
      }
    },

    // Interface 数据
    projectInterface: null,
    interfaceTranslations: {},
    basePath: '.',
    setProjectInterface: (pi) => set({ projectInterface: pi }),
    setInterfaceTranslations: (lang, translations) =>
      set((state) => ({
        interfaceTranslations: {
          ...state.interfaceTranslations,
          [lang]: translations,
        },
      })),
    setBasePath: (path) => set({ basePath: path }),

    // 多开实例
    instances: [],
    activeInstanceId: null,
    nextInstanceNumber: 1,

    createInstance: (name) => {
      const id = generateId();
      const instanceNumber = get().nextInstanceNumber;
      const pi = get().projectInterface;

      // 只添加 default_check 为 true 的任务
      const defaultTasks: SelectedTask[] = [];
      if (pi) {
        // 获取默认控制器名称，用于检查任务兼容性
        const defaultControllerName = pi.controller[0]?.name;

        pi.task.forEach((task) => {
          if (!task.default_check) return;

          // 检查任务是否支持默认控制器
          const isControllerCompatible =
            !task.controller ||
            task.controller.length === 0 ||
            !!(defaultControllerName && task.controller.includes(defaultControllerName));

          const optionValues =
            task.option && pi.option ? initializeAllOptionValues(task.option, pi.option) : {};
          defaultTasks.push({
            id: generateId(),
            taskName: task.name,
            enabled: isControllerCompatible, // 不兼容默认控制器的任务不勾选
            optionValues,
            expanded: true, // 新建配置时自动展开所有任务
          });
        });
      }

      const newInstance: Instance = {
        id,
        name: name ? `${name} ${instanceNumber}` : `Config ${instanceNumber}`,
        selectedTasks: defaultTasks,
        isRunning: false,
      };

      // 收集所有新建任务的 ID 用于入场动画
      const newTaskIds = defaultTasks.map((t) => t.id);

      set((state) => ({
        instances: [...state.instances, newInstance],
        activeInstanceId: id,
        nextInstanceNumber: state.nextInstanceNumber + 1,
        showAddTaskPanel: true, // 新建配置时自动展开添加任务面板
        animatingTaskIds: [...state.animatingTaskIds, ...newTaskIds],
        animatingTabIds: [...state.animatingTabIds, id], // 添加到标签页进入动画列表
      }));

      return id;
    },

    removeInstance: (id) =>
      set((state) => {
        const instanceToClose = state.instances.find((i) => i.id === id);
        const newInstances = state.instances.filter((i) => i.id !== id);
        let newActiveId = state.activeInstanceId;

        if (state.activeInstanceId === id) {
          newActiveId = newInstances.length > 0 ? newInstances[0].id : null;
        }

        // 将关闭的实例添加到最近关闭列表
        let newRecentlyClosed = state.recentlyClosed;
        if (instanceToClose) {
          const closedRecord: RecentlyClosedInstance = {
            id: instanceToClose.id,
            name: instanceToClose.name,
            closedAt: Date.now(),
            controllerId: instanceToClose.controllerId,
            resourceId: instanceToClose.resourceId,
            controllerName: instanceToClose.controllerName,
            resourceName: instanceToClose.resourceName,
            savedDevice: instanceToClose.savedDevice,
            tasks: instanceToClose.selectedTasks.map((t) => ({
              id: t.id,
              taskName: t.taskName,
              customName: t.customName,
              enabled: t.enabled,
              optionValues: t.optionValues,
            })),
            schedulePolicies: instanceToClose.schedulePolicies,
          };
          // 添加到列表头部，并限制最大条目数
          newRecentlyClosed = [closedRecord, ...state.recentlyClosed].slice(0, MAX_RECENTLY_CLOSED);
        }

        return {
          instances: newInstances,
          activeInstanceId: newActiveId,
          recentlyClosed: newRecentlyClosed,
        };
      }),

    setActiveInstance: (id) => set({ activeInstanceId: id }),

    updateInstance: (id, updates) =>
      set((state) => ({
        instances: state.instances.map((i) => (i.id === id ? { ...i, ...updates } : i)),
      })),

    renameInstance: (id, newName) =>
      set((state) => ({
        instances: state.instances.map((i) => (i.id === id ? { ...i, name: newName } : i)),
      })),

    reorderInstances: (oldIndex, newIndex) =>
      set((state) => {
        const instances = [...state.instances];
        const [removed] = instances.splice(oldIndex, 1);
        instances.splice(newIndex, 0, removed);
        return { instances };
      }),

    getActiveInstance: () => {
      const state = get();
      return state.instances.find((i) => i.id === state.activeInstanceId) || null;
    },

    // 任务操作
    addTaskToInstance: (instanceId, task) => {
      const pi = get().projectInterface;
      if (!pi) return;

      // 递归初始化所有选项（包括嵌套选项）
      const optionValues =
        task.option && pi.option ? initializeAllOptionValues(task.option, pi.option) : {};

      // 判断新任务是否有选项或描述（用于决定是否展开）
      const hasOptions = !!(task.option && task.option.length > 0);
      const hasDescription = !!task.description;
      const shouldExpand = hasOptions || hasDescription;

      const newTask: SelectedTask = {
        id: generateId(),
        taskName: task.name,
        enabled: true,
        optionValues,
        expanded: shouldExpand, // 有选项或描述的任务自动展开
      };

      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId ? { ...i, selectedTasks: [...i.selectedTasks, newTask] } : i,
        ),
        lastAddedTaskId: newTask.id, // 记录最近添加的任务 ID
        animatingTaskIds: [...state.animatingTaskIds, newTask.id], // 加入动画列表
      }));
    },

    removeTaskFromInstance: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId
            ? { ...i, selectedTasks: i.selectedTasks.filter((t) => t.id !== taskId) }
            : i,
        ),
      })),

    reorderTasks: (instanceId, oldIndex, newIndex) =>
      set((state) => ({
        instances: state.instances.map((i) => {
          if (i.id !== instanceId) return i;

          const tasks = [...i.selectedTasks];
          const [removed] = tasks.splice(oldIndex, 1);
          tasks.splice(newIndex, 0, removed);

          return { ...i, selectedTasks: tasks };
        }),
      })),

    toggleTaskEnabled: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map((t) =>
                  t.id === taskId ? { ...t, enabled: !t.enabled } : t,
                ),
              }
            : i,
        ),
      })),

    toggleTaskExpanded: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map((t) =>
                  t.id === taskId ? { ...t, expanded: !t.expanded } : t,
                ),
              }
            : i,
        ),
      })),

    setTaskOptionValue: (instanceId, taskId, optionKey, value) => {
      const pi = get().projectInterface;

      set((state) => ({
        instances: state.instances.map((i) => {
          if (i.id !== instanceId) return i;

          return {
            ...i,
            selectedTasks: i.selectedTasks.map((t) => {
              if (t.id !== taskId) return t;

              const newOptionValues = { ...t.optionValues, [optionKey]: value };

              // 当选项值改变时，初始化新的嵌套选项
              if (pi?.option) {
                const optDef = pi.option[optionKey];
                if (
                  optDef &&
                  (optDef.type === 'switch' || optDef.type === 'select' || !optDef.type) &&
                  'cases' in optDef
                ) {
                  let selectedCase;

                  if (optDef.type === 'switch') {
                    const isChecked = value.type === 'switch' && value.value;
                    selectedCase = optDef.cases?.find((c) => {
                      if (isChecked) {
                        return ['Yes', 'yes', 'Y', 'y'].includes(c.name);
                      }
                      return ['No', 'no', 'N', 'n'].includes(c.name);
                    });
                  } else {
                    const caseName =
                      value.type === 'select' ? value.caseName : optDef.cases?.[0]?.name;
                    selectedCase = optDef.cases?.find((c) => c.name === caseName);
                  }

                  // 初始化嵌套选项（如果尚未初始化）
                  if (selectedCase?.option && selectedCase.option.length > 0) {
                    for (const nestedKey of selectedCase.option) {
                      if (!newOptionValues[nestedKey]) {
                        const nestedDef = pi.option[nestedKey];
                        if (nestedDef) {
                          const nestedValues = initializeAllOptionValues([nestedKey], pi.option);
                          Object.assign(newOptionValues, nestedValues);
                        }
                      }
                    }
                  }
                }
              }

              return { ...t, optionValues: newOptionValues };
            }),
          };
        }),
      }));
    },

    selectAllTasks: (instanceId, enabled) =>
      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map((t) => ({ ...t, enabled })),
              }
            : i,
        ),
      })),

    collapseAllTasks: (instanceId, expanded) =>
      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map((t) => ({ ...t, expanded })),
              }
            : i,
        ),
      })),

    renameTask: (instanceId, taskId, newName) =>
      set((state) => ({
        instances: state.instances.map((i) =>
          i.id === instanceId
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map((t) =>
                  t.id === taskId ? { ...t, customName: newName || undefined } : t,
                ),
              }
            : i,
        ),
      })),

    // 复制任务
    duplicateTask: (instanceId, taskId) => {
      const state = get();
      const instance = state.instances.find((i) => i.id === instanceId);
      if (!instance) return;

      const taskIndex = instance.selectedTasks.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) return;

      const originalTask = instance.selectedTasks[taskIndex];

      // 计算新任务的显示名称
      const copySuffix = i18n.t('common.copySuffix');
      let newCustomName: string;
      if (originalTask.customName) {
        newCustomName = `${originalTask.customName}${copySuffix}`;
      } else {
        // 获取任务的原始 label
        const taskDef = state.projectInterface?.task.find((t) => t.name === originalTask.taskName);
        const langKey = getInterfaceLangKey(state.language);
        const originalLabel =
          state.resolveI18nText(taskDef?.label, langKey) || taskDef?.name || originalTask.taskName;
        newCustomName = `${originalLabel}${copySuffix}`;
      }

      const newTask: SelectedTask = {
        ...originalTask,
        id: generateId(),
        customName: newCustomName,
        optionValues: { ...originalTask.optionValues },
      };

      const tasks = [...instance.selectedTasks];
      tasks.splice(taskIndex + 1, 0, newTask);

      set({
        instances: state.instances.map((i) =>
          i.id === instanceId ? { ...i, selectedTasks: tasks } : i,
        ),
      });
    },

    // 上移任务
    moveTaskUp: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) => {
          if (i.id !== instanceId) return i;

          const taskIndex = i.selectedTasks.findIndex((t) => t.id === taskId);
          if (taskIndex <= 0) return i;

          const tasks = [...i.selectedTasks];
          [tasks[taskIndex - 1], tasks[taskIndex]] = [tasks[taskIndex], tasks[taskIndex - 1]];

          return { ...i, selectedTasks: tasks };
        }),
      })),

    // 下移任务
    moveTaskDown: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) => {
          if (i.id !== instanceId) return i;

          const taskIndex = i.selectedTasks.findIndex((t) => t.id === taskId);
          if (taskIndex === -1 || taskIndex >= i.selectedTasks.length - 1) return i;

          const tasks = [...i.selectedTasks];
          [tasks[taskIndex], tasks[taskIndex + 1]] = [tasks[taskIndex + 1], tasks[taskIndex]];

          return { ...i, selectedTasks: tasks };
        }),
      })),

    // 置顶任务
    moveTaskToTop: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) => {
          if (i.id !== instanceId) return i;

          const taskIndex = i.selectedTasks.findIndex((t) => t.id === taskId);
          if (taskIndex <= 0) return i;

          const tasks = [...i.selectedTasks];
          const [task] = tasks.splice(taskIndex, 1);
          tasks.unshift(task);

          return { ...i, selectedTasks: tasks };
        }),
      })),

    // 置底任务
    moveTaskToBottom: (instanceId, taskId) =>
      set((state) => ({
        instances: state.instances.map((i) => {
          if (i.id !== instanceId) return i;

          const taskIndex = i.selectedTasks.findIndex((t) => t.id === taskId);
          if (taskIndex === -1 || taskIndex >= i.selectedTasks.length - 1) return i;

          const tasks = [...i.selectedTasks];
          const [task] = tasks.splice(taskIndex, 1);
          tasks.push(task);

          return { ...i, selectedTasks: tasks };
        }),
      })),

    // 复制实例
    duplicateInstance: (instanceId) => {
      const state = get();
      const sourceInstance = state.instances.find((i) => i.id === instanceId);
      if (!sourceInstance) return '';

      const newId = generateId();
      const instanceNumber = state.nextInstanceNumber;

      const newInstance: Instance = {
        ...sourceInstance,
        id: newId,
        name: `${sourceInstance.name}${i18n.t('common.copySuffix')}`,
        selectedTasks: sourceInstance.selectedTasks.map((t) => ({
          ...t,
          id: generateId(),
          optionValues: { ...t.optionValues },
        })),
        isRunning: false,
      };

      set({
        instances: [...state.instances, newInstance],
        activeInstanceId: newId,
        nextInstanceNumber: instanceNumber + 1,
      });

      return newId;
    },

    // 全局 UI 状态
    showAddTaskPanel: false,
    setShowAddTaskPanel: (show) => set({ showAddTaskPanel: show }),

    // 最近添加的任务 ID
    lastAddedTaskId: null,
    clearLastAddedTaskId: () => set({ lastAddedTaskId: null }),

    // 正在播放入场动画的任务 ID 列表
    animatingTaskIds: [],
    removeAnimatingTaskId: (taskId) =>
      set((state) => ({
        animatingTaskIds: state.animatingTaskIds.filter((id) => id !== taskId),
      })),

    // 标签页动画状态
    animatingTabIds: [],
    closingTabIds: [],
    removeAnimatingTabId: (tabId) =>
      set((state) => ({
        animatingTabIds: state.animatingTabIds.filter((id) => id !== tabId),
      })),
    startTabCloseAnimation: (tabId) => {
      const state = get();
      if (state.instances.length <= 1) return; // 最后一个标签不能关闭

      // 添加到关闭动画列表
      set((s) => ({
        closingTabIds: [...s.closingTabIds, tabId],
      }));

      // 动画结束后真正删除
      setTimeout(() => {
        const currentState = get();
        // 从关闭动画列表移除
        set((s) => ({
          closingTabIds: s.closingTabIds.filter((id) => id !== tabId),
        }));
        // 调用原始的 removeInstance
        currentState.removeInstance(tabId);
      }, 120); // 与 CSS 动画时长一致
    },

    // 新增任务名称列表（会持久化到配置文件）
    newTaskNames: [],
    setNewTaskNames: (names) => set({ newTaskNames: names }),
    removeNewTaskName: (name) =>
      set((state) => ({
        newTaskNames: state.newTaskNames.filter((n) => n !== name),
      })),
    clearNewTaskNames: () => set({ newTaskNames: [] }),

    // 国际化文本解析
    resolveI18nText: (text, lang) => {
      if (!text) return '';
      if (!text.startsWith('$')) return text;

      const key = text.slice(1);
      const translations = get().interfaceTranslations[lang];
      return translations?.[key] || key;
    },

    // 配置导入
    importConfig: (config) => {
      const pi = get().projectInterface;

      // 获取保存时的任务快照，用于判断哪些是真正新增的任务
      const snapshotTaskNames = new Set(config.interfaceTaskSnapshot || []);

      // 检测新增任务（相比快照）并与已保存的 newTaskNames 合并
      const savedNewTaskNames = new Set(config.newTaskNames || []);
      const detectedNewTaskNames: string[] = [];
      if (pi) {
        pi.task.forEach((task) => {
          // 任务在快照中不存在即为新增任务，或者之前已标记为新增但用户未查看
          if (!snapshotTaskNames.has(task.name) || savedNewTaskNames.has(task.name)) {
            detectedNewTaskNames.push(task.name);
          }
        });
      }

      const instances: Instance[] = config.instances.map((inst) => {
        // 恢复已保存的任务（不再自动添加新增任务到列表）
        const savedTasks: SelectedTask[] = inst.tasks.map((t) => ({
          id: t.id,
          taskName: t.taskName,
          customName: t.customName,
          enabled: t.enabled,
          optionValues: t.optionValues,
          expanded: false,
        }));

        return {
          id: inst.id,
          name: inst.name,
          controllerId: inst.controllerId,
          resourceId: inst.resourceId,
          controllerName: inst.controllerName,
          resourceName: inst.resourceName,
          savedDevice: inst.savedDevice,
          selectedTasks: savedTasks,
          isRunning: false,
          schedulePolicies: inst.schedulePolicies,
        };
      });

      // 恢复选中的控制器和资源状态
      const selectedController: Record<string, string> = {};
      const selectedResource: Record<string, string> = {};
      instances.forEach((inst) => {
        if (inst.controllerName) {
          selectedController[inst.id] = inst.controllerName;
        }
        if (inst.resourceName) {
          selectedResource[inst.id] = inst.resourceName;
        }
      });

      // 根据已有实例名字计算下一个编号，避免重复
      let maxNumber = 0;
      instances.forEach((inst) => {
        const match = inst.name.match(/^配置\s*(\d+)$/);
        if (match) {
          maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
        }
      });

      const accentColor = (config.settings.accentColor as AccentColor) || 'deepsea';

      set({
        instances,
        activeInstanceId: instances.length > 0 ? instances[0].id : null,
        theme: config.settings.theme,
        accentColor,
        language: config.settings.language,
        selectedController,
        selectedResource,
        nextInstanceNumber: maxNumber + 1,
        windowSize: config.settings.windowSize || defaultWindowSize,
        mirrorChyanSettings: config.settings.mirrorChyan || defaultMirrorChyanSettings,
        showOptionPreview: config.settings.showOptionPreview ?? true,
        sidePanelExpanded: config.settings.sidePanelExpanded ?? true,
        rightPanelWidth: config.settings.rightPanelWidth ?? 320,
        rightPanelCollapsed: config.settings.rightPanelCollapsed ?? false,
        connectionPanelExpanded: config.settings.connectionPanelExpanded ?? true,
        screenshotPanelExpanded: config.settings.screenshotPanelExpanded ?? true,
        screenshotFrameRate: config.settings.screenshotFrameRate ?? defaultScreenshotFrameRate,
        welcomeShownHash: config.settings.welcomeShownHash ?? '',
        devMode: config.settings.devMode ?? false,
        onboardingCompleted: config.settings.onboardingCompleted ?? false,
        recentlyClosed: config.recentlyClosed || [],
        // 记录新增任务，并在有新增时自动展开添加任务面板
        newTaskNames: detectedNewTaskNames,
        showAddTaskPanel: detectedNewTaskNames.length > 0,
      });

      // 应用主题（包括强调色）
      const theme = config.settings.theme;
      const mode = resolveThemeMode(theme);
      applyTheme(mode, accentColor);
      localStorage.setItem('mxu-language', config.settings.language);
    },

    // MaaFramework 状态
    maaInitialized: false,
    maaVersion: null,
    setMaaInitialized: (initialized, version) =>
      set({
        maaInitialized: initialized,
        maaVersion: version || null,
      }),

    // 实例运行时状态
    instanceConnectionStatus: {},
    instanceResourceLoaded: {},
    instanceCurrentTaskId: {},
    instanceTaskStatus: {},

    setInstanceConnectionStatus: (instanceId, status) =>
      set((state) => ({
        instanceConnectionStatus: {
          ...state.instanceConnectionStatus,
          [instanceId]: status,
        },
      })),

    setInstanceResourceLoaded: (instanceId, loaded) =>
      set((state) => ({
        instanceResourceLoaded: {
          ...state.instanceResourceLoaded,
          [instanceId]: loaded,
        },
      })),

    setInstanceCurrentTaskId: (instanceId, taskId) =>
      set((state) => ({
        instanceCurrentTaskId: {
          ...state.instanceCurrentTaskId,
          [instanceId]: taskId,
        },
      })),

    setInstanceTaskStatus: (instanceId, status) =>
      set((state) => ({
        instanceTaskStatus: {
          ...state.instanceTaskStatus,
          [instanceId]: status,
        },
      })),

    // 选中的控制器和资源
    selectedController: {},
    selectedResource: {},

    setSelectedController: (instanceId, controllerName) =>
      set((state) => {
        const pi = state.projectInterface;
        // 自动取消不兼容任务的勾选
        const updatedInstances = state.instances.map((instance) => {
          if (instance.id !== instanceId)
            return { ...instance, controllerName: instance.controllerName };

          const updatedTasks = instance.selectedTasks.map((task) => {
            const taskDef = pi?.task.find((t) => t.name === task.taskName);
            // 如果任务指定了 controller 限制且不包含新控制器，取消勾选
            if (taskDef?.controller && taskDef.controller.length > 0) {
              if (!taskDef.controller.includes(controllerName)) {
                return { ...task, enabled: false };
              }
            }
            return task;
          });

          return { ...instance, controllerName, selectedTasks: updatedTasks };
        });

        return {
          selectedController: {
            ...state.selectedController,
            [instanceId]: controllerName,
          },
          instances: updatedInstances,
        };
      }),

    setSelectedResource: (instanceId, resourceName) =>
      set((state) => {
        const pi = state.projectInterface;
        // 自动取消不兼容任务的勾选
        const updatedInstances = state.instances.map((instance) => {
          if (instance.id !== instanceId)
            return { ...instance, resourceName: instance.resourceName };

          const updatedTasks = instance.selectedTasks.map((task) => {
            const taskDef = pi?.task.find((t) => t.name === task.taskName);
            // 如果任务指定了 resource 限制且不包含新资源，取消勾选
            if (taskDef?.resource && taskDef.resource.length > 0) {
              if (!taskDef.resource.includes(resourceName)) {
                return { ...task, enabled: false };
              }
            }
            return task;
          });

          return { ...instance, resourceName, selectedTasks: updatedTasks };
        });

        return {
          selectedResource: {
            ...state.selectedResource,
            [instanceId]: resourceName,
          },
          instances: updatedInstances,
        };
      }),

    // 保存设备信息到实例
    setInstanceSavedDevice: (instanceId, savedDevice) =>
      set((state) => ({
        instances: state.instances.map((i) => (i.id === instanceId ? { ...i, savedDevice } : i)),
      })),

    // 设备列表缓存
    cachedAdbDevices: [],
    cachedWin32Windows: [],
    setCachedAdbDevices: (devices) => set({ cachedAdbDevices: devices }),
    setCachedWin32Windows: (windows) => set({ cachedWin32Windows: windows }),

    // 从后端恢复 MAA 运行时状态
    restoreBackendStates: (states) =>
      set((currentState) => {
        const connectionStatus: Record<string, ConnectionStatus> = {};
        const resourceLoaded: Record<string, boolean> = {};
        const taskStatus: Record<string, TaskStatus | null> = {};

        // 更新实例的 isRunning 状态
        const updatedInstances = currentState.instances.map((instance) => {
          const backendState = states.instances[instance.id];
          if (backendState) {
            // 只有当后端有正在运行的任务时，才恢复 isRunning 状态
            // taskIds 为空表示用户已停止任务（MaaTaskerPostStop 清空了 task_ids，
            // 但 MaaTaskerRunning 可能在回调完成前仍返回 true）
            const isRunning = backendState.isRunning && backendState.taskIds.length > 0;
            return {
              ...instance,
              isRunning,
            };
          }
          return instance;
        });

        for (const [instanceId, state] of Object.entries(states.instances)) {
          connectionStatus[instanceId] = state.connected ? 'Connected' : 'Disconnected';
          resourceLoaded[instanceId] = state.resourceLoaded;
          // 同样检查 taskIds，避免显示错误的运行状态
          if (state.isRunning && state.taskIds.length > 0) {
            taskStatus[instanceId] = 'Running';
          }
        }

        return {
          instances: updatedInstances,
          instanceConnectionStatus: connectionStatus,
          instanceResourceLoaded: resourceLoaded,
          instanceTaskStatus: taskStatus,
          cachedAdbDevices: states.cachedAdbDevices,
          cachedWin32Windows: states.cachedWin32Windows,
        };
      }),

    // 截图流状态
    instanceScreenshotStreaming: {},
    setInstanceScreenshotStreaming: (instanceId, streaming) =>
      set((state) => ({
        instanceScreenshotStreaming: {
          ...state.instanceScreenshotStreaming,
          [instanceId]: streaming,
        },
      })),

    // 右侧面板折叠状态
    sidePanelExpanded: true,
    setSidePanelExpanded: (expanded) => set({ sidePanelExpanded: expanded }),
    toggleSidePanelExpanded: () =>
      set((state) => ({ sidePanelExpanded: !state.sidePanelExpanded })),

    // 右侧面板宽度和折叠状态
    rightPanelWidth: 320,
    rightPanelCollapsed: false,
    setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
    setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),

    // 卡片展开状态
    connectionPanelExpanded: true,
    screenshotPanelExpanded: true,
    setConnectionPanelExpanded: (expanded) => set({ connectionPanelExpanded: expanded }),
    setScreenshotPanelExpanded: (expanded) => set({ screenshotPanelExpanded: expanded }),

    // 中控台视图模式
    dashboardView: false,
    setDashboardView: (enabled) => set({ dashboardView: enabled }),
    toggleDashboardView: () => set((state) => ({ dashboardView: !state.dashboardView })),

    // 窗口大小
    windowSize: defaultWindowSize,
    setWindowSize: (size) => set({ windowSize: size }),

    // MirrorChyan 更新设置
    mirrorChyanSettings: defaultMirrorChyanSettings,
    setMirrorChyanCdk: (cdk) =>
      set((state) => ({
        mirrorChyanSettings: { ...state.mirrorChyanSettings, cdk },
      })),
    setMirrorChyanChannel: (channel) =>
      set((state) => ({
        mirrorChyanSettings: { ...state.mirrorChyanSettings, channel },
      })),

    // 任务选项预览显示设置
    showOptionPreview: true,
    setShowOptionPreview: (show) => set({ showOptionPreview: show }),

    // 实时截图帧率设置
    screenshotFrameRate: defaultScreenshotFrameRate,
    setScreenshotFrameRate: (rate) => set({ screenshotFrameRate: rate }),

    // Welcome 弹窗显示记录
    welcomeShownHash: '',
    setWelcomeShownHash: (hash) => set({ welcomeShownHash: hash }),

    // 开发模式
    devMode: false,
    setDevMode: (devMode) => set({ devMode }),

    // 新用户引导
    onboardingCompleted: false,
    setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),

    // 更新检查状态
    updateInfo: null,
    updateCheckLoading: false,
    showUpdateDialog: false,
    setUpdateInfo: (info) => set({ updateInfo: info }),
    setUpdateCheckLoading: (loading) => set({ updateCheckLoading: loading }),
    setShowUpdateDialog: (show) => set({ showUpdateDialog: show }),

    // 下载状态
    downloadStatus: 'idle',
    downloadProgress: null,
    downloadSavePath: null,
    setDownloadStatus: (status) => set({ downloadStatus: status }),
    setDownloadProgress: (progress) => set({ downloadProgress: progress }),
    setDownloadSavePath: (path) => set({ downloadSavePath: path }),
    resetDownloadState: () =>
      set({
        downloadStatus: 'idle',
        downloadProgress: null,
        downloadSavePath: null,
      }),

    // 安装状态
    showInstallConfirmModal: false,
    installStatus: 'idle',
    installError: null,
    justUpdatedInfo: null,
    setShowInstallConfirmModal: (show) =>
      set({
        showInstallConfirmModal: show,
        // 打开模态框时自动关闭更新气泡
        ...(show && { showUpdateDialog: false }),
      }),
    setInstallStatus: (status) => set({ installStatus: status }),
    setInstallError: (error) => set({ installError: error }),
    setJustUpdatedInfo: (info) => set({ justUpdatedInfo: info }),
    resetInstallState: () =>
      set({
        installStatus: 'idle',
        installError: null,
      }),

    // 最近关闭的实例
    recentlyClosed: [],

    reopenRecentlyClosed: (id) => {
      const state = get();
      const closedInstance = state.recentlyClosed.find((i) => i.id === id);
      if (!closedInstance) return null;

      const newId = generateId();
      const newInstance: Instance = {
        id: newId,
        name: closedInstance.name,
        controllerId: closedInstance.controllerId,
        resourceId: closedInstance.resourceId,
        controllerName: closedInstance.controllerName,
        resourceName: closedInstance.resourceName,
        savedDevice: closedInstance.savedDevice,
        selectedTasks: closedInstance.tasks.map((t) => ({
          id: generateId(),
          taskName: t.taskName,
          customName: t.customName,
          enabled: t.enabled,
          optionValues: t.optionValues,
          expanded: false,
        })),
        isRunning: false,
        schedulePolicies: closedInstance.schedulePolicies,
      };

      // 恢复选中的控制器和资源状态
      const newSelectedController = { ...state.selectedController };
      const newSelectedResource = { ...state.selectedResource };
      if (closedInstance.controllerName) {
        newSelectedController[newId] = closedInstance.controllerName;
      }
      if (closedInstance.resourceName) {
        newSelectedResource[newId] = closedInstance.resourceName;
      }

      set({
        instances: [...state.instances, newInstance],
        activeInstanceId: newId,
        recentlyClosed: state.recentlyClosed.filter((i) => i.id !== id),
        selectedController: newSelectedController,
        selectedResource: newSelectedResource,
      });

      return newId;
    },

    removeFromRecentlyClosed: (id) =>
      set((state) => ({
        recentlyClosed: state.recentlyClosed.filter((i) => i.id !== id),
      })),

    clearRecentlyClosed: () => set({ recentlyClosed: [] }),

    // 任务运行状态
    instanceTaskRunStatus: {},
    maaTaskIdMapping: {},

    setTaskRunStatus: (instanceId, selectedTaskId, status) =>
      set((state) => ({
        instanceTaskRunStatus: {
          ...state.instanceTaskRunStatus,
          [instanceId]: {
            ...state.instanceTaskRunStatus[instanceId],
            [selectedTaskId]: status,
          },
        },
      })),

    setAllTasksRunStatus: (instanceId, taskIds, status) =>
      set((state) => {
        const taskStatus: Record<string, TaskRunStatus> = {};
        taskIds.forEach((id) => {
          taskStatus[id] = status;
        });
        return {
          instanceTaskRunStatus: {
            ...state.instanceTaskRunStatus,
            [instanceId]: taskStatus,
          },
        };
      }),

    registerMaaTaskMapping: (instanceId, maaTaskId, selectedTaskId) =>
      set((state) => ({
        maaTaskIdMapping: {
          ...state.maaTaskIdMapping,
          [instanceId]: {
            ...state.maaTaskIdMapping[instanceId],
            [maaTaskId]: selectedTaskId,
          },
        },
      })),

    findSelectedTaskIdByMaaTaskId: (instanceId, maaTaskId) => {
      const state = get();
      const mapping = state.maaTaskIdMapping[instanceId];
      return mapping?.[maaTaskId] || null;
    },

    findMaaTaskIdBySelectedTaskId: (instanceId, selectedTaskId) => {
      const state = get();
      const mapping = state.maaTaskIdMapping[instanceId];
      if (!mapping) return null;
      // 反向查找：遍历 mapping 找到 value 等于 selectedTaskId 的 key
      for (const [maaTaskIdStr, taskId] of Object.entries(mapping)) {
        if (taskId === selectedTaskId) {
          return parseInt(maaTaskIdStr, 10);
        }
      }
      return null;
    },

    clearTaskRunStatus: (instanceId) =>
      set((state) => ({
        instanceTaskRunStatus: {
          ...state.instanceTaskRunStatus,
          [instanceId]: {},
        },
        maaTaskIdMapping: {
          ...state.maaTaskIdMapping,
          [instanceId]: {},
        },
      })),

    // 运行中任务队列管理
    instancePendingTaskIds: {},
    instanceCurrentTaskIndex: {},

    setPendingTaskIds: (instanceId, taskIds) =>
      set((state) => ({
        instancePendingTaskIds: {
          ...state.instancePendingTaskIds,
          [instanceId]: taskIds,
        },
      })),

    appendPendingTaskId: (instanceId, taskId) =>
      set((state) => ({
        instancePendingTaskIds: {
          ...state.instancePendingTaskIds,
          [instanceId]: [...(state.instancePendingTaskIds[instanceId] || []), taskId],
        },
      })),

    setCurrentTaskIndex: (instanceId, index) =>
      set((state) => ({
        instanceCurrentTaskIndex: {
          ...state.instanceCurrentTaskIndex,
          [instanceId]: index,
        },
      })),

    advanceCurrentTaskIndex: (instanceId) =>
      set((state) => ({
        instanceCurrentTaskIndex: {
          ...state.instanceCurrentTaskIndex,
          [instanceId]: (state.instanceCurrentTaskIndex[instanceId] || 0) + 1,
        },
      })),

    clearPendingTasks: (instanceId) =>
      set((state) => ({
        instancePendingTaskIds: {
          ...state.instancePendingTaskIds,
          [instanceId]: [],
        },
        instanceCurrentTaskIndex: {
          ...state.instanceCurrentTaskIndex,
          [instanceId]: 0,
        },
      })),

    // 定时执行状态
    scheduleExecutions: {},

    setScheduleExecution: (instanceId, info) =>
      set((state) => ({
        scheduleExecutions: info
          ? { ...state.scheduleExecutions, [instanceId]: info }
          : Object.fromEntries(
              Object.entries(state.scheduleExecutions).filter(([id]) => id !== instanceId),
            ),
      })),

    clearScheduleExecution: (instanceId) =>
      set((state) => ({
        scheduleExecutions: Object.fromEntries(
          Object.entries(state.scheduleExecutions).filter(([id]) => id !== instanceId),
        ),
      })),

    // 日志管理
    instanceLogs: {},

    addLog: (instanceId, log) =>
      set((state) => {
        const logs = state.instanceLogs[instanceId] || [];
        const newLog: LogEntry = {
          id: generateId(),
          timestamp: new Date(),
          ...log,
        };
        // 限制每个实例最多保留 500 条日志
        const updatedLogs = [...logs, newLog].slice(-500);
        return {
          instanceLogs: {
            ...state.instanceLogs,
            [instanceId]: updatedLogs,
          },
        };
      }),

    clearLogs: (instanceId) =>
      set((state) => ({
        instanceLogs: {
          ...state.instanceLogs,
          [instanceId]: [],
        },
      })),

    // 回调 ID 与名称的映射
    ctrlIdToName: {},
    ctrlIdToType: {},
    resIdToName: {},
    taskIdToName: {},
    entryToTaskName: {},

    registerCtrlIdName: (ctrlId, name, type) =>
      set((state) => ({
        ctrlIdToName: { ...state.ctrlIdToName, [ctrlId]: name },
        ctrlIdToType: { ...state.ctrlIdToType, [ctrlId]: type },
      })),

    registerResIdName: (resId, name) =>
      set((state) => ({
        resIdToName: { ...state.resIdToName, [resId]: name },
      })),

    registerTaskIdName: (taskId, name) =>
      set((state) => ({
        taskIdToName: { ...state.taskIdToName, [taskId]: name },
      })),

    registerEntryTaskName: (entry, name) =>
      set((state) => ({
        entryToTaskName: { ...state.entryToTaskName, [entry]: name },
      })),

    getCtrlName: (ctrlId) => get().ctrlIdToName[ctrlId],
    getCtrlType: (ctrlId) => get().ctrlIdToType[ctrlId],
    getResName: (resId) => get().resIdToName[resId],
    getTaskName: (taskId) => get().taskIdToName[taskId],
    getTaskNameByEntry: (entry) => get().entryToTaskName[entry],
  })),
);

// 生成配置用于保存
function generateConfig(): MxuConfig {
  const state = useAppStore.getState();
  return {
    version: '1.0',
    instances: state.instances.map((inst) => ({
      id: inst.id,
      name: inst.name,
      controllerId: inst.controllerId,
      resourceId: inst.resourceId,
      controllerName: inst.controllerName,
      resourceName: inst.resourceName,
      savedDevice: inst.savedDevice,
      tasks: inst.selectedTasks.map((t) => ({
        id: t.id,
        taskName: t.taskName,
        customName: t.customName,
        enabled: t.enabled,
        optionValues: t.optionValues,
      })),
      schedulePolicies: inst.schedulePolicies,
    })),
    settings: {
      theme: state.theme,
      accentColor: state.accentColor,
      language: state.language,
      windowSize: state.windowSize,
      mirrorChyan: state.mirrorChyanSettings,
      showOptionPreview: state.showOptionPreview,
      sidePanelExpanded: state.sidePanelExpanded,
      rightPanelWidth: state.rightPanelWidth,
      rightPanelCollapsed: state.rightPanelCollapsed,
      connectionPanelExpanded: state.connectionPanelExpanded,
      screenshotPanelExpanded: state.screenshotPanelExpanded,
      screenshotFrameRate: state.screenshotFrameRate,
      welcomeShownHash: state.welcomeShownHash,
      devMode: state.devMode,
      onboardingCompleted: state.onboardingCompleted,
    },
    recentlyClosed: state.recentlyClosed,
    // 保存当前 interface.json 的任务名列表快照，用于下次加载时检测新增任务
    interfaceTaskSnapshot: state.projectInterface?.task.map((t) => t.name) || [],
    // 保存用户尚未查看的新增任务
    newTaskNames: state.newTaskNames,
  };
}

// 防抖保存配置
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveConfig() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    const state = useAppStore.getState();
    const config = generateConfig();
    const projectName = state.projectInterface?.name;
    saveConfig(state.basePath, config, projectName);
  }, 500);
}

// 订阅需要保存的状态变化
useAppStore.subscribe(
  (state) => ({
    instances: state.instances,
    activeInstanceId: state.activeInstanceId,
    theme: state.theme,
    accentColor: state.accentColor,
    language: state.language,
    windowSize: state.windowSize,
    mirrorChyanSettings: state.mirrorChyanSettings,
    showOptionPreview: state.showOptionPreview,
    sidePanelExpanded: state.sidePanelExpanded,
    rightPanelWidth: state.rightPanelWidth,
    rightPanelCollapsed: state.rightPanelCollapsed,
    connectionPanelExpanded: state.connectionPanelExpanded,
    screenshotPanelExpanded: state.screenshotPanelExpanded,
    screenshotFrameRate: state.screenshotFrameRate,
    welcomeShownHash: state.welcomeShownHash,
    devMode: state.devMode,
    onboardingCompleted: state.onboardingCompleted,
    recentlyClosed: state.recentlyClosed,
    newTaskNames: state.newTaskNames,
  }),
  () => {
    debouncedSaveConfig();
  },
  { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
);
