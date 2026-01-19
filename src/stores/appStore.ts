import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ProjectInterface, Instance, SelectedTask, OptionValue, TaskItem, OptionDefinition, SavedDeviceInfo } from '@/types/interface';
import type { MxuConfig, WindowSize, UpdateChannel, MirrorChyanSettings, RecentlyClosedInstance } from '@/types/config';
import { defaultWindowSize, defaultMirrorChyanSettings } from '@/types/config';

// 最近关闭列表最大条目数
const MAX_RECENTLY_CLOSED = 30;
import type { ConnectionStatus, TaskStatus, AdbDevice, Win32Window } from '@/types/maa';
import { saveConfig } from '@/services/configService';

export type Theme = 'light' | 'dark';
export type Language = 'zh-CN' | 'en-US';
export type PageView = 'main' | 'settings';

interface AppState {
  // 主题和语言
  theme: Theme;
  language: Language;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  
  // 当前页面
  currentPage: PageView;
  setCurrentPage: (page: PageView) => void;
  
  // Interface 数据
  projectInterface: ProjectInterface | null;
  interfaceTranslations: Record<string, Record<string, string>>;
  basePath: string;  // 资源基础路径，用于保存配置
  setProjectInterface: (pi: ProjectInterface) => void;
  setInterfaceTranslations: (lang: string, translations: Record<string, string>) => void;
  setBasePath: (path: string) => void;
  
  // 多开实例
  instances: Instance[];
  activeInstanceId: string | null;
  nextInstanceNumber: number;  // 递增计数器，确保实例名字编号不重复
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
  setTaskOptionValue: (instanceId: string, taskId: string, optionKey: string, value: OptionValue) => void;
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
  
  // 截图流状态（按实例独立）
  instanceScreenshotStreaming: Record<string, boolean>;
  setInstanceScreenshotStreaming: (instanceId: string, streaming: boolean) => void;

  // 右侧面板折叠状态（控制连接设置和截图面板的显示）
  sidePanelExpanded: boolean;
  setSidePanelExpanded: (expanded: boolean) => void;
  toggleSidePanelExpanded: () => void;
  
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
  
  // 更新检查状态
  updateInfo: UpdateInfo | null;
  updateCheckLoading: boolean;
  showUpdateDialog: boolean;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateCheckLoading: (loading: boolean) => void;
  setShowUpdateDialog: (show: boolean) => void;
  
  // 最近关闭的实例
  recentlyClosed: RecentlyClosedInstance[];
  reopenRecentlyClosed: (id: string) => string | null;
  removeFromRecentlyClosed: (id: string) => void;
  clearRecentlyClosed: () => void;
}

