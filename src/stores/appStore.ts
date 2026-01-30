import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Instance, SelectedTask } from '@/types/interface';
import type { MxuConfig, RecentlyClosedInstance } from '@/types/config';
import {
  defaultWindowSize,
  defaultMirrorChyanSettings,
  defaultScreenshotFrameRate,
} from '@/types/config';
import { findSwitchCase } from '@/utils/optionHelpers';
import type { ConnectionStatus, TaskStatus } from '@/types/maa';
import { saveConfig } from '@/services/configService';
import i18n, { getInterfaceLangKey, setLanguage as setI18nLanguage } from '@/i18n';
import {
  applyTheme,
  resolveThemeMode,
  type AccentColor,
  type CustomAccent,
  registerCustomAccent,
  unregisterCustomAccent,
  clearCustomAccents,
} from '@/themes';
import { loggers } from '@/utils/logger';
import { maaService } from '@/services/maaService';

// 从独立模块导入类型和辅助函数
import type { AppState, TaskRunStatus, LogEntry } from './types';
import { generateId, initializeAllOptionValues } from './helpers';

// 重新导出类型供外部使用
export type {
  TaskRunStatus,
  LogType,
  LogEntry,
  Theme,
  Language,
  PageView,
  ScheduleExecutionInfo,
  UpdateInfo,
  DownloadProgress,
  DownloadStatus,
  InstallStatus,
  JustUpdatedInfo,
} from './types';

