import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUp,
  ChevronsDown,
  Check,
  X,
  Copy,
  Edit3,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useAppStore, type TaskRunStatus } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { generateTaskPipelineOverride } from '@/utils';
import { OptionEditor } from './OptionEditor';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import type { SelectedTask } from '@/types/interface';
import clsx from 'clsx';

/** 选项预览标签组件 */
function OptionPreviewTag({ 
  label, 
  value, 
  type 
}: { 
  label: string; 
  value: string; 
  type: 'select' | 'switch' | 'input';
}) {
  // 截断过长的显示值
  const truncateText = (text: string, max: number) => 
    text.length > max ? text.slice(0, max) + '…' : text;
  
  return (
    <span 
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded',
        'text-text-tertiary',
        'max-w-[140px]'
      )}
      title={`${label}: ${value}`}
    >
      {type === 'switch' ? (
        // Switch 类型：显示选项名 + 状态圆点
        <>
          <span className="truncate">{truncateText(label, 6)}</span>
          <span className={clsx(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            value === 'ON' ? 'bg-success/70' : 'bg-text-muted/50'
          )} />
        </>
      ) : (
        // Select/Input 类型：显示选项名: 值
        <>
          <span className="truncate flex-shrink-0">{truncateText(label, 4)}</span>
          <span className="flex-shrink-0">:</span>
          <span className="truncate">{truncateText(value, 6)}</span>
        </>
      )}
    </span>
  );
}

interface TaskItemProps {
  instanceId: string;
  task: SelectedTask;
}

