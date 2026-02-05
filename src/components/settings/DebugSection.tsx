import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bug,
  RefreshCw,
  Maximize2,
  FolderOpen,
  ScrollText,
  Trash2,
  Network,
  Archive,
} from 'lucide-react';

import { useAppStore } from '@/stores/appStore';
import { defaultWindowSize } from '@/types/config';
import { clearAllCache, getCacheStats } from '@/services/cacheService';
import { maaService } from '@/services/maaService';
import { loggers } from '@/utils/logger';
import { isTauri, getDebugDir, getConfigDir, openDirectory } from '@/utils/paths';
import { SwitchButton } from '@/components/FormControls';
import { ExportLogsModal } from './ExportLogsModal';

export function DebugSection() {
  const { t } = useTranslation();
  const {
    projectInterface,
    dataPath,
    devMode,
    setDevMode,
    saveDraw,
    setSaveDraw,
    tcpCompatMode,
    setTcpCompatMode,
    setRightPanelWidth,
    setRightPanelCollapsed,
  } = useAppStore();

  const [mxuVersion, setMxuVersion] = useState<string | null>(null);
  const [maafwVersion, setMaafwVersion] = useState<string | null>(null);
  const [exeDir, setExeDir] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<{
    os: string;
    osVersion: string;
    arch: string;
    tauriVersion: string;
  } | null>(null);
  const [cacheEntryCount, setCacheEntryCount] = useState<number | null>(null);
  const [exportModal, setExportModal] = useState<{
    show: boolean;
    status: 'exporting' | 'success' | 'error';
    zipPath?: string;
    error?: string;
  }>({ show: false, status: 'exporting' });
  const [, setDebugLog] = useState<string[]>([]);

  const addDebugLog = useCallback((msg: string) => {
    setDebugLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const version = projectInterface?.version || '0.1.0';

  // 版本信息（用于调试展示）
  useEffect(() => {
    const loadVersions = async () => {
      // mxu 版本
      if (isTauri()) {
        try {
          const { getVersion } = await import('@tauri-apps/api/app');
          setMxuVersion(await getVersion());
        } catch {
          setMxuVersion(__MXU_VERSION__ || null);
        }
      } else {
        setMxuVersion(__MXU_VERSION__ || null);
      }

      // maafw 版本（仅在 Tauri 环境有意义）
      if (isTauri()) {
        try {
          setMaafwVersion(await maaService.getVersion());
        } catch {
          setMaafwVersion(null);
        }
      } else {
        setMaafwVersion(null);
      }

      // 路径信息和系统信息（仅在 Tauri 环境有意义）
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const [exeDirResult, cwdResult, sysInfo] = await Promise.all([
            invoke<string>('get_exe_dir'),
            invoke<string>('get_cwd'),
            invoke<{ os: string; os_version: string; arch: string; tauri_version: string }>(
              'get_system_info',
            ),
          ]);
          setExeDir(exeDirResult);
          setCwd(cwdResult);
          setSystemInfo({
            os: sysInfo.os,
            osVersion: sysInfo.os_version,
            arch: sysInfo.arch,
            tauriVersion: sysInfo.tauri_version,
          });
        } catch {
          setExeDir(null);
          setCwd(null);
          setSystemInfo(null);
        }
      }
    };

    loadVersions();
  }, []);

  // 加载缓存统计
  useEffect(() => {
    if (isTauri()) {
      getCacheStats().then((stats) => {
        setCacheEntryCount(stats.entryCount);
      });
    }
  }, []);

  // 调试：重置窗口布局（尺寸和位置）
  const handleResetWindowLayout = async () => {
    if (!isTauri()) {
      addDebugLog('仅 Tauri 环境支持重置窗口布局');
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const currentWindow = getCurrentWindow();

      // 重置窗口尺寸
      await currentWindow.setSize(
        new LogicalSize(defaultWindowSize.width, defaultWindowSize.height),
      );

      // 居中窗口（同时清除保存的位置）
      await currentWindow.center();
      useAppStore.getState().setWindowPosition(undefined);

      // 同时也重置右侧面板尺寸和状态
      setRightPanelWidth(320);
      setRightPanelCollapsed(false);

      addDebugLog(
        `窗口布局已重置：尺寸 ${defaultWindowSize.width}x${defaultWindowSize.height}，位置居中`,
      );
    } catch (err) {
      addDebugLog(`重置窗口布局失败: ${err}`);
    }
  };

  // 调试：打开配置目录
  const handleOpenConfigDir = async () => {
    if (!isTauri() || !dataPath) {
      loggers.ui.warn('仅 Tauri 环境支持打开目录, dataPath:', dataPath);
      return;
    }

    try {
      const configPath = await getConfigDir();
      loggers.ui.info('打开配置目录:', configPath);
      await openDirectory(configPath);
    } catch (err) {
      loggers.ui.error('打开配置目录失败:', err);
    }
  };

  // 调试：打开日志目录
  const handleOpenLogDir = async () => {
    if (!isTauri() || !dataPath) {
      loggers.ui.warn('仅 Tauri 环境支持打开目录, dataPath:', dataPath);
      return;
    }

    try {
      const logPath = await getDebugDir();
      loggers.ui.info('打开日志目录:', logPath);
      await openDirectory(logPath);
    } catch (err) {
      loggers.ui.error('打开日志目录失败:', err);
    }
  };

  // 调试：清空缓存
  const handleClearCache = async () => {
    if (!isTauri() || !dataPath) {
      addDebugLog('仅 Tauri 环境支持清空缓存');
      return;
    }

    try {
      await clearAllCache();
      setCacheEntryCount(0);
      addDebugLog('缓存已清空');
    } catch (err) {
      addDebugLog(`清空缓存失败: ${err}`);
    }
  };

  // 调试：导出日志
  const handleExportLogs = async () => {
    if (!isTauri()) {
      addDebugLog('仅 Tauri 环境支持导出日志');
      return;
    }

    setExportModal({ show: true, status: 'exporting' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const zipPath = await invoke<string>('export_logs');
      loggers.ui.info('日志已导出:', zipPath);

      setExportModal({ show: true, status: 'success', zipPath });

      // 打开所在目录
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const { dirname } = await import('@tauri-apps/api/path');
      const dir = await dirname(zipPath);
      await openPath(dir);
    } catch (err) {
      loggers.ui.error('导出日志失败:', err);
      setExportModal({
        show: true,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section id="section-debug" className="space-y-4 scroll-mt-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
        <Bug className="w-4 h-4" />
        {t('debug.title')}
      </h2>

      <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-4">
        {/* 版本信息 */}
        <div className="text-sm text-text-secondary space-y-1">
          <p className="font-medium text-text-primary">{t('debug.versions')}</p>
          <p>
            {t('debug.interfaceVersion', { name: projectInterface?.name || 'interface' })}:{' '}
            <span className="font-mono text-text-primary">{version || '-'}</span>
          </p>
          <p>
            {t('debug.maafwVersion')}:{' '}
            <span className="font-mono text-text-primary">
              {maafwVersion || t('maa.notInitialized')}
            </span>
          </p>
          <p>
            {t('debug.mxuVersion')}:{' '}
            <span className="font-mono text-text-primary">{mxuVersion || '-'}</span>
          </p>
        </div>

        {/* 环境信息 */}
        <div className="text-sm text-text-secondary space-y-1">
          <p>
            {t('debug.environment')}:{' '}
            <span className="font-mono text-text-primary">
              {isTauri() ? t('debug.envTauri') : t('debug.envBrowser')}
            </span>
          </p>
        </div>

        {/* 系统信息 */}
        {systemInfo && (
          <div className="text-sm text-text-secondary space-y-1">
            <p className="font-medium text-text-primary">{t('debug.systemInfo')}</p>
            <p>
              {t('debug.operatingSystem')}:{' '}
              <span className="font-mono text-text-primary">{systemInfo.osVersion}</span>
            </p>
            <p>
              {t('debug.architecture')}:{' '}
              <span className="font-mono text-text-primary">{systemInfo.arch}</span>
            </p>
            <p>
              {t('debug.tauriVersion')}:{' '}
              <span className="font-mono text-text-primary">{systemInfo.tauriVersion}</span>
            </p>
          </div>
        )}

        {/* 路径信息（仅 Tauri 环境显示） */}
        {isTauri() && (exeDir || cwd) && (
          <div className="text-sm text-text-secondary space-y-1">
            <p className="font-medium text-text-primary">{t('debug.pathInfo')}</p>
            {cwd && (
              <p className="break-all">
                {t('debug.cwd')}: <span className="font-mono text-text-primary text-xs">{cwd}</span>
              </p>
            )}
            {exeDir && (
              <p className="break-all">
                {t('debug.exeDir')}:{' '}
                <span className="font-mono text-text-primary text-xs">{exeDir}</span>
              </p>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleResetWindowLayout}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
            {t('debug.resetWindowLayout')}
          </button>
          <button
            onClick={handleOpenConfigDir}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            {t('debug.openConfigDir')}
          </button>
          <button
            onClick={handleOpenLogDir}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
          >
            <ScrollText className="w-4 h-4" />
            {t('debug.openLogDir')}
          </button>
          <button
            onClick={handleExportLogs}
            disabled={exportModal.show && exportModal.status === 'exporting'}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors disabled:opacity-50"
            title={t('debug.exportLogsHint')}
          >
            <Archive className="w-4 h-4" />
            {t('debug.exportLogs')}
          </button>
          <button
            onClick={handleClearCache}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
            title={
              cacheEntryCount !== null
                ? t('debug.cacheStats', { count: cacheEntryCount })
                : undefined
            }
          >
            <Trash2 className="w-4 h-4" />
            {t('debug.clearCache')}
            {cacheEntryCount !== null && cacheEntryCount > 0 && (
              <span className="text-xs text-text-muted">({cacheEntryCount})</span>
            )}
          </button>
        </div>

        {/* 开发模式 */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('debug.devMode')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('debug.devModeHint')}</p>
            </div>
          </div>
          <SwitchButton value={devMode} onChange={(v) => setDevMode(v)} />
        </div>

        {/* 保存调试图像 */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Bug className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('debug.saveDraw')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('debug.saveDrawHint')}</p>
            </div>
          </div>
          <SwitchButton value={saveDraw} onChange={(v) => setSaveDraw(v)} />
        </div>

        {/* 通信兼容模式 */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Network className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('debug.tcpCompatMode')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('debug.tcpCompatModeHint')}</p>
            </div>
          </div>
          <SwitchButton value={tcpCompatMode} onChange={(v) => setTcpCompatMode(v)} />
        </div>
      </div>

      {/* 导出日志 Modal */}
      <ExportLogsModal
        show={exportModal.show}
        status={exportModal.status}
        zipPath={exportModal.zipPath}
        error={exportModal.error}
        onClose={() => setExportModal({ show: false, status: 'exporting' })}
      />
    </section>
  );
}
