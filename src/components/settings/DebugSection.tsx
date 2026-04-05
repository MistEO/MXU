import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, RefreshCw, FolderOpen, ScrollText, Network, Archive, Download, Upload } from 'lucide-react';

import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { loggers } from '@/utils/logger';
import { isTauri, getDebugDir, getConfigDir, openDirectory } from '@/utils/paths';
import { useExportLogs } from '@/utils/useExportLogs';
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
  } = useAppStore();

  const [mxuVersion, setMxuVersion] = useState<string | null>(null);
  const [maafwVersion, setMaafwVersion] = useState<string | null>(null);
  const [exeDir, setExeDir] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [webview2Dir, setWebview2Dir] = useState<{ path: string; system: boolean } | null>(null);
  const [systemInfo, setSystemInfo] = useState<{
    os: string;
    osVersion: string;
    arch: string;
    tauriVersion: string;
  } | null>(null);
  const { exportModal, handleExportLogs, closeExportModal, openExportedFile } = useExportLogs();
  const [isBackingUpConfig, setIsBackingUpConfig] = useState(false);
  const [isRestoringConfig, setIsRestoringConfig] = useState(false);

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
          const [exeDirResult, cwdResult, sysInfo, webview2DirResult] = await Promise.all([
            invoke<string>('get_exe_dir'),
            invoke<string>('get_cwd'),
            invoke<{ os: string; os_version: string; arch: string; tauri_version: string }>(
              'get_system_info',
            ),
            invoke<{ path: string; system: boolean }>('get_webview2_dir'),
          ]);
          setExeDir(exeDirResult);
          setCwd(cwdResult);
          setWebview2Dir(webview2DirResult);
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

  // 调试：备份个人配置（config 目录）
  const handleBackupConfig = async () => {
    if (!isTauri()) {
      loggers.ui.warn('仅 Tauri 环境支持备份配置');
      return;
    }

    setIsBackingUpConfig(true);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const defaultName = `mxu-config-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (!savePath) return;

      const { invoke } = await import('@tauri-apps/api/core');
      const backupPath = await invoke<string>('backup_personal_config', { savePath });
      loggers.ui.info('个人配置备份成功:', backupPath);

      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(backupPath);
    } catch (err) {
      loggers.ui.error('个人配置备份失败:', err);
    } finally {
      setIsBackingUpConfig(false);
    }
  };

  // 调试：恢复个人配置（config 目录）
  const handleRestoreConfig = async () => {
    if (!isTauri()) {
      loggers.ui.warn('仅 Tauri 环境支持恢复配置');
      return;
    }

    setIsRestoringConfig(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (!filePath || Array.isArray(filePath)) return;

      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restore_personal_config', { backupPath: filePath });
      loggers.ui.info('个人配置恢复成功，请重启 MXU 使配置生效');
    } catch (err) {
      loggers.ui.error('个人配置恢复失败:', err);
    } finally {
      setIsRestoringConfig(false);
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
            <p className="break-all">
              {t('debug.webview2Dir')}:{' '}
              <span className="font-mono text-text-primary text-xs">
                {webview2Dir
                  ? webview2Dir.system
                    ? `(${t('debug.webview2System')})`
                    : webview2Dir.path
                  : '-'}
              </span>
            </p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2">
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
            onClick={handleBackupConfig}
            disabled={isBackingUpConfig || isRestoringConfig}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors disabled:opacity-50"
            title={t('debug.backupConfigHint')}
          >
            <Download className="w-4 h-4" />
            {isBackingUpConfig ? t('debug.backingUpConfig') : t('debug.backupConfig')}
          </button>
          <button
            onClick={handleRestoreConfig}
            disabled={isBackingUpConfig || isRestoringConfig}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors disabled:opacity-50"
            title={t('debug.restoreConfigHint')}
          >
            <Upload className="w-4 h-4" />
            {isRestoringConfig ? t('debug.restoringConfig') : t('debug.restoreConfig')}
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
        status={exportModal.status === 'idle' ? 'exporting' : exportModal.status}
        zipPath={exportModal.zipPath}
        error={exportModal.error}
        onClose={closeExportModal}
        onOpen={openExportedFile}
      />
    </section>
  );
}