// 更新信息类型
export interface UpdateInfo {
  hasUpdate: boolean;
  versionName: string;
  releaseNote: string;
  downloadUrl?: string;
  updateType?: 'incremental' | 'full';
  channel?: string;
}

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// 创建默认选项值
const createDefaultOptionValue = (optionDef: OptionDefinition): OptionValue => {
  if (optionDef.type === 'input') {
    const values: Record<string, string> = {};
    optionDef.inputs.forEach(input => {
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
  result: Record<string, OptionValue> = {}
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
        const caseName = currentValue.type === 'select' ? currentValue.caseName : optDef.cases?.[0]?.name;
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
  subscribeWithSelector(
    (set, get) => ({
      // 主题和语言
      theme: 'light',
      language: 'zh-CN',
      setTheme: (theme) => {
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },
      setLanguage: (lang) => {
        set({ language: lang });
        localStorage.setItem('mxu-language', lang);
      },
      
      // 当前页面
      currentPage: 'main',
      setCurrentPage: (page) => set({ currentPage: page }),
      
      // Interface 数据
      projectInterface: null,
      interfaceTranslations: {},
      basePath: '.',
      setProjectInterface: (pi) => set({ projectInterface: pi }),
      setInterfaceTranslations: (lang, translations) => set((state) => ({
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
        
        // 初始化默认选中的任务
        const defaultTasks: SelectedTask[] = [];
        if (pi) {
          pi.task.filter(t => t.default_check).forEach(task => {
            // 递归初始化所有选项（包括嵌套选项）
            const optionValues = task.option && pi.option
              ? initializeAllOptionValues(task.option, pi.option)
              : {};
            defaultTasks.push({
              id: generateId(),
              taskName: task.name,
              enabled: true,
              optionValues,
              expanded: false,
            });
          });
        }
        
        const newInstance: Instance = {
          id,
          name: name || `配置 ${instanceNumber}`,
          selectedTasks: defaultTasks,
          isRunning: false,
        };
        
        set((state) => ({
          instances: [...state.instances, newInstance],
          activeInstanceId: id,
          nextInstanceNumber: state.nextInstanceNumber + 1,
        }));
        
        return id;
      },
      
      removeInstance: (id) => set((state) => {
        const instanceToClose = state.instances.find(i => i.id === id);
        const newInstances = state.instances.filter(i => i.id !== id);
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
            tasks: instanceToClose.selectedTasks.map(t => ({
              id: t.id,
              taskName: t.taskName,
              customName: t.customName,
              enabled: t.enabled,
              optionValues: t.optionValues,
            })),
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
      
      updateInstance: (id, updates) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === id ? { ...i, ...updates } : i
        ),
      })),
      
      renameInstance: (id, newName) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === id ? { ...i, name: newName } : i
        ),
      })),
      
      reorderInstances: (oldIndex, newIndex) => set((state) => {
        const instances = [...state.instances];
        const [removed] = instances.splice(oldIndex, 1);
        instances.splice(newIndex, 0, removed);
        return { instances };
      }),
      
      getActiveInstance: () => {
        const state = get();
        return state.instances.find(i => i.id === state.activeInstanceId) || null;
      },
      
      // 任务操作
      addTaskToInstance: (instanceId, task) => {
        const pi = get().projectInterface;
        if (!pi) return;
        
        // 递归初始化所有选项（包括嵌套选项）
        const optionValues = task.option && pi.option
          ? initializeAllOptionValues(task.option, pi.option)
          : {};
        
        const newTask: SelectedTask = {
          id: generateId(),
          taskName: task.name,
          enabled: true,
          optionValues,
          expanded: false,
        };
        
        set((state) => ({
          instances: state.instances.map(i => 
            i.id === instanceId 
              ? { ...i, selectedTasks: [...i.selectedTasks, newTask] }
              : i
          ),
        }));
      },
      
      removeTaskFromInstance: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? { ...i, selectedTasks: i.selectedTasks.filter(t => t.id !== taskId) }
            : i
        ),
      })),
      
      reorderTasks: (instanceId, oldIndex, newIndex) => set((state) => ({
        instances: state.instances.map(i => {
          if (i.id !== instanceId) return i;
          
          const tasks = [...i.selectedTasks];
          const [removed] = tasks.splice(oldIndex, 1);
          tasks.splice(newIndex, 0, removed);
          
          return { ...i, selectedTasks: tasks };
        }),
      })),
      
      toggleTaskEnabled: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId ? { ...t, enabled: !t.enabled } : t
                ),
              }
            : i
        ),
      })),
      
      toggleTaskExpanded: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId ? { ...t, expanded: !t.expanded } : t
                ),
              }
            : i
        ),
      })),
      
      setTaskOptionValue: (instanceId, taskId, optionKey, value) => {
        const pi = get().projectInterface;
        
        set((state) => ({
          instances: state.instances.map(i => {
            if (i.id !== instanceId) return i;
            
            return {
              ...i,
              selectedTasks: i.selectedTasks.map(t => {
                if (t.id !== taskId) return t;
                
                const newOptionValues = { ...t.optionValues, [optionKey]: value };
                
                // 当选项值改变时，初始化新的嵌套选项
                if (pi?.option) {
                  const optDef = pi.option[optionKey];
                  if (optDef && (optDef.type === 'switch' || optDef.type === 'select' || !optDef.type) && 'cases' in optDef) {
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
                      const caseName = value.type === 'select' ? value.caseName : optDef.cases?.[0]?.name;
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
      
      selectAllTasks: (instanceId, enabled) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => ({ ...t, enabled })),
              }
            : i
        ),
      })),
      
      collapseAllTasks: (instanceId, expanded) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => ({ ...t, expanded })),
              }
            : i
        ),
      })),
      
      renameTask: (instanceId, taskId, newName) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId ? { ...t, customName: newName || undefined } : t
                ),
              }
            : i
        ),
      })),
      
      // 复制任务
      duplicateTask: (instanceId, taskId) => {
        const state = get();
        const instance = state.instances.find(i => i.id === instanceId);
        if (!instance) return;
        
        const taskIndex = instance.selectedTasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;
        
        const originalTask = instance.selectedTasks[taskIndex];
        
        // 计算新任务的显示名称
        let newCustomName: string;
        if (originalTask.customName) {
          newCustomName = `${originalTask.customName}（副本）`;
        } else {
          // 获取任务的原始 label
          const taskDef = state.projectInterface?.task.find(t => t.name === originalTask.taskName);
          const langKey = state.language === 'zh-CN' ? 'zh_cn' : 'en_us';
          const originalLabel = state.resolveI18nText(taskDef?.label, langKey) || taskDef?.name || originalTask.taskName;
          newCustomName = `${originalLabel}（副本）`;
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
          instances: state.instances.map(i => 
            i.id === instanceId ? { ...i, selectedTasks: tasks } : i
          ),
        });
      },
      
      // 上移任务
      moveTaskUp: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => {
          if (i.id !== instanceId) return i;
          
          const taskIndex = i.selectedTasks.findIndex(t => t.id === taskId);
          if (taskIndex <= 0) return i;
          
          const tasks = [...i.selectedTasks];
          [tasks[taskIndex - 1], tasks[taskIndex]] = [tasks[taskIndex], tasks[taskIndex - 1]];
          
          return { ...i, selectedTasks: tasks };
        }),
      })),
      
      // 下移任务
      moveTaskDown: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => {
          if (i.id !== instanceId) return i;
          
          const taskIndex = i.selectedTasks.findIndex(t => t.id === taskId);
          if (taskIndex === -1 || taskIndex >= i.selectedTasks.length - 1) return i;
          
          const tasks = [...i.selectedTasks];
          [tasks[taskIndex], tasks[taskIndex + 1]] = [tasks[taskIndex + 1], tasks[taskIndex]];
          
          return { ...i, selectedTasks: tasks };
        }),
      })),
      
      // 置顶任务
      moveTaskToTop: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => {
          if (i.id !== instanceId) return i;
          
          const taskIndex = i.selectedTasks.findIndex(t => t.id === taskId);
          if (taskIndex <= 0) return i;
          
          const tasks = [...i.selectedTasks];
          const [task] = tasks.splice(taskIndex, 1);
          tasks.unshift(task);
          
          return { ...i, selectedTasks: tasks };
        }),
      })),
      
      // 置底任务
      moveTaskToBottom: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => {
          if (i.id !== instanceId) return i;
          
          const taskIndex = i.selectedTasks.findIndex(t => t.id === taskId);
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
        const sourceInstance = state.instances.find(i => i.id === instanceId);
        if (!sourceInstance) return '';
        
        const newId = generateId();
        const instanceNumber = state.nextInstanceNumber;
        
        const newInstance: Instance = {
          ...sourceInstance,
          id: newId,
          name: `${sourceInstance.name} (副本)`,
          selectedTasks: sourceInstance.selectedTasks.map(t => ({
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
        const instances: Instance[] = config.instances.map(inst => ({
          id: inst.id,
          name: inst.name,
          controllerId: inst.controllerId,
          resourceId: inst.resourceId,
          controllerName: inst.controllerName,
          resourceName: inst.resourceName,
          savedDevice: inst.savedDevice,
          selectedTasks: inst.tasks.map(t => ({
            id: t.id,
            taskName: t.taskName,
            customName: t.customName,
            enabled: t.enabled,
            optionValues: t.optionValues,
            expanded: false,
          })),
          isRunning: false,
        }));
        
        // 恢复选中的控制器和资源状态
        const selectedController: Record<string, string> = {};
        const selectedResource: Record<string, string> = {};
        instances.forEach(inst => {
          if (inst.controllerName) {
            selectedController[inst.id] = inst.controllerName;
          }
          if (inst.resourceName) {
            selectedResource[inst.id] = inst.resourceName;
          }
        });
        
        // 根据已有实例名字计算下一个编号，避免重复
        let maxNumber = 0;
        instances.forEach(inst => {
          const match = inst.name.match(/^配置\s*(\d+)$/);
          if (match) {
            maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
          }
        });
        
        set({
          instances,
          activeInstanceId: instances.length > 0 ? instances[0].id : null,
          theme: config.settings.theme,
          language: config.settings.language,
          selectedController,
          selectedResource,
          nextInstanceNumber: maxNumber + 1,
          windowSize: config.settings.windowSize || defaultWindowSize,
          mirrorChyanSettings: config.settings.mirrorChyan || defaultMirrorChyanSettings,
          recentlyClosed: config.recentlyClosed || [],
        });
        
        document.documentElement.classList.toggle('dark', config.settings.theme === 'dark');
        localStorage.setItem('mxu-language', config.settings.language);
      },

      // MaaFramework 状态
      maaInitialized: false,
      maaVersion: null,
      setMaaInitialized: (initialized, version) => set({
        maaInitialized: initialized,
        maaVersion: version || null,
      }),

      // 实例运行时状态
      instanceConnectionStatus: {},
      instanceResourceLoaded: {},
      instanceCurrentTaskId: {},
      instanceTaskStatus: {},

      setInstanceConnectionStatus: (instanceId, status) => set((state) => ({
        instanceConnectionStatus: {
          ...state.instanceConnectionStatus,
          [instanceId]: status,
        },
      })),

      setInstanceResourceLoaded: (instanceId, loaded) => set((state) => ({
        instanceResourceLoaded: {
          ...state.instanceResourceLoaded,
          [instanceId]: loaded,
        },
      })),

      setInstanceCurrentTaskId: (instanceId, taskId) => set((state) => ({
        instanceCurrentTaskId: {
          ...state.instanceCurrentTaskId,
          [instanceId]: taskId,
        },
      })),

      setInstanceTaskStatus: (instanceId, status) => set((state) => ({
        instanceTaskStatus: {
          ...state.instanceTaskStatus,
          [instanceId]: status,
        },
      })),

      // 选中的控制器和资源
      selectedController: {},
      selectedResource: {},

      setSelectedController: (instanceId, controllerName) => set((state) => ({
        selectedController: {
          ...state.selectedController,
          [instanceId]: controllerName,
        },
        // 同时更新 Instance 中的 controllerName
        instances: state.instances.map(i =>
          i.id === instanceId ? { ...i, controllerName } : i
        ),
      })),

      setSelectedResource: (instanceId, resourceName) => set((state) => ({
        selectedResource: {
          ...state.selectedResource,
          [instanceId]: resourceName,
        },
        // 同时更新 Instance 中的 resourceName
        instances: state.instances.map(i =>
          i.id === instanceId ? { ...i, resourceName } : i
        ),
      })),
      
      // 保存设备信息到实例
      setInstanceSavedDevice: (instanceId, savedDevice) => set((state) => ({
        instances: state.instances.map(i =>
          i.id === instanceId ? { ...i, savedDevice } : i
        ),
      })),

      // 设备列表缓存
      cachedAdbDevices: [],
      cachedWin32Windows: [],
      setCachedAdbDevices: (devices) => set({ cachedAdbDevices: devices }),
      setCachedWin32Windows: (windows) => set({ cachedWin32Windows: windows }),
      
      // 截图流状态
      instanceScreenshotStreaming: {},
      setInstanceScreenshotStreaming: (instanceId, streaming) => set((state) => ({
        instanceScreenshotStreaming: {
          ...state.instanceScreenshotStreaming,
          [instanceId]: streaming,
        },
      })),

      // 右侧面板折叠状态
      sidePanelExpanded: true,
      setSidePanelExpanded: (expanded) => set({ sidePanelExpanded: expanded }),
      toggleSidePanelExpanded: () => set((state) => ({ sidePanelExpanded: !state.sidePanelExpanded })),
      
      // 中控台视图模式
      dashboardView: false,
      setDashboardView: (enabled) => set({ dashboardView: enabled }),
      toggleDashboardView: () => set((state) => ({ dashboardView: !state.dashboardView })),
      
      // 窗口大小
      windowSize: defaultWindowSize,
      setWindowSize: (size) => set({ windowSize: size }),
      
      // MirrorChyan 更新设置
      mirrorChyanSettings: defaultMirrorChyanSettings,
      setMirrorChyanCdk: (cdk) => set((state) => ({
        mirrorChyanSettings: { ...state.mirrorChyanSettings, cdk },
      })),
      setMirrorChyanChannel: (channel) => set((state) => ({
        mirrorChyanSettings: { ...state.mirrorChyanSettings, channel },
      })),
      
      // 更新检查状态
      updateInfo: null,
      updateCheckLoading: false,
      showUpdateDialog: false,
      setUpdateInfo: (info) => set({ updateInfo: info }),
      setUpdateCheckLoading: (loading) => set({ updateCheckLoading: loading }),
      setShowUpdateDialog: (show) => set({ showUpdateDialog: show }),
      
      // 最近关闭的实例
      recentlyClosed: [],
      
      reopenRecentlyClosed: (id) => {
        const state = get();
        const closedInstance = state.recentlyClosed.find(i => i.id === id);
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
          selectedTasks: closedInstance.tasks.map(t => ({
            id: generateId(),
            taskName: t.taskName,
            customName: t.customName,
            enabled: t.enabled,
            optionValues: t.optionValues,
            expanded: false,
          })),
          isRunning: false,
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
          recentlyClosed: state.recentlyClosed.filter(i => i.id !== id),
          selectedController: newSelectedController,
          selectedResource: newSelectedResource,
        });
        
        return newId;
      },
      
      removeFromRecentlyClosed: (id) => set((state) => ({
        recentlyClosed: state.recentlyClosed.filter(i => i.id !== id),
      })),
      
      clearRecentlyClosed: () => set({ recentlyClosed: [] }),
    })
  )
);

// 生成配置用于保存
function generateConfig(): MxuConfig {
  const state = useAppStore.getState();
  return {
    version: '1.0',
    instances: state.instances.map(inst => ({
      id: inst.id,
      name: inst.name,
      controllerId: inst.controllerId,
      resourceId: inst.resourceId,
      controllerName: inst.controllerName,
      resourceName: inst.resourceName,
      savedDevice: inst.savedDevice,
      tasks: inst.selectedTasks.map(t => ({
        id: t.id,
        taskName: t.taskName,
        customName: t.customName,
        enabled: t.enabled,
        optionValues: t.optionValues,
      })),
    })),
    settings: {
      theme: state.theme,
      language: state.language,
      windowSize: state.windowSize,
      mirrorChyan: state.mirrorChyanSettings,
    },
    recentlyClosed: state.recentlyClosed,
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
    language: state.language,
    windowSize: state.windowSize,
    mirrorChyanSettings: state.mirrorChyanSettings,
    recentlyClosed: state.recentlyClosed,
  }),
  () => {
    debouncedSaveConfig();
  },
  { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
);
