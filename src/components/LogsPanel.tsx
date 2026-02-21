import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, ChevronUp, ChevronDown, Archive } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore, type LogType } from '@/stores/appStore';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import { isTauri } from '@/utils/paths';
import { useExportLogs } from '@/utils/useExportLogs';
import { ExportLogsModal } from './settings/ExportLogsModal';

export function LogsPanel() {
  const { t } = useTranslation();
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const { sidePanelExpanded, toggleSidePanelExpanded, activeInstanceId, instanceLogs, clearLogs } =
    useAppStore();
  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();
  const { exportModal, handleExportLogs, closeExportModal, openExportedFile } = useExportLogs();

  // 获取当前实例的日志
  const logs = activeInstanceId ? instanceLogs[activeInstanceId] || [] : [];

  useEffect(() => {
    const el = logsContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [logs]);

  const handleClear = useCallback(() => {
    if (activeInstanceId) {
      clearLogs(activeInstanceId);
    }
  }, [activeInstanceId, clearLogs]);

  const handleCopyAll = useCallback(() => {
    const text = logs
      .map((log) => `[${log.timestamp.toLocaleTimeString()}] ${log.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  }, [logs]);

  const getLogColor = (type: LogType) => {
    switch (type) {
      case 'success':
        return 'text-success'; // 跟随主题强调色
      case 'warning':
        return 'text-warning';
      case 'error':
        return 'text-error';
      case 'agent':
        return 'text-text-muted';
      case 'focus':
        return 'text-accent'; // 跟随主题强调色
      case 'info':
        return 'text-info'; // 跟随主题强调色
      default:
        return 'text-text-secondary';
    }
  };

  // 右键菜单处理
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      const menuItems: MenuItem[] = [
        {
          id: 'export-logs',
          label: t('debug.exportLogs'),
          icon: Archive,
          disabled: !isTauri(),
          onClick: handleExportLogs,
        },
        {
          id: 'copy',
          label: t('logs.copyAll'),
          icon: Copy,
          disabled: logs.length === 0,
          onClick: handleCopyAll,
        },
        {
          id: 'clear',
          label: t('logs.clear'),
          icon: Trash2,
          disabled: logs.length === 0,
          danger: true,
          onClick: handleClear,
        },
        { id: 'divider-1', label: '', divider: true },
        {
          id: 'toggle-panel',
          label: sidePanelExpanded ? t('logs.collapse') : t('logs.expand'),
          icon: sidePanelExpanded ? ChevronUp : ChevronDown,
          onClick: toggleSidePanelExpanded,
        },
      ];

      showMenu(e, menuItems);
    },
    [
      t,
      logs.length,
      sidePanelExpanded,
      handleExportLogs,
      handleCopyAll,
      handleClear,
      toggleSidePanelExpanded,
      showMenu,
    ],
  );

  // 根据日志类型获取前缀标签
  const getLogPrefix = (type: LogType) => {
    switch (type) {
      case 'agent':
        return '';
      case 'focus':
        return '';
      default:
        return '';
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-bg-secondary rounded-lg ring-1 ring-inset ring-border overflow-hidden min-h-50">
      {/* 标题栏（可点击展开/折叠上方面板） */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleSidePanelExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSidePanelExpanded();
          }
        }}
        className="flex items-center justify-between px-3 py-2 border-b border-border hover:bg-bg-hover transition-colors cursor-pointer shrink-0 rounded-t-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 outline-none"
      >
        <span className="text-sm font-medium text-text-primary">{t('logs.title')}</span>
        <div className="flex items-center gap-2">
          {/* 导出日志 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleExportLogs();
            }}
            disabled={!isTauri() || (exportModal.show && exportModal.status === 'exporting')}
            className={clsx(
              'p-1 rounded-md transition-colors',
              !isTauri()
                ? 'text-text-muted cursor-not-allowed'
                : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
            )}
            title={t('debug.exportLogs')}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
          {/* 清空 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            disabled={logs.length === 0}
            className={clsx(
              'p-1 rounded-md transition-colors',
              logs.length === 0
                ? 'text-text-muted cursor-not-allowed'
                : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
            )}
            title={t('logs.clear')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {/* 展开/折叠上方面板 */}
          <span
            className={clsx(
              'p-0.5 rounded transition-colors',
              !sidePanelExpanded ? 'text-accent bg-accent-light' : 'text-text-muted',
            )}
          >
            <ChevronDown
              className={clsx(
                'w-4 h-4 transition-transform duration-150 ease-out',
                sidePanelExpanded && 'rotate-180',
              )}
            />
          </span>
        </div>
      </div>

      {/* 日志内容 */}
      <div
        ref={logsContainerRef}
        className="flex-1 min-h-0 overflow-y-auto p-2 font-mono text-xs bg-bg-tertiary"
        onContextMenu={handleContextMenu}
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted">
            {t('logs.noLogs')}
          </div>
        ) : (
          <>
            {logs.map((log) =>
              log.html ? (
                // 富文本内容（focus 消息支持 Markdown/HTML）
                <div key={log.id} className={clsx('py-0.5 flex gap-2', getLogColor(log.type))}>
                  <span className="text-text-muted flex-shrink-0">
                    [{log.timestamp.toLocaleTimeString()}]
                  </span>
                  <span
                    className="break-all focus-content"
                    dangerouslySetInnerHTML={{ __html: log.html }}
                  />
                </div>
              ) : (
                <div key={log.id} className={clsx('py-0.5 flex gap-2', getLogColor(log.type))}>
                  <span className="text-text-muted flex-shrink-0">
                    [{log.timestamp.toLocaleTimeString()}]
                  </span>
                  <span className="break-all">
                    {getLogPrefix(log.type)}
                    {log.message}
                  </span>
                </div>
              ),
            )}
          </>
        )}
      </div>

      {/* 右键菜单 */}
      {menuState.isOpen && (
        <ContextMenu items={menuState.items} position={menuState.position} onClose={hideMenu} />
      )}

      {/* 导出日志 Modal */}
      <ExportLogsModal
        show={exportModal.show}
        status={exportModal.status === 'idle' ? 'exporting' : exportModal.status}
        zipPath={exportModal.zipPath}
        error={exportModal.error}
        onClose={closeExportModal}
        onOpen={openExportedFile}
      />
    </div>
  );
}
