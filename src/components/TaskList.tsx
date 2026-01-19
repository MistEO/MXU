import { useCallback } from 'react';
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
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { TaskItem } from './TaskItem';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';

export function TaskList() {
  const { t } = useTranslation();
  const {
    getActiveInstance,
    reorderTasks,
    selectAllTasks,
    collapseAllTasks,
    setShowAddTaskPanel,
    showAddTaskPanel,
  } = useAppStore();

  const instance = getActiveInstance();
  const isInstanceRunning = instance?.isRunning || false;
  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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
                id: 'select-all',
                label: hasEnabledTasks
                  ? t('contextMenu.deselectAll')
                  : t('contextMenu.selectAll'),
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
    ]
  );

  if (!instance) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        {t('taskList.noTasks')}
      </div>
    );
  }

  const tasks = instance.selectedTasks;

  if (tasks.length === 0) {
    return (
      <>
        <div
          className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3"
          onContextMenu={handleListContextMenu}
        >
          <ListTodo className="w-12 h-12 opacity-30" />
          <p className="text-sm">{t('taskList.noTasks')}</p>
          <p className="text-xs">{t('taskList.dragToReorder')}</p>
        </div>
        {menuState.isOpen && (
          <ContextMenu
            items={menuState.items}
            position={menuState.position}
            onClose={hideMenu}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3" onContextMenu={handleListContextMenu}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictHorizontalMovement]}
        >
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {tasks.map((task) => (
                <TaskItem key={task.id} instanceId={instance.id} task={task} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      {menuState.isOpen && (
        <ContextMenu
          items={menuState.items}
          position={menuState.position}
          onClose={hideMenu}
        />
      )}
    </>
  );
}
