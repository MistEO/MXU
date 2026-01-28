import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { useResolvedContent } from '@/services/contentResolver';
import { loggers, generateTaskPipelineOverride } from '@/utils';
import { getInterfaceLangKey } from '@/i18n';
import { Tooltip } from './ui/Tooltip';
import type { TaskItem } from '@/types/interface';
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
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-warning/10 text-warning">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{incompatibleReason}</span>
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

export function AddTaskPanel() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const {
    projectInterface,
    getActiveInstance,
    addTaskToInstance,
    resolveI18nText,
    language,
    basePath,
    // 任务运行状态管理
    setTaskRunStatus,
    registerMaaTaskMapping,
    appendPendingTaskId,
    // 新增任务标记
    newTaskNames,
    removeNewTaskName,
  } = useAppStore();

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
    if (isIncompatible) {
      const reasons: string[] = [];
      if (isControllerIncompatible) {
        reasons.push(t('taskItem.incompatibleController'));
      }
      if (isResourceIncompatible) {
        reasons.push(t('taskItem.incompatibleResource'));
      }
      reason = reasons.join(', ');
    }

    return { isIncompatible, reason };
  };

  const handleAddTask = async (taskName: string) => {
    if (!instance || !projectInterface) return;

    const task = projectInterface.task.find((t) => t.name === taskName);
    if (!task) return;

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
        const pipelineOverride = generateTaskPipelineOverride(addedTask, projectInterface);

        log.info('运行中追加任务:', task.entry, ', pipelineOverride:', pipelineOverride);

        // 调用 PostTask
        const maaTaskId = await maaService.runTask(instance.id, task.entry, pipelineOverride);

        log.info('任务已追加, maaTaskId:', maaTaskId);

        // 注册映射关系
        registerMaaTaskMapping(instance.id, maaTaskId, addedTask.id);

        // 设置任务状态为 pending
        setTaskRunStatus(instance.id, addedTask.id, 'pending');

        // 追加到任务队列
        appendPendingTaskId(instance.id, maaTaskId);
      } catch (err) {
        log.error('追加任务失败:', err);
      }
    }
  };

  if (!projectInterface) {
    return null;
  }

  return (
    <div className="border-t border-border bg-bg-tertiary">
      {/* 搜索框 */}
      <div className="p-2 border-b border-border">
        <div className="relative">
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
      </div>

      {/* 任务列表 */}
      <div className="max-h-48 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-text-muted">
            {t('addTaskPanel.noResults')}
          </div>
        ) : (
          <div className="p-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {filteredTasks.map((task) => {
              const count = taskCounts[task.name] || 0;
              const label = resolveI18nText(task.label, langKey) || task.name;
              const isNew = newTaskNames.includes(task.name);
              const { isIncompatible, reason } = getTaskCompatibility(task);

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
                  onClick={() => handleAddTask(task.name)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
