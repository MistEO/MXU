import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  X,
  Settings,
  Sun,
  Moon,
  Check,
  LayoutGrid,
  Copy,
  Edit3,
  XCircle,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  PanelRightClose,
  Bell,
  History,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import { UpdatePanel } from './UpdatePanel';
import { RecentlyClosedPanel } from './RecentlyClosedPanel';
import { getInterfaceLangKey } from '@/i18n';
import clsx from 'clsx';

export function TabBar() {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    draggedIndex: number;
    dragOverIndex: number | null;
  }>({ isDragging: false, draggedIndex: -1, dragOverIndex: null });
  const [showRecentlyClosedPanel, setShowRecentlyClosedPanel] = useState(false);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const recentlyClosedButtonRef = useRef<HTMLButtonElement>(null);

  const {
    instances,
    activeInstanceId,
    createInstance,
    removeInstance,
    setActiveInstance,
    renameInstance,
    reorderInstances,
    duplicateInstance,
    theme,
    setTheme,
    setCurrentPage,
    projectInterface,
    resolveI18nText,
    language,
    dashboardView,
    toggleDashboardView,
    updateInfo,
    recentlyClosed,
    downloadStatus,
    showUpdateDialog,
    setShowUpdateDialog,
    animatingTabIds,
    closingTabIds,
    removeAnimatingTabId,
    startTabCloseAnimation,
  } = useAppStore();

  // 使用全局状态控制更新面板显示
  const showUpdatePanel = showUpdateDialog;
  const setShowUpdatePanel = setShowUpdateDialog;

  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();

  // 当最近关闭列表为空时，自动关闭面板
  useEffect(() => {
    if (recentlyClosed.length === 0) {
      setShowRecentlyClosedPanel(false);
    }
  }, [recentlyClosed.length]);

  const handleNewTab = () => {
    createInstance(t('instance.defaultName'));
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (instances.length > 1) {
      startTabCloseAnimation(id);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = () => {
    if (editingId && editName.trim()) {
      renameInstance(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const langKey = getInterfaceLangKey(language);

  // 右键菜单处理
  const handleTabContextMenu = useCallback(
    (e: React.MouseEvent, instanceId: string, instanceName: string) => {
      const instanceIndex = instances.findIndex((i) => i.id === instanceId);
      const isFirst = instanceIndex === 0;
      const isLast = instanceIndex === instances.length - 1;

      const menuItems: MenuItem[] = [
        {
          id: 'new',
          label: t('contextMenu.newTab'),
          icon: Plus,
          onClick: () => createInstance(t('instance.defaultName')),
        },
        {
          id: 'duplicate',
          label: t('contextMenu.duplicateTab'),
          icon: Copy,
          onClick: () => duplicateInstance(instanceId),
        },
        {
          id: 'rename',
          label: t('contextMenu.renameTab'),
          icon: Edit3,
          onClick: () => {
            setEditingId(instanceId);
            setEditName(instanceName);
          },
        },
        { id: 'divider-1', label: '', divider: true },
        {
          id: 'move-left',
          label: t('contextMenu.moveLeft'),
          icon: ChevronLeft,
          disabled: isFirst,
          onClick: () => reorderInstances(instanceIndex, instanceIndex - 1),
        },
        {
          id: 'move-right',
          label: t('contextMenu.moveRight'),
          icon: ChevronRight,
          disabled: isLast,
          onClick: () => reorderInstances(instanceIndex, instanceIndex + 1),
        },
        {
          id: 'move-first',
          label: t('contextMenu.moveToFirst'),
          icon: ChevronsLeft,
          disabled: isFirst,
          onClick: () => reorderInstances(instanceIndex, 0),
        },
        {
          id: 'move-last',
          label: t('contextMenu.moveToLast'),
          icon: ChevronsRight,
          disabled: isLast,
          onClick: () => reorderInstances(instanceIndex, instances.length - 1),
        },
        { id: 'divider-2', label: '', divider: true },
        {
          id: 'close',
          label: t('contextMenu.closeTab'),
          icon: X,
          disabled: instances.length <= 1,
          onClick: () => startTabCloseAnimation(instanceId),
        },
        {
          id: 'close-others',
          label: t('contextMenu.closeOtherTabs'),
          icon: XCircle,
          disabled: instances.length <= 1,
          onClick: () => {
            instances.forEach((inst) => {
              if (inst.id !== instanceId) {
                startTabCloseAnimation(inst.id);
              }
            });
          },
        },
        {
          id: 'close-right',
          label: t('contextMenu.closeTabsToRight'),
          icon: PanelRightClose,
          disabled: instanceIndex >= instances.length - 1,
          onClick: () => {
            instances.slice(instanceIndex + 1).forEach((inst) => {
              startTabCloseAnimation(inst.id);
            });
          },
        },
      ];

      showMenu(e, menuItems);
    },
    [instances, t, createInstance, duplicateInstance, removeInstance, reorderInstances, showMenu],
  );

  // 基于鼠标事件的拖拽实现（更可靠，兼容 Tauri）
  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    // 只响应拖拽手柄的点击
    if (!(e.target as HTMLElement).closest('.drag-handle')) return;

    e.preventDefault();
    setDragState({ isDragging: true, draggedIndex: index, dragOverIndex: null });
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragState.isDragging) return;

      // 找出鼠标当前位置对应的标签索引
      let newDragOverIndex: number | null = null;
      tabRefs.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          const idx = instances.findIndex((inst) => inst.id === id);
          if (idx !== -1 && idx !== dragState.draggedIndex) {
            newDragOverIndex = idx;
          }
        }
      });

      if (newDragOverIndex !== dragState.dragOverIndex) {
        setDragState((prev) => ({ ...prev, dragOverIndex: newDragOverIndex }));
      }
    },
    [dragState.isDragging, dragState.draggedIndex, dragState.dragOverIndex, instances],
  );

  const handleMouseUp = useCallback(() => {
    if (!dragState.isDragging) return;

    if (dragState.dragOverIndex !== null && dragState.draggedIndex !== dragState.dragOverIndex) {
      reorderInstances(dragState.draggedIndex, dragState.dragOverIndex);
    }
    setDragState({ isDragging: false, draggedIndex: -1, dragOverIndex: null });
  }, [dragState, reorderInstances]);

  // 全局鼠标事件监听
  useEffect(() => {
    if (dragState.isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState.isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex items-center h-10 bg-bg-secondary border-b border-border select-none">
      {/* 标签页区域 */}
      <div className="flex-1 flex items-center h-full overflow-x-auto">
        {instances.map((instance, index) => {
          const isAnimatingIn = animatingTabIds.includes(instance.id);
          const isClosing = closingTabIds.includes(instance.id);

          return (
            <div
              key={instance.id}
              ref={(el) => {
                if (el) tabRefs.current.set(instance.id, el);
                else tabRefs.current.delete(instance.id);
              }}
              onMouseDown={(e) => handleMouseDown(e, index)}
              onClick={() => !isClosing && setActiveInstance(instance.id)}
              onDoubleClick={(e) => handleDoubleClick(e, instance.id, instance.name)}
              onContextMenu={(e) => handleTabContextMenu(e, instance.id, instance.name)}
              onAnimationEnd={() => {
                if (isAnimatingIn) {
                  removeAnimatingTabId(instance.id);
                }
              }}
              className={clsx(
                'group flex items-center gap-1 h-full px-2 cursor-pointer border-r border-border min-w-[120px] max-w-[200px]',
                instance.id === activeInstanceId
                  ? 'bg-bg-primary text-accent border-b-2 border-b-accent'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border-b-2 border-b-transparent',
                dragState.isDragging &&
                  dragState.draggedIndex === index &&
                  'opacity-50 bg-accent/10',
                dragState.isDragging &&
                  dragState.dragOverIndex === index &&
                  'border-l-2 border-l-accent',
                isAnimatingIn && 'tab-fade-in',
                isClosing && 'tab-fade-out',
                !isAnimatingIn && !isClosing && 'transition-all',
              )}
            >
              {/* 拖拽手柄 - 单标签时禁用 */}
              {editingId !== instance.id && (
                <div
                  className={clsx(
                    'drag-handle p-0.5 transition-opacity',
                    instances.length > 1
                      ? 'cursor-grab opacity-0 group-hover:opacity-60 hover:!opacity-100'
                      : 'cursor-not-allowed opacity-30',
                  )}
                  title={instances.length > 1 ? t('titleBar.dragToReorder') : undefined}
                >
                  <GripVertical className="w-3 h-3" />
                </div>
              )}

              {editingId === instance.id ? (
                <div
                  className="flex-1 flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveEdit}
                    autoFocus
                    className={clsx(
                      'flex-1 w-full px-1 py-0.5 text-sm rounded border border-accent',
                      'bg-bg-primary text-text-primary',
                      'focus:outline-none',
                    )}
                  />
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSaveEdit();
                    }}
                    className="p-0.5 rounded hover:bg-success/10 text-success"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCancelEdit();
                    }}
                    className="p-0.5 rounded hover:bg-error/10 text-error"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 truncate text-sm" title={t('titleBar.renameInstance')}>
                    {instance.name}
                  </span>
                  {!isClosing && (
                    <button
                      onClick={(e) => handleCloseTab(e, instance.id)}
                      disabled={instances.length <= 1}
                      className={clsx(
                        'p-0.5 rounded transition-opacity',
                        instances.length > 1
                          ? 'opacity-0 group-hover:opacity-100 hover:bg-bg-active'
                          : 'opacity-30 cursor-not-allowed',
                      )}
                      title={instances.length > 1 ? t('titleBar.closeTab') : undefined}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* 新建标签按钮 */}
        <button
          onClick={handleNewTab}
          className="flex items-center justify-center w-8 h-full hover:bg-bg-hover transition-colors"
          title={t('titleBar.newTab')}
        >
          <Plus className="w-4 h-4 text-text-secondary" />
        </button>
      </div>

      {/* 项目名称（根据协议，label 是 UI 显示名称，title 是窗口标题） */}
      <div className="px-4 text-sm font-medium text-text-secondary">
        {resolveI18nText(projectInterface?.label, langKey) || projectInterface?.name || 'MXU'}
      </div>

      {/* 工具按钮 */}
      <div className="flex items-center gap-1 px-2">
        {/* 更新通知图标 - 有更新或正在下载时显示 */}
        {(updateInfo?.hasUpdate || downloadStatus === 'downloading') && (
          <button
            ref={bellButtonRef}
            onClick={() => setShowUpdatePanel(!showUpdatePanel)}
            className={clsx(
              'relative p-2 rounded-md transition-colors',
              showUpdatePanel ? 'bg-accent/10' : 'hover:bg-bg-hover',
            )}
            title={t('mirrorChyan.newVersion')}
          >
            <Bell
              className={clsx('w-4 h-4 text-accent', !showUpdatePanel && 'animate-bell-shake')}
            />
            {!showUpdatePanel && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full animate-pulse" />
            )}
          </button>
        )}
        {/* 最近关闭按钮 - 仅在有记录时显示 */}
        {recentlyClosed.length > 0 && (
          <button
            ref={recentlyClosedButtonRef}
            onClick={() => setShowRecentlyClosedPanel(!showRecentlyClosedPanel)}
            className={clsx(
              'p-2 rounded-md transition-colors',
              showRecentlyClosedPanel
                ? 'bg-accent/10 text-accent'
                : 'hover:bg-bg-hover text-text-secondary',
            )}
            title={t('recentlyClosed.title')}
          >
            <History className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={toggleDashboardView}
          className={clsx(
            'p-2 rounded-md transition-colors',
            dashboardView ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-secondary',
          )}
          title={t('dashboard.toggle')}
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-bg-hover transition-colors"
          title={theme === 'light' ? t('settings.themeDark') : t('settings.themeLight')}
        >
          {theme === 'light' ? (
            <Moon className="w-4 h-4 text-text-secondary" />
          ) : (
            <Sun className="w-4 h-4 text-text-secondary" />
          )}
        </button>
        <button
          onClick={() => setCurrentPage('settings')}
          className="p-2 rounded-md hover:bg-bg-hover transition-colors"
          title={t('titleBar.settings')}
        >
          <Settings className="w-4 h-4 text-text-secondary" />
        </button>
      </div>

      {/* 右键菜单 */}
      {menuState.isOpen && (
        <ContextMenu items={menuState.items} position={menuState.position} onClose={hideMenu} />
      )}

      {/* 更新面板 */}
      {showUpdatePanel && (
        <UpdatePanel onClose={() => setShowUpdatePanel(false)} anchorRef={bellButtonRef} />
      )}

      {/* 最近关闭面板 */}
      {showRecentlyClosedPanel && (
        <RecentlyClosedPanel
          onClose={() => setShowRecentlyClosedPanel(false)}
          anchorRef={recentlyClosedButtonRef}
        />
      )}
    </div>
  );
}
