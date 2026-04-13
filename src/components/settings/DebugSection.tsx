import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bug,
  RefreshCw,
  FolderOpen,
  ScrollText,
  Network,
  Archive,
  Globe,
  ExternalLink,
  Server,
} from 'lucide-react';

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
    retainTodayLogsAfterRestart,
    setRetainTodayLogsAfterRestart,
    tcpCompatMode,
    setTcpCompatMode,
    allowLanAccess,
    setAllowLanAccess,
    webServerPort: configuredPort,
    setWebServerPort: setConfiguredPort,
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
  const [webServerPort, setWebServerPort] = useState<number>(0);
  const [lanIp, setLanIp] = useState<string | null>(null);
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);
  const [portInput, setPortInput] = useState(String(configuredPort));

  useEffect(() => {
    setPortInput(String(configuredPort));
  }, [configuredPort]);
  const { exportModal, handleExportLogs, closeExportModal, openExportedFile } = useExportLogs();

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

      // maafw 版本（Tauri 直接调用，浏览器走 HTTP API）
      try {
        setMaafwVersion(await maaService.getVersion());
      } catch {
        setMaafwVersion(null);
      }

      // 路径信息和系统信息（仅在 Tauri 环境有意义）
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const [exeDirResult, cwdResult, sysInfo, webview2DirResult, port, localIp] =
            await Promise.all([
              invoke<string>('get_exe_dir'),
              invoke<string>('get_cwd'),
              invoke<{ os: string; os_version: string; arch: string; tauri_version: string }>(
                'get_system_info',
              ),
              invoke<{ path: string; system: boolean }>('get_webview2_dir'),
              invoke<number>('get_web_server_port'),
              invoke<string | null>('get_local_lan_ip'),
            ]);
          setExeDir(exeDirResult);
          setCwd(cwdResult);
          setWebview2Dir(webview2DirResult);
          setWebServerPort(port);
          setLanIp(localIp);
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
      } else {
        // 浏览器环境：从当前 URL 推导端口
        const port = parseInt(window.location.port, 10);
        if (port) setWebServerPort(port);
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

  const webServerAddress = (() => {
    if (!webServerPort) return null;
    if (allowLanAccess) {
      const host = isTauri() ? lanIp || 'localhost' : window.location.hostname;
      return `http://${host}:${webServerPort}`;
    }
    return `http://localhost:${webServerPort}`;
  })();

  const handleOpenWebServer = useCallback(async () => {
    if (!webServerAddress) return;
    if (isTauri()) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(webServerAddress);
    } else {
      window.open(webServerAddress, '_blank');
    }
  }, [webServerAddress]);

  const handleLanAccessToggle = useCallback(
    (v: boolean) => {
      setAllowLanAccess(v);
      if (isTauri()) {
        setShowRestartPrompt(true);
      }
    },
    [setAllowLanAccess],
  );

  const handlePortBlur = useCallback(() => {
    const parsed = parseInt(portInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      setPortInput(String(configuredPort));
      return;
    }
    if (parsed !== configuredPort) {
      setConfiguredPort(parsed);
      if (isTauri()) {
        setShowRestartPrompt(true);
      }
    }
  }, [portInput, configuredPort, setConfiguredPort]);

  const handleRestart = useCallback(async () => {
    try {
      const { restartApp } = await import('@/services/updateService');
      await restartApp();
    } catch (err) {
      loggers.ui.error('重启失败:', err);
    }
  }, []);

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
          {webServerAddress && (
            <p>
              {t('debug.webServerAddress')}:{' '}
              <button
                onClick={handleOpenWebServer}
                className="inline-flex items-center gap-1 font-mono text-accent hover:text-accent/80 hover:underline transition-colors"
              >
                {webServerAddress}
                <ExternalLink className="w-3 h-3" />
              </button>
            </p>
          )}
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

        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <ScrollText className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">
                {t('debug.retainTodayLogsAfterRestart')}
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                {t('debug.retainTodayLogsAfterRestartHint')}
              </p>
            </div>
          </div>
          <SwitchButton
            value={retainTodayLogsAfterRestart}
            onChange={(v) => setRetainTodayLogsAfterRestart(v)}
          />
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

        {/* Web 服务器端口 */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('debug.webServerPort')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('debug.webServerPortHint')}</p>
            </div>
          </div>
          <input
            type="number"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onBlur={handlePortBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="w-24 px-2.5 py-1.5 text-sm font-mono text-right bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* 允许局域网访问 */}
        <div className="pt-4 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-accent" />
              <div>
                <span className="font-medium text-text-primary">{t('debug.allowLanAccess')}</span>
                <p className="text-xs text-text-muted mt-0.5">{t('debug.allowLanAccessHint')}</p>
              </div>
            </div>
            <SwitchButton value={allowLanAccess} onChange={handleLanAccessToggle} />
          </div>

          {/* 重启提示 */}
          {showRestartPrompt && (
            <div className="flex items-center justify-between ml-8 p-2.5 bg-bg-tertiary rounded-lg text-sm">
              <span className="text-text-secondary">{t('debug.webServerRestartMessage')}</span>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <button
                  onClick={() => setShowRestartPrompt(false)}
                  className="px-3 py-1 text-text-muted hover:text-text-primary rounded transition-colors"
                >
                  {t('debug.restartLater')}
                </button>
                <button
                  onClick={handleRestart}
                  className="px-3 py-1 bg-accent text-white rounded hover:bg-accent/90 transition-colors"
                >
                  {t('debug.restartNow')}
                </button>
              </div>
            </div>
          )}
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
