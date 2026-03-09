import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Plus,
  Sparkles,
  Loader2,
  AlertCircle,
  Play,
  ChevronsDown,
  ChevronDown,
  ChevronRight,
  GripHorizontal,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { useResolvedContent } from '@/services/contentResolver';
import { loggers, generateTaskPipelineOverride } from '@/utils';
import { getInterfaceLangKey } from '@/i18n';
import {
  addTaskPanelHeightMax,
  addTaskPanelHeightMin,
  addTaskPanelResizeStep,
} from '@/types/config';
import { Tooltip } from './ui/Tooltip';
import type { TaskItem, ActionConfig, GroupItem } from '@/types/interface';
import type { MxuSpecialTaskDefinition } from '@/types/specialTasks';
import { getAllMxuSpecialTasks } from '@/types/specialTasks';
import clsx from 'clsx';

const log = loggers.task;

/** 任务按钮组件：支持 hover 显示 description tooltip */
function TaskButton({
  task,
  count,
  isNew,
  label,
  langKey,
  basePath,
  disabled,
  incompatibleReason,
  supportedControllerHint,
  onClick,
}: {
  task: TaskItem;
  count: number;
  isNew: boolean;
  label: string;
  langKey: string;
  basePath: string;
  disabled?: boolean;
  incompatibleReason?: string;
  supportedControllerHint?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const { resolveI18nText, interfaceTranslations } = useAppStore();

  // 获取翻译表
  const translations = interfaceTranslations[langKey];

  // 解析 description（支持文件/URL/Markdown）
  const resolvedDescription = useResolvedContent(
    task.description ? resolveI18nText(task.description, langKey) : undefined,
    basePath,
    translations,
  );

  const hasDescription = !!resolvedDescription.html || resolvedDescription.loading;

  // 构建 Tooltip 内容
  const tooltipContent =
    hasDescription || (disabled && incompatibleReason) ? (
      <div className="space-y-2">
        {/* 任务描述 */}
        {resolvedDescription.loading ? (
          <div className="flex items-center gap-1.5 text-text-muted">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{t('taskItem.loadingDescription')}</span>
          </div>
        ) : resolvedDescription.html ? (
          <div
            className="text-text-secondary [&_p]:my-0.5 [&_a]:text-accent [&_a]:hover:underline"
            dangerouslySetInnerHTML={{ __html: resolvedDescription.html }}
          />
        ) : null}
        {/* 不兼容提示 */}
        {disabled && incompatibleReason && (
          <div className="px-2 py-1.5 rounded-md bg-warning/10 text-warning space-y-1">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{incompatibleReason}</span>
            </div>
            {supportedControllerHint && (
              <div className="text-xs opacity-80 pl-[18px]">{supportedControllerHint}</div>
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <Tooltip content={tooltipContent} side="top" align="center" maxWidth="max-w-xs">
      <button
        onClick={() => !disabled && onClick()}
        className={clsx(
          'relative flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left',
          disabled
            ? 'bg-bg-secondary/50 text-text-muted border border-border/50 cursor-not-allowed opacity-60'
            : 'bg-bg-secondary hover:bg-bg-hover text-text-primary border border-border hover:border-accent',
        )}
      >
        {/* 不兼容警告标记 */}
        {disabled && incompatibleReason && (
          <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-warning text-white">
            <AlertCircle className="w-3 h-3" />
          </span>
        )}
        {/* 新增任务标记 - 仅在非禁用时显示 */}
        {isNew && !disabled && (
          <span className="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-accent text-white animate-pulse-glow-accent">
            <Sparkles className="w-3 h-3" />
            new
          </span>
        )}
        <Plus className={clsx('w-4 h-4 shrink-0', disabled ? 'text-text-muted' : 'text-accent')} />
        <span className="flex-1 truncate">{label}</span>
        {count > 0 && (
          <span
            className={clsx(
              'shrink-0 px-1.5 py-0.5 text-xs rounded-full font-medium',
              disabled ? 'bg-text-muted/10 text-text-muted' : 'bg-accent/10 text-accent',
            )}
          >
            {count}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

// 默认动作配置
const defaultAction: ActionConfig = {
  enabled: true,
  program: '',
  args: '',
  waitForExit: false,
  skipIfRunning: true,
};

export function AddTaskPanel() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const {
    projectInterface,
    getActiveInstance,
    addTaskToInstance,
    addMxuSpecialTask,
    resolveI18nText,
    language,
    basePath,
    // 任务运行状态管理
    setTaskRunStatus,
    registerMaaTaskMapping,
    registerTaskIdName,
    appendPendingTaskId,
    // 新增任务标记
    newTaskNames,
    removeNewTaskName,
    setInstancePreAction,
    // 添加任务面板
    setShowAddTaskPanel,
    addTaskPanelHeight,
    setAddTaskPanelHeight,
  } = useAppStore();

  // 获取所有注册的特殊任务
  const specialTasks = useMemo(() => getAllMxuSpecialTasks(), []);

  const instance = getActiveInstance();
  const langKey = getInterfaceLangKey(language);

  // 统计每个任务被添加的次数
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    instance?.selectedTasks.forEach((t) => {
      counts[t.taskName] = (counts[t.taskName] || 0) + 1;
    });
    return counts;
  }, [instance?.selectedTasks]);

  // 获取当前实例选中的控制器和资源
  // 未选择时，使用第一个控制器/资源作为默认值判断兼容性
  const selectedControllerName = instance?.controllerName || projectInterface?.controller[0]?.name;
  const selectedResourceName = instance?.resourceName || projectInterface?.resource[0]?.name;

  const filteredTasks = useMemo(() => {
    if (!projectInterface) return [];

    return projectInterface.task.filter((task) => {
      const label = resolveI18nText(task.label, langKey) || task.name;
      const searchLower = searchQuery.toLowerCase();

      // 只根据搜索关键词过滤
      return (
        task.name.toLowerCase().includes(searchLower) || label.toLowerCase().includes(searchLower)
      );
    });
  }, [projectInterface, searchQuery, resolveI18nText, langKey]);

  // 检查任务是否与当前控制器/资源兼容
  const getTaskCompatibility = (task: TaskItem) => {
    const isControllerIncompatible =
      task.controller &&
      task.controller.length > 0 &&
      (!selectedControllerName || !task.controller.includes(selectedControllerName));

    const isResourceIncompatible =
      task.resource &&
      task.resource.length > 0 &&
      (!selectedResourceName || !task.resource.includes(selectedResourceName));

    const isIncompatible = isControllerIncompatible || isResourceIncompatible;

    let reason = '';
    let supportedControllerHint = '';
    if (isIncompatible) {
      const reasons: string[] = [];
      if (isControllerIncompatible) {
        reasons.push(t('taskItem.incompatibleController'));
        if (task.controller && task.controller.length > 0) {
          const labels = task.controller.map((name) => {
            const ctrl = projectInterface?.controller.find((c) => c.name === name);
            return ctrl ? resolveI18nText(ctrl.label, langKey) || ctrl.name : name;
          });
          supportedControllerHint = t('taskItem.supportedControllers', {
            controllers: labels.join(', '),
          });
        }
      }
      if (isResourceIncompatible) {
        reasons.push(t('taskItem.incompatibleResource'));
      }
      reason = reasons.join(', ');
    }

    return { isIncompatible, reason, supportedControllerHint };
  };

  /**
   * 通用的 MXU 特殊任务添加处理函数
   * @param specialTask 特殊任务定义
   */
  const handleAddSpecialTask = async (specialTask: MxuSpecialTaskDefinition) => {
    if (!instance) return;

    // 收起添加任务面板
    setShowAddTaskPanel(false);

    // 添加特殊任务到列表
    const taskId = addMxuSpecialTask(instance.id, specialTask.taskName);

    // 如果实例正在运行，立即调用 PostTask 追加到执行队列
    if (instance.isRunning) {
      try {
        const latestState = useAppStore.getState();
        const updatedInstance = latestState.instances.find((i) => i.id === instance.id);
        const addedTask = updatedInstance?.selectedTasks.find((t) => t.id === taskId);

        if (!addedTask) {
          log.warn(`无法找到刚添加的特殊任务: ${specialTask.taskName}`);
          return;
        }

        // 构建 pipeline override
        const pipelineOverride = generateTaskPipelineOverride(
          addedTask,
          projectInterface,
          selectedControllerName,
          selectedResourceName,
        );

        log.info(`运行中追加特殊任务 ${specialTask.entry}, pipelineOverride:`, pipelineOverride);

        // 调用 PostTask（使用注册表中的 entry）
        const maaTaskId = await maaService.runTask(
          instance.id,
          specialTask.entry,
          pipelineOverride,
        );

        log.info(`特殊任务已追加, maaTaskId:`, maaTaskId);

        // 注册映射关系
        registerMaaTaskMapping(instance.id, maaTaskId, addedTask.id);
        // 注册 task_id 与任务名的映射（用 t() 翻译特殊任务 label）
        registerTaskIdName(
          maaTaskId,
          addedTask.customName || t(specialTask.taskDef.label || specialTask.taskName),
        );

        // 设置任务状态为 pending
        setTaskRunStatus(instance.id, addedTask.id, 'pending');

        // 追加到任务队列
        appendPendingTaskId(instance.id, maaTaskId);
      } catch (err) {
        log.error(`追加特殊任务失败:`, err);
      }
    }
  };

  const handleAddTask = async (taskName: string) => {
    if (!instance || !projectInterface) return;

    const task = projectInterface.task.find((t) => t.name === taskName);
    if (!task) return;

    // 收起添加任务面板
    setShowAddTaskPanel(false);

    // 如果是新增任务，移除 "new" 标记
    if (newTaskNames.includes(taskName)) {
      removeNewTaskName(taskName);
    }

    // 先添加任务到列表
    addTaskToInstance(instance.id, task);

    // 如果实例正在运行，立即调用 PostTask 追加到执行队列
    if (instance.isRunning) {
      try {
        // 使用 getState() 获取最新状态（zustand 状态更新是同步的）
        const latestState = useAppStore.getState();
        const updatedInstance = latestState.instances.find((i) => i.id === instance.id);
        const addedTask = updatedInstance?.selectedTasks
          .filter((t) => t.taskName === taskName)
          .pop();

        if (!addedTask) {
          log.warn('无法找到刚添加的任务');
          return;
        }

        // 构建 pipeline override
        const pipelineOverride = generateTaskPipelineOverride(
          addedTask,
          projectInterface,
          selectedControllerName,
          selectedResourceName,
        );

        log.info('运行中追加任务:', task.entry, ', pipelineOverride:', pipelineOverride);

        // 调用 PostTask
        const maaTaskId = await maaService.runTask(instance.id, task.entry, pipelineOverride);

        log.info('任务已追加, maaTaskId:', maaTaskId);

        // 注册映射关系
        registerMaaTaskMapping(instance.id, maaTaskId, addedTask.id);
        // 注册 task_id 与任务名的映射
        const taskDisplayName =
          addedTask.customName || resolveI18nText(task.label, langKey) || addedTask.taskName;
        registerTaskIdName(maaTaskId, taskDisplayName);

        // 设置任务状态为 pending
        setTaskRunStatus(instance.id, addedTask.id, 'pending');

        // 追加到任务队列
        appendPendingTaskId(instance.id, maaTaskId);
      } catch (err) {
        log.error('追加任务失败:', err);
      }
    }
  };

  // v2.4.0: 按 group 分组任务
  const groups = projectInterface?.group;
  const hasGroups = (groups?.length ?? 0) > 0;

  const sortedGroups = groups ?? [];

  // 分组展开/折叠状态（key: group name, value: 是否展开）
  const [groupExpanded, setGroupExpanded] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    if (groups) {
      for (const g of groups) {
        initial.set(g.name, g.default_expand !== false);
      }
    }
    return initial;
  });
  const [ungroupedExpanded, setUngroupedExpanded] = useState(true);
  const [specialExpanded, setSpecialExpanded] = useState(true);

  // 当分组定义变化时，移除已失效 key，并为新分组注入 default_expand 默认值
  useEffect(() => {
    setGroupExpanded((prev) => {
      if (!groups || groups.length === 0) return new Map<string, boolean>();
      const next = new Map<string, boolean>();
      for (const g of groups) {
        next.set(
          g.name,
          prev.has(g.name) ? (prev.get(g.name) ?? true) : g.default_expand !== false,
        );
      }
      return next;
    });
  }, [groups]);

  const toggleGroup = useCallback((groupName: string) => {
    setGroupExpanded((prev) => {
      const next = new Map(prev);
      const expanded = prev.get(groupName) !== false;
      next.set(groupName, !expanded);
      return next;
    });
  }, []);

  // 将过滤后的任务按分组归类
  const { groupedTasks, ungroupedTasks } = useMemo(() => {
    if (!hasGroups)
      return { groupedTasks: new Map<string, TaskItem[]>(), ungroupedTasks: filteredTasks };

    const grouped = new Map<string, TaskItem[]>();
    for (const g of sortedGroups) {
      grouped.set(g.name, []);
    }

    const ungrouped: TaskItem[] = [];

    for (const task of filteredTasks) {
      if (task.group && task.group.length > 0) {
        let assignedToKnownGroup = false;
        for (const gName of task.group) {
          const list = grouped.get(gName);
          if (list) {
            list.push(task);
            assignedToKnownGroup = true;
          }
        }
        if (!assignedToKnownGroup) {
          ungrouped.push(task);
        }
      } else {
        ungrouped.push(task);
      }
    }

    return { groupedTasks: grouped, ungroupedTasks: ungrouped };
  }, [hasGroups, sortedGroups, filteredTasks]);

  /** 渲染一组任务按钮网格 */
  const renderTaskGrid = (tasks: TaskItem[]) => {
    if (tasks.length === 0) return null;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
        {tasks.map((task) => {
          const count = taskCounts[task.name] || 0;
          const label = resolveI18nText(task.label, langKey) || task.name;
          const isNew = newTaskNames.includes(task.name);
          const { isIncompatible, reason, supportedControllerHint } = getTaskCompatibility(task);

          return (
            <TaskButton
              key={task.name}
              task={task}
              count={count}
              isNew={isNew}
              label={label}
              langKey={langKey}
              basePath={basePath}
              disabled={isIncompatible}
              incompatibleReason={reason}
              supportedControllerHint={supportedControllerHint}
              onClick={() => handleAddTask(task.name)}
            />
          );
        })}
      </div>
    );
  };

  /** 渲染可折叠区块标题 */
  const renderSectionHeader = (
    label: string,
    expanded: boolean,
    onToggle: () => void,
    count?: number,
    contentId?: string,
  ) => {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex items-center gap-1.5 w-full py-1 text-left group"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted group-hover:text-text-secondary transition-colors" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-secondary transition-colors" />
        )}
        <span className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
          {label}
        </span>
        {count !== undefined && <span className="text-[10px] text-text-muted">({count})</span>}
        <div className="flex-1 h-px bg-border/30 ml-2" />
      </button>
    );
  };

  /** 渲染分组区块（带可折叠标题） */
  const renderGroupSection = (group: GroupItem, tasks: TaskItem[]) => {
    if (tasks.length === 0) return null;
    const groupLabel = resolveI18nText(group.label, langKey) || group.name;
    const expanded = groupExpanded.get(group.name) !== false;
    const contentId = `add-task-panel-section-${encodeURIComponent(group.name)}`;

    return (
      <div key={group.name}>
        {renderSectionHeader(
          groupLabel,
          expanded,
          () => toggleGroup(group.name),
          tasks.length,
          contentId,
        )}
        {expanded && (
          <div id={contentId} className="mt-1">
            {renderTaskGrid(tasks)}
          </div>
        )}
      </div>
    );
  };

  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const mouseMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  const cleanupResizeListeners = useCallback(() => {
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      mouseMoveHandlerRef.current = null;
    }
    if (mouseUpHandlerRef.current) {
      document.removeEventListener('mouseup', mouseUpHandlerRef.current);
      mouseUpHandlerRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    return () => {
      isDraggingRef.current = false;
      cleanupResizeListeners();
    };
  }, [cleanupResizeListeners]);

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      cleanupResizeListeners();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = addTaskPanelHeight;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = startYRef.current - e.clientY;
        setAddTaskPanelHeight(startHeightRef.current + delta);
      };

      const handleMouseUp = (_e: MouseEvent) => {
        isDraggingRef.current = false;
        cleanupResizeListeners();
      };

      mouseMoveHandlerRef.current = handleMouseMove;
      mouseUpHandlerRef.current = handleMouseUp;
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [addTaskPanelHeight, cleanupResizeListeners, setAddTaskPanelHeight],
  );

  const handleResizeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      let nextHeight: number | null = null;
      switch (e.key) {
        case 'ArrowUp':
          nextHeight = addTaskPanelHeight + addTaskPanelResizeStep;
          break;
        case 'ArrowDown':
          nextHeight = addTaskPanelHeight - addTaskPanelResizeStep;
          break;
        case 'PageUp':
          nextHeight = addTaskPanelHeight + addTaskPanelResizeStep * 2;
          break;
        case 'PageDown':
          nextHeight = addTaskPanelHeight - addTaskPanelResizeStep * 2;
          break;
        case 'Home':
          nextHeight = addTaskPanelHeightMin;
          break;
        case 'End':
          nextHeight = addTaskPanelHeightMax;
          break;
        default:
          break;
      }
      if (nextHeight === null) return;
      e.preventDefault();
      setAddTaskPanelHeight(nextHeight);
    },
    [addTaskPanelHeight, setAddTaskPanelHeight],
  );

  const ungroupedContentId = 'add-task-panel-section-ungrouped';
  const specialContentId = 'add-task-panel-section-special';

  if (!projectInterface) {
    return null;
  }

  return (
    <div id="add-task-panel" className="border-t border-border bg-bg-tertiary">
      {/* 拖拽调整高度的把手 */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-valuemin={addTaskPanelHeightMin}
        aria-valuemax={addTaskPanelHeightMax}
        aria-valuenow={addTaskPanelHeight}
        aria-label={t('addTaskPanel.resizeHandleAriaLabel')}
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        className="flex items-center justify-center h-2 cursor-ns-resize group hover:bg-accent/10 transition-colors"
      >
        <GripHorizontal className="w-4 h-3 text-text-muted/40 group-hover:text-accent/60 transition-colors" />
      </div>

      {/* 搜索框 */}
      <div className="px-2 pb-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('addTaskPanel.searchPlaceholder')}
              className={clsx(
                'w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border',
                'bg-bg-secondary text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20',
              )}
            />
          </div>
          <button
            onClick={() => setShowAddTaskPanel(false)}
            className="shrink-0 p-2 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t('addTaskPanel.collapse')}
          >
            <ChevronsDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 任务列表（包含特殊任务） */}
      <div className="overflow-y-auto" style={{ maxHeight: addTaskPanelHeight }}>
        {filteredTasks.length === 0 && !instance ? (
          <div className="p-4 text-center text-sm text-text-muted">
            {t('addTaskPanel.noResults')}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {/* 普通任务 */}
            {hasGroups ? (
              <>
                {/* 按分组渲染任务 */}
                {sortedGroups.map((group) => {
                  const tasks = groupedTasks.get(group.name) || [];
                  return renderGroupSection(group, tasks);
                })}
                {/* 未分组的任务 */}
                {ungroupedTasks.length > 0 && (
                  <div>
                    {renderSectionHeader(
                      t('addTaskPanel.ungroupedTasks'),
                      ungroupedExpanded,
                      () => setUngroupedExpanded((prev) => !prev),
                      ungroupedTasks.length,
                      ungroupedContentId,
                    )}
                    {ungroupedExpanded && (
                      <div id={ungroupedContentId} className="mt-1">
                        {renderTaskGrid(ungroupedTasks)}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* 无分组：保持原有平铺网格 */
              filteredTasks.length > 0 && renderTaskGrid(filteredTasks)
            )}

            {instance && (
              <div>
                {renderSectionHeader(
                  t('addTaskPanel.specialTasks'),
                  specialExpanded,
                  () => setSpecialExpanded((prev) => !prev),
                  undefined,
                  specialContentId,
                )}
                {specialExpanded && (
                  <div id={specialContentId} className="mt-1 flex gap-2 flex-wrap">
                    {/* 前置任务按钮：仅在未添加时显示 */}
                    {!instance.preAction && (
                      <button
                        onClick={() => {
                          setInstancePreAction(instance.id, defaultAction);
                          setShowAddTaskPanel(false);
                        }}
                        disabled={instance.isRunning}
                        className={clsx(
                          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors',
                          'bg-bg-secondary/70 hover:bg-bg-hover text-text-secondary border border-border/70 hover:border-accent',
                          instance.isRunning && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        <Play className="w-3.5 h-3.5 text-success/80" />
                        <span>{t('action.preAction')}</span>
                      </button>
                    )}
                    {/* 动态渲染所有注册的特殊任务按钮 */}
                    {specialTasks.map((specialTask) => {
                      return (
                        <button
                          key={specialTask.taskName}
                          onClick={() => handleAddSpecialTask(specialTask)}
                          className={clsx(
                            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors',
                            'bg-bg-secondary/70 hover:bg-bg-hover text-text-secondary border border-border/70 hover:border-accent',
                          )}
                        >
                          <span>{t(specialTask.taskDef.label || specialTask.taskName)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 无搜索结果提示 */}
            {filteredTasks.length === 0 && (
              <div className="py-2 text-center text-sm text-text-muted">
                {t('addTaskPanel.noResults')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
