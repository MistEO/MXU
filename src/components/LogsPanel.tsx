import { useRef, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, ChevronUp, ChevronDown, Archive, MonitorUp, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore, type LogType } from '@/stores/appStore';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import { isTauri } from '@/utils/paths';
import { useExportLogs } from '@/utils/useExportLogs';
import { ExportLogsModal } from './settings/ExportLogsModal';
import type { Win32Window } from '@/types/maa';

export function LogsPanel() {
  const { t } = useTranslation();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const {
    sidePanelExpanded, toggleSidePanelExpanded, activeInstanceId, instanceLogs, clearLogs,
    logOverlayEnabled, setLogOverlayEnabled,
    logOverlayMode, selectedController: selectedControllerMap, projectInterface,
  } = useAppStore();

  // ADB 跟随窗口选择器
  const [followWindows, setFollowWindows] = useState<Win32Window[]>([]);
  const [followWindowHandle, setFollowWindowHandle] = useState<number | null>(null);
  const [followWindowLoading, setFollowWindowLoading] = useState(false);

  const activeControllerName = activeInstanceId ? selectedControllerMap[activeInstanceId] : undefined;
  const activeControllerDef = projectInterface?.controller.find((c) => c.name === activeControllerName);
  const isAdbController = activeControllerDef?.type === 'Adb' || activeControllerDef?.type === 'PlayCover';
  const showWindowPicker = logOverlayEnabled && logOverlayMode === 'follow' && isAdbController;

  // 切换实例时重置选中的窗口句柄
  useEffect(() => {
    setFollowWindowHandle(null);
  }, [activeInstanceId]);

  const refreshFollowWindows = useCallback(async () => {
    if (!isTauri()) return;
    setFollowWindowLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const windows = await invoke<Win32Window[]>('maa_find_win32_windows', {
        classRegex: '',
        windowRegex: '',
      });
      setFollowWindows(windows.filter((w) => w.window_name.trim().length > 0));
    } catch {
      // ignore
    } finally {
      setFollowWindowLoading(false);
    }
  }, []);

  const selectFollowWindow = useCallback(async (handle: number | null) => {
    if (!isTauri() || !activeInstanceId) return;
    setFollowWindowHandle(handle);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_connected_window_handle', {
        instanceId: activeInstanceId,
        handle,
      });
      import('@/services/logOverlayService').then(({ onOverlaySettingsChanged }) =>
        onOverlaySettingsChanged(),
      );
    } catch {
      // ignore
    }
  }, [activeInstanceId]);
  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();
  const { exportModal, handleExportLogs, closeExportModal, openExportedFile } = useExportLogs();

  // 获取当前实例的日志
  const logs = activeInstanceId ? instanceLogs[activeInstanceId] || [] : [];

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
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
    <div className="flex-1 flex flex-col bg-bg-secondary rounded-lg border border-border overflow-hidden">
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
        className="flex items-center justify-between px-3 py-2 border-b border-border hover:bg-bg-hover transition-colors cursor-pointer"
      >
        <span className="text-sm font-medium text-text-primary">{t('logs.title')}</span>
        <div className="flex items-center gap-2">
          {/* 日志悬浮窗开关 */}
          {isTauri() && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const newEnabled = !logOverlayEnabled;
                setLogOverlayEnabled(newEnabled);
                import('@/services/logOverlayService').then(({ showLogOverlay, hideLogOverlay }) => {
                  if (newEnabled) {
                    showLogOverlay();
                  } else {
                    hideLogOverlay();
                  }
                });
              }}
              className={clsx(
                'p-1 rounded-md transition-colors',
                logOverlayEnabled
                  ? 'text-accent bg-accent/10'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
              )}
              title={t('settings.logOverlay')}
            >
              <MonitorUp className="w-3.5 h-3.5" />
            </button>
          )}
          {/* ADB 模式下选择跟随窗口 */}
          {showWindowPicker && (
            <>
              <select
                value={followWindowHandle ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  const val = e.target.value;
                  selectFollowWindow(val ? Number(val) : null);
                }}
                onFocus={() => {
                  if (followWindows.length === 0) refreshFollowWindows();
                }}
                className="px-1.5 py-0.5 text-xs bg-bg-tertiary border border-border rounded text-text-primary max-w-[140px] truncate"
                title={t('settings.logOverlayFollowWindow')}
              >
                <option value="">{t('settings.logOverlayFollowWindowNone')}</option>
                {followWindows.map((w) => (
                  <option key={w.handle} value={w.handle}>
                    {w.window_name}
                  </option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  refreshFollowWindows();
                }}
                disabled={followWindowLoading}
                className="p-1 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
                title={t('settings.logOverlayRefreshWindows')}
              >
                <RefreshCw className={`w-3 h-3 ${followWindowLoading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
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
        className="flex-1 overflow-y-auto p-2 font-mono text-xs bg-bg-tertiary"
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
            <div ref={logsEndRef} />
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