// 最近关闭列表最大条目数
const MAX_RECENTLY_CLOSED = 30;

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    // 主题和语言
    theme: 'light',
    accentColor: 'emerald',
    language: 'system',
    confirmBeforeDelete: false,
    maxLogsPerInstance: 2000,
    customAccents: [],
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
      setI18nLanguage(lang);
    },
    setConfirmBeforeDelete: (enabled) => set({ confirmBeforeDelete: enabled }),
    setMaxLogsPerInstance: (value) =>
      set({ maxLogsPerInstance: Math.max(100, Math.min(10000, Math.floor(value))) }),
    addCustomAccent: (accent) => {
      set((state) => ({
        customAccents: [...state.customAccents, accent],
      }));
      registerCustomAccent(accent);
      // 如果当前使用的是这个自定义强调色，重新应用主题
      const { theme, accentColor } = get();
      if (accentColor === accent.name) {
        const mode = resolveThemeMode(theme);
        applyTheme(mode, accent.name);
      }
    },
    updateCustomAccent: (id, accent) => {
      set((state) => ({
        customAccents: state.customAccents.map((a) => (a.id === id ? accent : a)),
      }));
      // 先移除旧的，再注册新的
      const oldAccent = get().customAccents.find((a) => a.id === id);
      if (oldAccent) {
        unregisterCustomAccent(oldAccent.name);
      }
      registerCustomAccent(accent);
      // 如果当前使用的是这个自定义强调色，重新应用主题
      const { theme, accentColor } = get();
      if (accentColor === accent.name) {
        const mode = resolveThemeMode(theme);
        applyTheme(mode, accent.name);
      }
    },
    removeCustomAccent: (id) => {
      const accent = get().customAccents.find((a) => a.id === id);
      if (accent) {
        unregisterCustomAccent(accent.name);
        set((state) => ({
          customAccents: state.customAccents.filter((a) => a.id !== id),
        }));
        // 如果当前使用的是这个自定义强调色，切换到默认强调色
        const { theme, accentColor } = get();
        if (accentColor === accent.name) {
          const defaultAccent: AccentColor = 'emerald';
          set({ accentColor: defaultAccent });
          const mode = resolveThemeMode(theme);
          applyTheme(mode, defaultAccent);
        }
      }
    },
    reorderCustomAccents: (oldIndex, newIndex) => {
      set((state) => {
        const next = [...state.customAccents];
        if (oldIndex < 0 || newIndex < 0 || oldIndex >= next.length || newIndex >= next.length) {
          return { customAccents: next };
        }
        const [moved] = next.splice(oldIndex, 1);
        next.splice(newIndex, 0, moved);
        return { customAccents: next };
      });
    },

    // 快捷键设置（默认：F10 开始任务，F11 结束任务）
    hotkeys: {
      startTasks: 'F10',
      stopTasks: 'F11',
    },
    setHotkeys: (hotkeys) => set({ hotkeys }),

    // 当前页面
    currentPage: 'main',
    setCurrentPage: (page) => set({ currentPage: page }),

    // 调试选项（不落盘，每次启动默认关闭）
    saveDraw: false,
    setSaveDraw: async (enabled) => {
      set({ saveDraw: enabled });
      // 调用 MaaFramework API 设置全局选项
      try {
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
                    selectedCase = findSwitchCase(optDef.cases, isChecked);
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

      // 加载自定义强调色
      const customAccents = config.customAccents || [];
      // 清除旧的自定义强调色
      clearCustomAccents();
      // 注册新的自定义强调色
      customAccents.forEach((accent: CustomAccent) => {
        registerCustomAccent(accent);
      });

      set({
        instances,
        activeInstanceId: instances.length > 0 ? instances[0].id : null,
        theme: config.settings.theme,
        accentColor,
        language: config.settings.language,
        confirmBeforeDelete: config.settings.confirmBeforeDelete ?? false,
        maxLogsPerInstance: config.settings.maxLogsPerInstance ?? 2000,
        customAccents,
        selectedController,
        selectedResource,
        nextInstanceNumber: maxNumber + 1,
        windowSize: config.settings.windowSize || defaultWindowSize,
        mirrorChyanSettings: config.settings.mirrorChyan || defaultMirrorChyanSettings,
        proxySettings: config.settings.proxy,
        showOptionPreview: config.settings.showOptionPreview ?? true,
        sidePanelExpanded: config.settings.sidePanelExpanded ?? true,
        rightPanelWidth: config.settings.rightPanelWidth ?? 320,
        rightPanelCollapsed: config.settings.rightPanelCollapsed ?? false,
        connectionPanelExpanded: config.settings.connectionPanelExpanded ?? true,
        screenshotPanelExpanded: config.settings.screenshotPanelExpanded ?? true,
        screenshotFrameRate: config.settings.screenshotFrameRate ?? defaultScreenshotFrameRate,
        welcomeShownHash: config.settings.welcomeShownHash ?? '',
        devMode: config.settings.devMode ?? false,
        tcpCompatMode: config.settings.tcpCompatMode ?? false,
        onboardingCompleted: config.settings.onboardingCompleted ?? false,
        hotkeys: config.settings.hotkeys ?? { startTasks: 'F10', stopTasks: 'F11' },
        recentlyClosed: config.recentlyClosed || [],
        // 记录新增任务，并在有新增时自动展开添加任务面板
        newTaskNames: detectedNewTaskNames,
        showAddTaskPanel: detectedNewTaskNames.length > 0,
      });

      // 应用主题（包括强调色）
      const theme = config.settings.theme;
      const mode = resolveThemeMode(theme);
      applyTheme(mode, accentColor);
      setI18nLanguage(config.settings.language);
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

    // 代理设置
    proxySettings: undefined,
    setProxySettings: (settings) => set({ proxySettings: settings }),

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

    // 通信兼容模式
    tcpCompatMode: false,
    setTcpCompatMode: (enabled) => set({ tcpCompatMode: enabled }),

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
        // 限制每个实例最多保留 N 条日志（超出丢弃最旧的）。
        // 这里也做归一化，避免配置错误导致无限增长；与 UI 限制保持一致：[100, 10000]，默认 2000。
        const DEFAULT_MAX_LOGS_PER_INSTANCE = 2000;
        const rawLimit = Number.isFinite(state.maxLogsPerInstance)
          ? state.maxLogsPerInstance
          : DEFAULT_MAX_LOGS_PER_INSTANCE;
        const limit = Math.min(10000, Math.max(100, Math.floor(rawLimit)));
        const updatedLogs = [...logs, newLog].slice(-limit);
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
      confirmBeforeDelete: state.confirmBeforeDelete,
      maxLogsPerInstance: state.maxLogsPerInstance,
      windowSize: state.windowSize,
      mirrorChyan: state.mirrorChyanSettings,
      proxy: state.proxySettings,
      showOptionPreview: state.showOptionPreview,
      sidePanelExpanded: state.sidePanelExpanded,
      rightPanelWidth: state.rightPanelWidth,
      rightPanelCollapsed: state.rightPanelCollapsed,
      connectionPanelExpanded: state.connectionPanelExpanded,
      screenshotPanelExpanded: state.screenshotPanelExpanded,
      screenshotFrameRate: state.screenshotFrameRate,
      welcomeShownHash: state.welcomeShownHash,
      devMode: state.devMode,
      tcpCompatMode: state.tcpCompatMode,
      onboardingCompleted: state.onboardingCompleted,
      hotkeys: state.hotkeys,
    },
    recentlyClosed: state.recentlyClosed,
    // 保存当前 interface.json 的任务名列表快照，用于下次加载时检测新增任务
    interfaceTaskSnapshot: state.projectInterface?.task.map((t) => t.name) || [],
    // 保存用户尚未查看的新增任务
    newTaskNames: state.newTaskNames,
    // 保存自定义强调色
    customAccents: state.customAccents,
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
    confirmBeforeDelete: state.confirmBeforeDelete,
    maxLogsPerInstance: state.maxLogsPerInstance,
    windowSize: state.windowSize,
    mirrorChyanSettings: state.mirrorChyanSettings,
    proxySettings: state.proxySettings,
    showOptionPreview: state.showOptionPreview,
    sidePanelExpanded: state.sidePanelExpanded,
    rightPanelWidth: state.rightPanelWidth,
    rightPanelCollapsed: state.rightPanelCollapsed,
    connectionPanelExpanded: state.connectionPanelExpanded,
    screenshotPanelExpanded: state.screenshotPanelExpanded,
    screenshotFrameRate: state.screenshotFrameRate,
    welcomeShownHash: state.welcomeShownHash,
    devMode: state.devMode,
    tcpCompatMode: state.tcpCompatMode,
    onboardingCompleted: state.onboardingCompleted,
    hotkeys: state.hotkeys,
    recentlyClosed: state.recentlyClosed,
    newTaskNames: state.newTaskNames,
    customAccents: state.customAccents,
  }),
  () => {
    debouncedSaveConfig();
  },
  { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
);
