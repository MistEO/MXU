import { useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ListTodo,
  Plus,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  Share2,
  ClipboardPaste,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { TaskItem } from './TaskItem';
import { ActionItem } from './ActionItem';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import type { PresetItem } from '@/types/interface';
import { getInterfaceLangKey } from '@/i18n';
import { useResolvedContent } from '@/services/contentResolver';
import { exportWithToast, importTabConfigFromClipboard, getImportErrorType } from '@/utils/tabExportImport';
import { generateId } from '@/stores/helpers';
import { toast } from 'sonner';
import clsx from 'clsx';

/** 单个预设卡片 */
function PresetCard({ preset, onApply }: { preset: PresetItem; onApply: () => void }) {
  const { resolveI18nText, language, basePath, interfaceTranslations } = useAppStore();
  const { t } = useTranslation();
  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  const label = resolveI18nText(preset.label, langKey) || preset.name;
  const resolvedDescription = useResolvedContent(
    preset.description ? resolveI18nText(preset.description, langKey) : undefined,
    basePath,
    translations,
  );

  const enabledCount = preset.task.filter((t) => t.enabled !== false).length;
  const totalCount = preset.task.length;

  return (
    <button
      onClick={onApply}
      className={clsx(
        'w-full text-left p-4 rounded-lg border border-border',
        'bg-bg-secondary hover:bg-bg-hover hover:border-accent',
        'transition-colors group',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="w-4 h-4 text-accent flex-shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate">{label}</span>
        <span className="text-xs text-text-muted ml-auto flex-shrink-0">
          {enabledCount}/{totalCount} {t('preset.taskCount')}
        </span>
      </div>
      {resolvedDescription.html ? (
        <div
          className="text-xs text-text-secondary line-clamp-2 [&_p]:my-0"
          dangerouslySetInnerHTML={{ __html: resolvedDescription.html }}
        />
      ) : resolvedDescription.loading ? (
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <Loader2 className="w-3 h-3 animate-spin" />
        </div>
      ) : null}
    </button>
  );
}

/** 导入按钮 */
function ImportConfigButton({ instanceId }: { instanceId: string }) {
  const { projectInterface, updateInstance, renameInstance, setSelectedController, setSelectedResource } =
    useAppStore();
  const { t } = useTranslation();

  const handleImport = async () => {
    const projectName = projectInterface?.name;
    if (!projectName) return;

    try {
      const { tabName, payload } = await importTabConfigFromClipboard(projectName);

      const importedTasks = payload.selectedTasks.map((task) => ({
        ...task,
        id: generateId(),
        expanded: true,
      }));

      // 任务写入后 PresetSelector 自动消失，无需调用 skipPreset（避免触发 showAddTaskPanel）
      updateInstance(instanceId, {
        selectedTasks: importedTasks,
        controllerName: payload.controllerName,
        resourceName: payload.resourceName,
        preActions: payload.preActions,
      });

      if (payload.controllerName) {
        setSelectedController(instanceId, payload.controllerName);
      }
      if (payload.resourceName) {
        setSelectedResource(instanceId, payload.resourceName);
      }

      renameInstance(instanceId, tabName);
      toast.success(t('preset.importSuccess'));
    } catch (err) {
      const errorType = getImportErrorType(err);
      if (errorType === 'project_mismatch') {
        toast.error(t('preset.importProjectMismatch'));
      } else if (errorType === 'unsupported_version') {
        toast.error(t('preset.importVersionUnsupported'));
      } else {
        toast.error(t('preset.importFailed'));
      }
    }
  };

  return (
    <button
      onClick={handleImport}
      className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent transition-colors"
    >
      <ClipboardPaste className="w-3.5 h-3.5" />
      {t('preset.importConfig')}
    </button>
  );
}

/** 预设选择器 - 任务列表为空时显示 */
function PresetSelector({ instanceId }: { instanceId: string }) {
  const { projectInterface, applyPreset, skipPreset, renameInstance, resolveI18nText, language } =
    useAppStore();
  const { t } = useTranslation();
  const langKey = getInterfaceLangKey(language);

  const presets = projectInterface?.preset;
  if (!presets || presets.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="text-center space-y-1">
        <Sparkles className="w-8 h-8 text-accent mx-auto opacity-60" />
        <p className="text-sm text-text-secondary">{t('preset.title')}</p>
        <p className="text-xs text-text-muted">{t('preset.hint')}</p>
      </div>
      <div className="w-full max-w-md space-y-2">
        {presets.map((preset) => (
          <PresetCard
            key={preset.name}
            preset={preset}
            onApply={() => {
              applyPreset(instanceId, preset.name);
              const presetDisplayName = resolveI18nText(preset.label, langKey) || preset.name;
              renameInstance(instanceId, presetDisplayName);
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-4">
        <ImportConfigButton instanceId={instanceId} />
        <span className="text-text-muted/30 text-xs">|</span>
        <button
          onClick={() => skipPreset(instanceId)}
          className="text-xs text-text-muted hover:text-accent transition-colors"
        >
          {t('preset.skipToManual')}
        </button>
      </div>
    </div>
  );
}

export function TaskList() {
  const { t } = useTranslation();
  const {
    getActiveInstance,
    reorderTasks,
    reorderPreActions,
    selectAllTasks,
    collapseAllTasks,
    setShowAddTaskPanel,
    showAddTaskPanel,
    lastAddedTaskId,
    clearLastAddedTaskId,
    projectInterface,
    skippedPresetInstanceIds,
  } = useAppStore();

  const instance = getActiveInstance();
  const isInstanceRunning = instance?.isRunning || false;
  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();

  // 滚动容器引用
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 当添加新任务后自动滚动到底部
  useEffect(() => {
    if (lastAddedTaskId && scrollContainerRef.current) {
      // 使用 requestAnimationFrame 确保 DOM 已更新
      requestAnimationFrame(() => {
        // 使用 instant 避免与任务入场动画冲突产生视觉跳动
        scrollContainerRef.current?.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'instant',
        });
      });
      // 清除标记，避免重复触发
      clearLastAddedTaskId();
    }
  }, [lastAddedTaskId, clearLastAddedTaskId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 禁止 X 方向拖动，仅允许垂直排序
  const restrictHorizontalMovement: Modifier = ({ transform }) => ({
    ...transform,
    x: 0,
  });

  const handleDragEnd = (event: DragEndEvent) => {
    if (isInstanceRunning) return;
    const { active, over } = event;
    if (over && active.id !== over.id && instance) {
      const oldIndex = instance.selectedTasks.findIndex((t) => t.id === active.id);
      const newIndex = instance.selectedTasks.findIndex((t) => t.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      reorderTasks(instance.id, oldIndex, newIndex);
    }
  };

  const handlePreActionDragEnd = (event: DragEndEvent) => {
    if (isInstanceRunning) return;
    const { active, over } = event;
    if (over && active.id !== over.id && instance?.preActions) {
      const oldIndex = instance.preActions.findIndex((a) => a.id === active.id);
      const newIndex = instance.preActions.findIndex((a) => a.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      reorderPreActions(instance.id, oldIndex, newIndex);
    }
  };

  // 任务列表区域右键菜单
  const handleListContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!instance) return;

      const tasks = instance.selectedTasks;
      const hasEnabledTasks = tasks.some((t) => t.enabled);
      const hasExpandedTasks = tasks.some((t) => t.expanded);
      const hasTasks = tasks.length > 0;

      const menuItems: MenuItem[] = [
        {
          id: 'add',
          label: t('contextMenu.addTask'),
          icon: Plus,
          onClick: () => setShowAddTaskPanel(!showAddTaskPanel),
        },
        ...(hasTasks
          ? [
              { id: 'divider-1', label: '', divider: true },
              {
                id: 'select-all',
                label: hasEnabledTasks ? t('contextMenu.deselectAll') : t('contextMenu.selectAll'),
                icon: hasEnabledTasks ? Square : CheckSquare,
                onClick: () => selectAllTasks(instance.id, !hasEnabledTasks),
              },
              {
                id: 'collapse-all',
                label: hasExpandedTasks
                  ? t('contextMenu.collapseAllTasks')
                  : t('contextMenu.expandAllTasks'),
                icon: hasExpandedTasks ? ChevronUp : ChevronDown,
                onClick: () => collapseAllTasks(instance.id, !hasExpandedTasks),
              },
            ]
          : []),
        { id: 'divider-export', label: '', divider: true },
        {
          id: 'export',
          label: t('contextMenu.exportConfig'),
          icon: Share2,
          disabled: !hasTasks,
          onClick: () => {
            const projectName = projectInterface?.name;
            if (projectName) {
              exportWithToast(
                instance,
                projectName,
                t('preset.exportShareHint', { projectName, tabName: instance.name }),
                t('preset.exportShareFooter', { projectName }),
                { success: t('preset.exportSuccess'), failed: t('preset.exportFailed') },
              );
            }
          },
        },
      ];

      showMenu(e, menuItems);
    },
    [t, instance, showAddTaskPanel, setShowAddTaskPanel, selectAllTasks, collapseAllTasks, showMenu, projectInterface],
  );

  if (!instance) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        {t('taskList.noTasks')}
      </div>
    );
  }

  const tasks = instance.selectedTasks;

  const preActions = instance.preActions ?? [];
  const showPreActions = preActions.length > 0;
  const canReorderPreActions = !isInstanceRunning && preActions.length > 1;
  const hasPresets =
    (projectInterface?.preset?.length ?? 0) > 0 && !skippedPresetInstanceIds.has(instance.id);

  if (tasks.length === 0 && !showPreActions) {
    return (
      <>
        <div className="flex-1 overflow-y-auto" onContextMenu={handleListContextMenu}>
          {hasPresets ? (
            <PresetSelector instanceId={instance.id} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
              <ListTodo className="w-12 h-12 opacity-30" />
              <p className="text-sm">{t('taskList.noTasks')}</p>
              <p className="text-xs">{t('taskList.dragToReorder')}</p>
              <ImportConfigButton instanceId={instance.id} />
            </div>
          )}
        </div>
        {menuState.isOpen && (
          <ContextMenu items={menuState.items} position={menuState.position} onClose={hideMenu} />
        )}
      </>
    );
  }

  if (tasks.length === 0) {
    return (
      <>
        <div
          className="flex-1 flex flex-col overflow-y-auto p-3 gap-2"
          onContextMenu={handleListContextMenu}
        >
          {showPreActions && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handlePreActionDragEnd}
              modifiers={[restrictHorizontalMovement]}
            >
              <SortableContext
                items={preActions.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {preActions.map((action, idx) => (
                    <ActionItem
                      key={action.id}
                      instanceId={instance.id}
                      action={action}
                      disabled={isInstanceRunning}
                      canReorder={canReorderPreActions}
                      index={idx}
                      total={preActions.length}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {hasPresets ? (
            <PresetSelector instanceId={instance.id} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3 min-h-[120px]">
              <ListTodo className="w-12 h-12 opacity-30" />
              <p className="text-sm">{t('taskList.noTasks')}</p>
              <p className="text-xs">{t('taskList.dragToReorder')}</p>
              <ImportConfigButton instanceId={instance.id} />
            </div>
          )}
        </div>
        {menuState.isOpen && (
          <ContextMenu items={menuState.items} position={menuState.position} onClose={hideMenu} />
        )}
      </>
    );
  }

  return (
    <>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-3"
        onClick={() => showAddTaskPanel && setShowAddTaskPanel(false)}
        onContextMenu={handleListContextMenu}
      >
        <div className="space-y-2">
          {/* 前置动作列表（支持拖拽排序） */}
          {showPreActions && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handlePreActionDragEnd}
              modifiers={[restrictHorizontalMovement]}
            >
              <SortableContext
                items={preActions.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {preActions.map((action, idx) => (
                  <ActionItem
                    key={action.id}
                    instanceId={instance.id}
                    action={action}
                    disabled={isInstanceRunning}
                    canReorder={canReorderPreActions}
                    index={idx}
                    total={preActions.length}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* 任务列表 */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictHorizontalMovement]}
          >
            <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskItem key={task.id} instanceId={instance.id} task={task} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
      {menuState.isOpen && (
        <ContextMenu items={menuState.items} position={menuState.position} onClose={hideMenu} />
      )}

    </>
  );
}
