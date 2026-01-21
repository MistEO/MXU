import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { loggers, generateTaskPipelineOverride } from '@/utils';
import { getInterfaceLangKey } from '@/i18n';
import clsx from 'clsx';

const log = loggers.task;

export function AddTaskPanel() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const {
    projectInterface,
    getActiveInstance,
    addTaskToInstance,
    resolveI18nText,
    language,
    // 任务运行状态管理
    setTaskRunStatus,
    registerMaaTaskMapping,
    appendPendingTaskId,
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

  const filteredTasks = useMemo(() => {
    if (!projectInterface) return [];

    return projectInterface.task.filter((task) => {
      const label = resolveI18nText(task.label, langKey) || task.name;
      const searchLower = searchQuery.toLowerCase();
      return (
        task.name.toLowerCase().includes(searchLower) ||
        label.toLowerCase().includes(searchLower)
      );
    });
  }, [projectInterface, searchQuery, resolveI18nText, langKey]);

  const handleAddTask = async (taskName: string) => {
    if (!instance || !projectInterface) return;

    const task = projectInterface.task.find((t) => t.name === taskName);
    if (!task) return;
    
    // 先添加任务到列表
    addTaskToInstance(instance.id, task);
    
    // 如果实例正在运行，立即调用 PostTask 追加到执行队列
    if (instance.isRunning) {
      try {
        // 使用 getState() 获取最新状态（zustand 状态更新是同步的）
        const latestState = useAppStore.getState();
        const updatedInstance = latestState.instances.find(i => i.id === instance.id);
        const addedTask = updatedInstance?.selectedTasks
          .filter(t => t.taskName === taskName)
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
              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20'
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

              return (
                <button
                  key={task.name}
                  onClick={() => handleAddTask(task.name)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left',
                    'bg-bg-secondary hover:bg-bg-hover text-text-primary border border-border hover:border-accent'
                  )}
                >
                  <Plus className="w-4 h-4 flex-shrink-0 text-accent" />
                  <span className="flex-1 truncate">{label}</span>
                  {count > 0 && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 text-xs rounded-full bg-accent/10 text-accent font-medium">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
