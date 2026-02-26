import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
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
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { TaskItem } from './TaskItem';
import { ActionItem } from './ActionItem';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import type { OptionValue, SelectedTask, PresetItem } from '@/types/interface';
import { ConfirmDialog } from './ConfirmDialog';
import { getInterfaceLangKey } from '@/i18n';
import { TaskTransferPreview } from './TaskTransferPreview';
import { isTauri } from '@/utils/paths';
import { useResolvedContent } from '@/services/contentResolver';
import clsx from 'clsx';

/** 单个预设卡片 */
function PresetCard({
  preset,
  onApply,
}: {
  preset: PresetItem;
  onApply: () => void;
}) {
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

/** 预设选择器 - 任务列表为空时显示 */
function PresetSelector({ instanceId }: { instanceId: string }) {
  const { projectInterface, applyPreset, skipPreset } = useAppStore();
  const { t } = useTranslation();

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
            onApply={() => applyPreset(instanceId, preset.name)}
          />
        ))}
      </div>
      <button
        onClick={() => skipPreset(instanceId)}
        className="text-xs text-text-muted hover:text-accent transition-colors"
      >
        {t('preset.skipToManual')}
      </button>
    </div>
  );
}

export function TaskList() {
  const { t } = useTranslation();
  const {
    getActiveInstance,
    updateInstance,
    reorderTasks,
    selectAllTasks,
    collapseAllTasks,
    setShowAddTaskPanel,
    showAddTaskPanel,
    lastAddedTaskId,
    clearLastAddedTaskId,
    projectInterface,
    resolveI18nText,
    language,
    interfaceTranslations,
    skippedPresetInstanceIds,
  } = useAppStore();

  const instance = getActiveInstance();
  const isInstanceRunning = instance?.isRunning || false;
  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportSelected, setExportSelected] = useState<Record<string, boolean>>({});
  const [pendingImportTasks, setPendingImportTasks] = useState<SelectedTask[] | null>(null);
  const [importPreviewJson, setImportPreviewJson] = useState<string>('');
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importMode, setImportMode] = useState<'overwrite' | 'merge'>('overwrite');

  const exportPayload = useMemo(() => {
    if (!instance) return null;
    return {
      version: 1,
      tasks: instance.selectedTasks.map((t) => ({
        id: t.id,
        taskName: t.taskName,
        customName: t.customName,
        enabled: t.enabled,
        optionValues: t.optionValues,
      })),
    };
  }, [instance]);

  const taskNameToLabel = useMemo(() => {
    const langKey = getInterfaceLangKey(language);
    const translations = interfaceTranslations[langKey];
    const map: Record<string, string> = {};
    for (const td of projectInterface?.task ?? []) {
      map[td.name] = resolveI18nText(td.label, langKey) || td.name;
    }
    // fallback: if translations missing, still show task name
    void translations;
    return map;
  }, [projectInterface, resolveI18nText, language, interfaceTranslations]);

  const getTaskDisplayName = useCallback(
    (taskName: string, customName?: string) => {
      return customName || taskNameToLabel[taskName] || taskName;
    },
    [taskNameToLabel],
  );

  // 初始化匯出勾選（預設全選）
  useEffect(() => {
    if (!exportPreviewOpen || !exportPayload) return;
    const next: Record<string, boolean> = {};
    exportPayload.tasks.forEach((t) => {
      next[String(t.id)] = true;
    });
    setExportSelected(next);
  }, [exportPreviewOpen, exportPayload]);

  const exportJson = useMemo(() => {
    if (!exportPayload) return '';
    const filtered = {
      version: exportPayload.version,
      tasks: exportPayload.tasks
        .filter((t) => exportSelected[String(t.id)] !== false)
        .map(({ id: _id, ...rest }) => rest),
    };
    return JSON.stringify(filtered, null, 2);
  }, [exportPayload, exportSelected]);

  const exportSelectedCount = useMemo(() => {
    if (!exportPayload) return 0;
    return exportPayload.tasks.filter((t) => exportSelected[String(t.id)] !== false).length;
  }, [exportPayload, exportSelected]);

  const importSelectedCount = useMemo(() => {
    if (!pendingImportTasks) return 0;
    return pendingImportTasks.filter((t) => importSelected[t.id] !== false).length;
  }, [pendingImportTasks, importSelected]);

  const downloadJson = async (filename: string, data: unknown) => {
    const content = JSON.stringify(data, null, 2);
    if (isTauri()) {
      try {
        const filePath = await save({
          defaultPath: filename,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!filePath) return;
        await writeTextFile(filePath, content);
      } catch {
        // ignore (could add toast later)
      }
      return;
    }

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportTasks = useCallback(() => {
    if (!instance || !exportPayload) return;
    setExportPreviewOpen(true);
  }, [instance, exportPayload]);

  const parseImportText = (text: string): SelectedTask[] => {
    const parsed = JSON.parse(text) as any;
    const rawTasks: any[] = Array.isArray(parsed) ? parsed : parsed?.tasks;
    if (!Array.isArray(rawTasks)) throw new Error('Invalid format');

    return rawTasks.map((rt) => {
      const taskName = String(rt.taskName ?? '');
      if (!taskName) throw new Error('Invalid task');
      const optionValues = (rt.optionValues ?? {}) as Record<string, OptionValue>;
      return {
        id: crypto.randomUUID(),
        taskName,
        customName: rt.customName ? String(rt.customName) : undefined,
        enabled: rt.enabled !== false,
        optionValues,
        expanded: false,
      } satisfies SelectedTask;
    });
  };

  const handleImportTasks = useCallback(async () => {
    if (!instance || isInstanceRunning) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = parseImportText(text);
        setImportPreviewJson(text);
        setPendingImportTasks(imported);
        setImportMode('overwrite');
        // 預設全選
        const next: Record<string, boolean> = {};
        imported.forEach((t) => {
          next[t.id] = true;
        });
        setImportSelected(next);
      } catch {
        // ignore (could add toast later)
      }
    };
    input.click();
  }, [instance, isInstanceRunning]);

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
    // 运行时禁止重新排序
    if (isInstanceRunning) return;

    const { active, over } = event;

    if (over && active.id !== over.id && instance) {
      const oldIndex = instance.selectedTasks.findIndex((t) => t.id === active.id);
      const newIndex = instance.selectedTasks.findIndex((t) => t.id === over.id);
      reorderTasks(instance.id, oldIndex, newIndex);
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
                id: 'export-tasks',
                label: t('contextMenu.exportTasks'),
                icon: ListTodo,
                onClick: () => handleExportTasks(),
              },
              {
                id: 'import-tasks',
                label: t('contextMenu.importTasks'),
                icon: Plus,
                disabled: isInstanceRunning,
                onClick: () => {
                  void handleImportTasks();
                },
              },
              { id: 'divider-0', label: '', divider: true },
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
      ];

      showMenu(e, menuItems);
    },
    [
      t,
      instance,
      showAddTaskPanel,
      setShowAddTaskPanel,
      selectAllTasks,
      collapseAllTasks,
      showMenu,
      handleExportTasks,
      handleImportTasks,
      isInstanceRunning,
    ],
  );

  if (!instance) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        {t('taskList.noTasks')}
      </div>
    );
  }

  const tasks = instance.selectedTasks;

  const showPreAction = !!instance.preAction;
  const hasPresets =
    (projectInterface?.preset?.length ?? 0) > 0 &&
    !skippedPresetInstanceIds.has(instance.id);

  if (tasks.length === 0 && !showPreAction) {
    return (
      <>
        <div
          className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3 overflow-y-auto"
          onContextMenu={handleListContextMenu}
        >
          {hasPresets ? (
            <PresetSelector instanceId={instance.id} />
          ) : (
            <>
              <ListTodo className="w-12 h-12 opacity-30" />
              <p className="text-sm">{t('taskList.noTasks')}</p>
              <p className="text-xs">{t('taskList.dragToReorder')}</p>
            </>
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
          {showPreAction && (
            <ActionItem
              instanceId={instance.id}
              action={instance.preAction}
              disabled={isInstanceRunning}
            />
          )}

          <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3 min-h-[120px]">
            {hasPresets ? (
              <PresetSelector instanceId={instance.id} />
            ) : (
              <>
                <ListTodo className="w-12 h-12 opacity-30" />
                <p className="text-sm">{t('taskList.noTasks')}</p>
                <p className="text-xs">{t('taskList.dragToReorder')}</p>
              </>
            )}
          </div>
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
          {/* 前置动作（只在已配置时显示） */}
          {showPreAction && (
            <ActionItem
              instanceId={instance.id}
              action={instance.preAction}
              disabled={isInstanceRunning}
            />
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

      {/* 匯出預覽/確認（可勾選） */}
      <ConfirmDialog
        open={exportPreviewOpen && !!instance && !!exportPayload}
        title={t('taskList.exportConfirmTitle')}
        message={
          exportPayload
            ? t('taskList.exportConfirmHint', { count: exportPayload.tasks.length })
            : undefined
        }
        cancelText={t('common.cancel')}
        confirmText={t('taskList.exportConfirmAction')}
        confirmDisabled={exportSelectedCount === 0}
        onCancel={() => setExportPreviewOpen(false)}
        onConfirm={async () => {
          if (!instance || !exportPayload) return;
          const safeName = instance.name.replace(/[\\/:*?"<>|]/g, '_');
          const filtered = {
            version: exportPayload.version,
            tasks: exportPayload.tasks
              .filter((t) => exportSelected[String(t.id)] !== false)
              .map(({ id: _id, ...rest }) => rest),
          };
          await downloadJson(`mxu-tasks-${safeName}.json`, filtered);
          setExportPreviewOpen(false);
        }}
      >
        {exportPayload && (
          <TaskTransferPreview
            countText={t('taskList.selectionCount', {
              selected: exportSelectedCount,
              total: exportPayload.tasks.length,
            })}
            selectAllText={t('taskList.selectAll')}
            selectNoneText={t('taskList.selectNone')}
            onSelectAll={() => {
              const next: Record<string, boolean> = {};
              exportPayload.tasks.forEach((t) => (next[String(t.id)] = true));
              setExportSelected(next);
            }}
            onSelectNone={() => {
              const next: Record<string, boolean> = {};
              exportPayload.tasks.forEach((t) => (next[String(t.id)] = false));
              setExportSelected(next);
            }}
            items={exportPayload.tasks.map((t) => ({
              id: String(t.id),
              label: getTaskDisplayName(t.taskName, t.customName),
            }))}
            selected={exportSelected}
            onToggle={(id, checked) => setExportSelected((prev) => ({ ...prev, [id]: checked }))}
            emptySelectionWarning={
              exportSelectedCount === 0 ? t('taskList.mustSelectAtLeastOne') : undefined
            }
            previewJson={exportJson}
          />
        )}
      </ConfirmDialog>

      {/* 匯入預覽/確認（可勾選） */}
      <ConfirmDialog
        open={pendingImportTasks !== null}
        title={t('taskList.importConfirmTitle')}
        message={
          importMode === 'overwrite'
            ? t('taskList.importConfirmMessageOverwrite')
            : t('taskList.importConfirmMessageMerge')
        }
        cancelText={t('common.cancel')}
        confirmText={t('taskList.importConfirmAction')}
        destructive={importMode === 'overwrite'}
        confirmDisabled={pendingImportTasks !== null && importSelectedCount === 0}
        onCancel={() => setPendingImportTasks(null)}
        onConfirm={() => {
          if (!instance || !pendingImportTasks) return;
          const filtered = pendingImportTasks.filter((t) => importSelected[t.id] !== false);
          if (importMode === 'overwrite') {
            updateInstance(instance.id, { selectedTasks: filtered });
          } else {
            const existing = instance.selectedTasks;
            const seen = new Set(existing.map((t) => `${t.taskName}::${t.customName ?? ''}`));
            const merged = [
              ...existing,
              ...filtered.filter((t) => {
                const key = `${t.taskName}::${t.customName ?? ''}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              }),
            ];
            updateInstance(instance.id, { selectedTasks: merged });
          }
          setPendingImportTasks(null);
        }}
      >
        {pendingImportTasks && (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-secondary">
                {t('taskList.importModeLabel')}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="flex items-start gap-2 p-2 rounded-lg bg-bg-tertiary border border-border cursor-pointer">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === 'overwrite'}
                    onChange={() => setImportMode('overwrite')}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text-primary">
                      {t('taskList.importModeOverwrite')}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {t('taskList.importModeOverwriteHint')}
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 p-2 rounded-lg bg-bg-tertiary border border-border cursor-pointer">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text-primary">
                      {t('taskList.importModeMerge')}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {t('taskList.importModeMergeHint')}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <TaskTransferPreview
              countText={t('taskList.importPreviewCount', { count: pendingImportTasks.length })}
              selectAllText={t('taskList.selectAll')}
              selectNoneText={t('taskList.selectNone')}
              onSelectAll={() => {
                const next: Record<string, boolean> = {};
                pendingImportTasks.forEach((t) => (next[t.id] = true));
                setImportSelected(next);
              }}
              onSelectNone={() => {
                const next: Record<string, boolean> = {};
                pendingImportTasks.forEach((t) => (next[t.id] = false));
                setImportSelected(next);
              }}
              items={pendingImportTasks.map((t) => ({
                id: t.id,
                label: getTaskDisplayName(t.taskName, t.customName),
              }))}
              selected={importSelected}
              onToggle={(id, checked) => setImportSelected((prev) => ({ ...prev, [id]: checked }))}
              emptySelectionWarning={
                importSelectedCount === 0 ? t('taskList.mustSelectAtLeastOne') : undefined
              }
              previewJson={importPreviewJson}
            />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
