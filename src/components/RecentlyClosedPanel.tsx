import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Clock, RotateCcw, Trash2, Gamepad2, Package, ListChecks } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { RecentlyClosedInstance } from '@/types/config';
import clsx from 'clsx';

interface RecentlyClosedPanelProps {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

// 格式化相对时间
function formatRelativeTime(timestamp: number, t: (key: string) => string): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return t('recentlyClosed.daysAgo').replace('{{count}}', String(days));
  }
  if (hours > 0) {
    return t('recentlyClosed.hoursAgo').replace('{{count}}', String(hours));
  }
  if (minutes > 0) {
    return t('recentlyClosed.minutesAgo').replace('{{count}}', String(minutes));
  }
  return t('recentlyClosed.justNow');
}

// 格式化完整时间
function formatFullTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// 格式化任务摘要
function formatTasksSummary(item: RecentlyClosedInstance, t: (key: string) => string): string {
  const taskCount = item.tasks.length;
  if (taskCount === 0) {
    return t('recentlyClosed.noTasks');
  }
  
  const firstTaskName = item.tasks[0].customName || item.tasks[0].taskName;
  if (taskCount === 1) {
    return firstTaskName;
  }
  
  return t('recentlyClosed.tasksCount')
    .replace('{{first}}', firstTaskName)
    .replace('{{count}}', String(taskCount));
}

export function RecentlyClosedPanel({ onClose, anchorRef }: RecentlyClosedPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  
  const {
    recentlyClosed,
    reopenRecentlyClosed,
    removeFromRecentlyClosed,
    clearRecentlyClosed,
  } = useAppStore();

  // 计算面板位置
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [anchorRef]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, anchorRef]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleReopen = (id: string) => {
    reopenRecentlyClosed(id);
    onClose();
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeFromRecentlyClosed(id);
  };

  const handleClearAll = () => {
    clearRecentlyClosed();
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-80 bg-bg-secondary rounded-xl shadow-lg border border-border overflow-hidden animate-in"
      style={{
        top: position.top,
        right: position.right,
      }}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            {t('recentlyClosed.title')}
          </span>
          {recentlyClosed.length > 0 && (
            <span className="px-1.5 py-0.5 bg-bg-active text-text-muted text-xs rounded">
              {recentlyClosed.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {recentlyClosed.length > 0 && (
            <button
              onClick={handleClearAll}
              className="p-1 rounded-md hover:bg-bg-hover transition-colors text-text-muted hover:text-error"
              title={t('recentlyClosed.clearAll')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-bg-hover transition-colors"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="max-h-80 overflow-y-auto">
        {recentlyClosed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-muted">
            <Clock className="w-8 h-8 mb-2 opacity-50" />
            <span className="text-sm">{t('recentlyClosed.empty')}</span>
          </div>
        ) : (
          <div className="py-1">
            {recentlyClosed.map((item) => (
              <div
                key={item.id}
                onClick={() => handleReopen(item.id)}
                className={clsx(
                  'group px-4 py-2.5 cursor-pointer',
                  'hover:bg-bg-hover transition-colors'
                )}
              >
                {/* 第一行：名称 + 操作按钮 */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm font-medium text-text-primary truncate" title={item.name}>
                    {item.name}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReopen(item.id);
                      }}
                      className="p-1 rounded-md hover:bg-accent/10 text-accent transition-colors"
                      title={t('recentlyClosed.reopen')}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleRemove(e, item.id)}
                      className="p-1 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                      title={t('recentlyClosed.remove')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                
                {/* 第二行：控制器 · 资源 · 任务 */}
                <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                  {item.controllerName && (
                    <span className="flex items-center gap-1 shrink-0" title={t('controller.title')}>
                      <Gamepad2 className="w-3 h-3" />
                      <span className="max-w-[80px] truncate">{item.controllerName}</span>
                    </span>
                  )}
                  {item.controllerName && item.resourceName && (
                    <span className="text-text-muted/50">·</span>
                  )}
                  {item.resourceName && (
                    <span className="flex items-center gap-1 shrink-0" title={t('resource.title')}>
                      <Package className="w-3 h-3" />
                      <span className="max-w-[80px] truncate">{item.resourceName}</span>
                    </span>
                  )}
                  {(item.controllerName || item.resourceName) && item.tasks.length > 0 && (
                    <span className="text-text-muted/50">·</span>
                  )}
                  {item.tasks.length > 0 && (
                    <span className="flex items-center gap-1 truncate" title={formatTasksSummary(item, t)}>
                      <ListChecks className="w-3 h-3 shrink-0" />
                      <span className="truncate">{formatTasksSummary(item, t)}</span>
                    </span>
                  )}
                </div>

                {/* 第三行：时间 */}
                <div className="text-xs text-text-muted/70 mt-1">
                  <span>{formatRelativeTime(item.closedAt, t)}</span>
                  <span className="mx-1">·</span>
                  <span>{formatFullTime(item.closedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