export function TaskItem({ instanceId, task }: TaskItemProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  
  const {
    projectInterface,
    toggleTaskEnabled,
    toggleTaskExpanded,
    removeTaskFromInstance,
    renameTask,
    duplicateTask,
    moveTaskUp,
    moveTaskDown,
    moveTaskToTop,
    moveTaskToBottom,
    resolveI18nText,
    language,
    getActiveInstance,
    showOptionPreview,
    instanceTaskRunStatus,
    instances,
    findMaaTaskIdBySelectedTaskId,
  } = useAppStore();
  
  // 获取任务运行状态
  const taskRunStatus: TaskRunStatus = instanceTaskRunStatus[instanceId]?.[task.id] || 'idle';
  
  // 获取实例运行状态
  const instance = instances.find(i => i.id === instanceId);
  const isInstanceRunning = instance?.isRunning || false;
  
  // 判断是否可以编辑选项（只有 pending 或 idle 状态的任务可以编辑）
  const canEditOptions = taskRunStatus === 'idle' || taskRunStatus === 'pending';
  
  // 判断是否可以调整顺序/删除（实例运行时禁用）
  const canReorder = !isInstanceRunning;
  const canDelete = !isInstanceRunning;
  
  // 用于追踪选项值变化的 ref（避免首次渲染时触发）
  const prevOptionValuesRef = useRef<string | null>(null);
  
  // 当选项值变化且任务状态为 pending 时，调用 overridePipeline 更新任务配置
  useEffect(() => {
    const currentOptionValues = JSON.stringify(task.optionValues);
    
    // 首次渲染时只记录当前值，不触发 override
    if (prevOptionValuesRef.current === null) {
      prevOptionValuesRef.current = currentOptionValues;
      return;
    }
    
    // 如果选项值没有变化，不处理
    if (prevOptionValuesRef.current === currentOptionValues) {
      return;
    }
    
    // 更新 ref
    prevOptionValuesRef.current = currentOptionValues;
    
    // 只有 pending 状态的任务才需要调用 overridePipeline
    if (taskRunStatus !== 'pending') {
      return;
    }
    
    // 获取对应的 maaTaskId
    const maaTaskId = findMaaTaskIdBySelectedTaskId(instanceId, task.id);
    if (maaTaskId === null) {
      return;
    }
    
    // 生成新的 pipeline override 并调用后端
    const pipelineOverride = generateTaskPipelineOverride(task, projectInterface);
    maaService.overridePipeline(instanceId, maaTaskId, pipelineOverride).catch(err => {
      console.error('Failed to override pipeline:', err);
    });
  }, [task.optionValues, taskRunStatus, instanceId, task.id, task, projectInterface, findMaaTaskIdBySelectedTaskId]);

  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !canReorder });

  // 禁止 X 方向位移，仅允许垂直拖动
  const constrainedTransform = transform
    ? { ...transform, x: 0 }
    : null;

  const style = {
    transform: CSS.Transform.toString(constrainedTransform),
    transition,
  };

  const taskDef = projectInterface?.task.find(t => t.name === task.taskName);
  if (!taskDef) return null;

  const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
  const originalLabel = resolveI18nText(taskDef.label, langKey) || taskDef.name;
  const displayName = task.customName || originalLabel;
  const hasOptions = taskDef.option && taskDef.option.length > 0;

  // 生成选项预览信息（最多显示3个）
  const optionPreviews = useMemo(() => {
    if (!hasOptions || !projectInterface?.option) return [];
    
    const previews: { key: string; label: string; value: string; type: 'select' | 'switch' | 'input' }[] = [];
    const maxPreviews = 3;
    
    for (const optionKey of taskDef.option || []) {
      if (previews.length >= maxPreviews) break;
      
      const optionDef = projectInterface.option[optionKey];
      if (!optionDef) continue;
      
      const optionLabel = resolveI18nText(optionDef.label, langKey) || optionKey;
      const optionValue = task.optionValues[optionKey];
      
      if (optionDef.type === 'switch') {
        const isOn = optionValue?.type === 'switch' ? optionValue.value : false;
        previews.push({
          key: optionKey,
          label: optionLabel,
          value: isOn ? 'ON' : 'OFF',
          type: 'switch',
        });
      } else if (optionDef.type === 'input') {
        const inputValues = optionValue?.type === 'input' ? optionValue.values : {};
        // 获取第一个有值的输入项
        const firstInput = optionDef.inputs[0];
        if (firstInput) {
          const inputValue = inputValues[firstInput.name] || firstInput.default || '';
          if (inputValue) {
            previews.push({
              key: optionKey,
              label: optionLabel,
              value: inputValue,
              type: 'input',
            });
          }
        }
      } else {
        // select 类型（默认）
        const caseName = optionValue?.type === 'select' 
          ? optionValue.caseName 
          : optionDef.default_case || optionDef.cases?.[0]?.name || '';
        const selectedCase = optionDef.cases?.find(c => c.name === caseName);
        const caseLabel = selectedCase 
          ? (resolveI18nText(selectedCase.label, langKey) || selectedCase.name)
          : caseName;
        previews.push({
          key: optionKey,
          label: optionLabel,
          value: caseLabel,
          type: 'select',
        });
      }
    }
    
    return previews;
  }, [hasOptions, projectInterface?.option, taskDef.option, task.optionValues, langKey, resolveI18nText]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(task.customName || '');
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    renameTask(instanceId, task.id, editName.trim());
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // 右键菜单处理
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const instance = getActiveInstance();
      if (!instance) return;

      const tasks = instance.selectedTasks;
      const taskIndex = tasks.findIndex((t) => t.id === task.id);
      const isFirst = taskIndex === 0;
      const isLast = taskIndex === tasks.length - 1;

      const menuItems: MenuItem[] = [
        {
          id: 'duplicate',
          label: t('contextMenu.duplicateTask'),
          icon: Copy,
          disabled: isInstanceRunning,
          onClick: () => duplicateTask(instanceId, task.id),
        },
        {
          id: 'rename',
          label: t('contextMenu.renameTask'),
          icon: Edit3,
          onClick: () => {
            setEditName(task.customName || '');
            setIsEditing(true);
          },
        },
        { id: 'divider-1', label: '', divider: true },
        {
          id: 'toggle',
          label: task.enabled
            ? t('contextMenu.disableTask')
            : t('contextMenu.enableTask'),
          icon: task.enabled ? ToggleLeft : ToggleRight,
          disabled: isInstanceRunning,
          onClick: () => toggleTaskEnabled(instanceId, task.id),
        },
        ...(hasOptions
          ? [
              {
                id: 'expand',
                label: task.expanded
                  ? t('contextMenu.collapseOptions')
                  : t('contextMenu.expandOptions'),
                icon: task.expanded ? ChevronUp : ChevronDown,
                onClick: () => toggleTaskExpanded(instanceId, task.id),
              },
            ]
          : []),
        { id: 'divider-2', label: '', divider: true },
        {
          id: 'move-up',
          label: t('contextMenu.moveUp'),
          icon: ChevronUp,
          disabled: isFirst || !canReorder,
          onClick: () => moveTaskUp(instanceId, task.id),
        },
        {
          id: 'move-down',
          label: t('contextMenu.moveDown'),
          icon: ChevronDown,
          disabled: isLast || !canReorder,
          onClick: () => moveTaskDown(instanceId, task.id),
        },
        {
          id: 'move-top',
          label: t('contextMenu.moveToTop'),
          icon: ChevronsUp,
          disabled: isFirst || !canReorder,
          onClick: () => moveTaskToTop(instanceId, task.id),
        },
        {
          id: 'move-bottom',
          label: t('contextMenu.moveToBottom'),
          icon: ChevronsDown,
          disabled: isLast || !canReorder,
          onClick: () => moveTaskToBottom(instanceId, task.id),
        },
        { id: 'divider-3', label: '', divider: true },
        {
          id: 'delete',
          label: t('contextMenu.deleteTask'),
          icon: Trash2,
          danger: true,
          disabled: !canDelete,
          onClick: () => removeTaskFromInstance(instanceId, task.id),
        },
      ];

      showMenu(e, menuItems);
    },
    [
      t,
      task,
      instanceId,
      hasOptions,
      getActiveInstance,
      duplicateTask,
      toggleTaskEnabled,
      toggleTaskExpanded,
      moveTaskUp,
      moveTaskDown,
      moveTaskToTop,
      moveTaskToBottom,
      removeTaskFromInstance,
      showMenu,
      isInstanceRunning,
      canReorder,
      canDelete,
    ]
  );

  // 状态指示器颜色
  const getStatusIndicatorClass = (): string => {
    switch (taskRunStatus) {
      case 'pending':
        return 'bg-text-muted';
      case 'running':
        return 'bg-accent task-running-indicator';
      case 'succeeded':
        return 'bg-success';
      case 'failed':
        return 'bg-error';
      default:
        return 'bg-transparent';
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onContextMenu={handleContextMenu}
      className={clsx(
        'group bg-bg-secondary rounded-lg border border-border overflow-hidden transition-shadow relative',
        isDragging && 'shadow-lg opacity-50',
        taskRunStatus === 'running' && 'task-item-running'
      )}
    >
      {/* 任务状态指示器（左侧竖条） */}
      {taskRunStatus !== 'idle' && (
        <div
          className={clsx(
            'absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg transition-colors',
            getStatusIndicatorClass()
          )}
          title={t(`taskItem.status.${taskRunStatus}`)}
        />
      )}
      
      {/* 任务头部 */}
      <div className="flex items-center gap-2 p-3">
        {/* 拖拽手柄 */}
        <div
          {...attributes}
          {...(canReorder ? listeners : {})}
          className={clsx(
            'p-1 rounded',
            canReorder 
              ? 'cursor-grab active:cursor-grabbing hover:bg-bg-hover' 
              : 'cursor-not-allowed opacity-30'
          )}
        >
          <GripVertical className="w-4 h-4 text-text-muted" />
        </div>

        {/* 启用复选框 - 运行时禁用 */}
        <label className={clsx(
          'flex items-center',
          isInstanceRunning ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        )}>
          <input
            type="checkbox"
            checked={task.enabled}
            onChange={() => toggleTaskEnabled(instanceId, task.id)}
            disabled={isInstanceRunning}
            className="w-4 h-4 rounded border-border-strong accent-accent disabled:cursor-not-allowed"
          />
        </label>

        {/* 任务名称 + 展开区域容器 */}
        <div className="flex-1 flex items-center min-w-0">
          {isEditing ? (
            <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveEdit}
                placeholder={originalLabel}
                autoFocus
                className={clsx(
                  'flex-1 px-2 py-1 text-sm rounded border border-accent',
                  'bg-bg-primary text-text-primary',
                  'focus:outline-none focus:ring-1 focus:ring-accent/20'
                )}
              />
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSaveEdit();
                }}
                className="p-1 rounded hover:bg-success/10 text-success"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCancelEdit();
                }}
                className="p-1 rounded hover:bg-error/10 text-error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              {/* 任务名称 */}
              <div 
                className="flex items-center gap-1 min-w-0 cursor-pointer flex-shrink-0"
                onDoubleClick={handleDoubleClick}
                title={t('taskItem.rename')}
              >
                <span
                  className={clsx(
                    'text-sm font-medium truncate',
                    task.enabled ? 'text-text-primary' : 'text-text-muted'
                  )}
                >
                  {displayName}
                </span>
                {task.customName && (
                  <span className="flex-shrink-0 text-xs text-text-muted">
                    ({originalLabel})
                  </span>
                )}
              </div>

              {/* 展开/折叠点击区域（包含选项预览） */}
              {hasOptions && (
                <div
                  onClick={() => toggleTaskExpanded(instanceId, task.id)}
                  className="flex-1 flex items-center self-stretch min-h-[28px] cursor-pointer"
                  title={task.expanded ? t('taskItem.collapse') : t('taskItem.expand')}
                >
                  {/* 选项预览标签 - 未展开时显示 */}
                  {showOptionPreview && !task.expanded && optionPreviews.length > 0 && (
                    <div className="flex-1 flex items-center gap-1.5 mx-2 overflow-hidden">
                      {optionPreviews.map((preview) => (
                        <OptionPreviewTag
                          key={preview.key}
                          label={preview.label}
                          value={preview.value}
                          type={preview.type}
                        />
                      ))}
                    </div>
                  )}
                  {/* 展开/折叠箭头 */}
                  <div className="flex items-center justify-end pl-2 ml-auto">
                    {task.expanded ? (
                      <ChevronDown className="w-4 h-4 text-text-secondary" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-text-secondary" />
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 删除按钮 - hover 时显示，运行时隐藏 */}
        {!isEditing && canDelete && (
          <button
            onClick={() => removeTaskFromInstance(instanceId, task.id)}
            className={clsx(
              'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
              'hover:bg-bg-active'
            )}
            title={t('taskItem.remove')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 选项面板 */}
      {hasOptions && task.expanded && (
        <div className="border-t border-border bg-bg-tertiary p-3">
          <div className="space-y-3">
            {taskDef.option?.map((optionKey) => (
              <OptionEditor
                key={optionKey}
                instanceId={instanceId}
                taskId={task.id}
                optionKey={optionKey}
                value={task.optionValues[optionKey]}
                disabled={!canEditOptions}
              />
            ))}
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {menuState.isOpen && (
        <ContextMenu
          items={menuState.items}
          position={menuState.position}
          onClose={hideMenu}
        />
      )}
    </div>
  );
}
