import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCacheDir, joinPath } from '@/utils/paths';
import { loggers } from '@/utils/logger';

const log = loggers.app;

// 根据架构获取 VC++ 运行库下载地址和文件名
function getVCRedistInfo(architecture: string): { url: string; filename: string } {
  switch (architecture) {
    case 'x86':
      return {
        url: 'https://aka.ms/vs/17/release/vc_redist.x86.exe',
        filename: 'vc_redist.x86.exe',
      };
    case 'aarch64':
      return {
        url: 'https://aka.ms/vs/17/release/vc_redist.arm64.exe',
        filename: 'vc_redist.arm64.exe',
      };
    case 'x86_64':
    default:
      return {
        url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
        filename: 'vc_redist.x64.exe',
      };
  }
}

interface DownloadProgress {
  downloaded_size: number;
  total_size: number;
  speed: number;
  progress: number;
  session_id: number;
}

type Status = 'downloading' | 'download_failed' | 'installing' | 'retrying' | 'success' | 'failed';

interface VCRedistModalProps {
  show: boolean;
  onClose: () => void;
}

export function VCRedistModal({ show, onClose }: VCRedistModalProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('downloading');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentSessionId = useRef<number | null>(null);
  const hasStarted = useRef(false);

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // 格式化速度
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  };

  // 自动执行流程
  const runAutoProcess = useCallback(async () => {
    try {
      // 1. 下载
      setStatus('downloading');
      setDownloadProgress(null);
      setError(null);

      // 获取系统架构并选择对应的下载地址
      const architecture = await invoke<string>('get_arch');
      const { url: vcredistUrl, filename: vcredistFilename } = getVCRedistInfo(architecture);
      log.info(`系统架构: ${architecture}, 下载: ${vcredistFilename}`);

      const cacheDir = await getCacheDir();
      const downloadPath = joinPath(cacheDir, vcredistFilename);

      log.info(`开始下载 VC++ 运行库: ${vcredistUrl} -> ${downloadPath}`);

      const sessionId = await invoke<number>('download_file', {
        url: vcredistUrl,
        savePath: downloadPath,
        totalSize: null,
      });

      currentSessionId.current = sessionId;
      log.info('VC++ 运行库下载完成');

      // 2. 运行安装程序并等待
      setStatus('installing');
      log.info(`运行安装程序: ${downloadPath}`);

      const exitCode = await invoke<number>('run_and_wait', { filePath: downloadPath });
      log.info(`安装程序退出，退出码: ${exitCode}`);

      // 3. 重试加载 DLL
      setStatus('retrying');
      log.info('尝试重新加载 MaaFramework...');

      try {
        const version = await invoke<string>('retry_load_maa_library');
        log.info(`MaaFramework 加载成功，版本: ${version}`);
        setStatus('success');
      } catch (retryErr) {
        log.warn('重新加载 MaaFramework 失败:', retryErr);
        setStatus('failed');
        setError(t('vcredist.stillFailed', '安装完成，但加载仍然失败。请重启电脑后再试。'));
      }
    } catch (err) {
      log.error('VC++ 运行库安装流程失败:', err);
      setStatus('download_failed');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  // 监听下载进度
  useEffect(() => {
    if (!show) return;

    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await listen<DownloadProgress>('download-progress', (event) => {
        if (
          currentSessionId.current !== null &&
          event.payload.session_id !== currentSessionId.current
        ) {
          return;
        }
        if (currentSessionId.current === null && status === 'downloading') {
          currentSessionId.current = event.payload.session_id;
        }
        setDownloadProgress(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [show, status]);

  // 弹窗显示时自动开始流程
  useEffect(() => {
    if (show && !hasStarted.current) {
      hasStarted.current = true;
      runAutoProcess();
    }
  }, [show, runAutoProcess]);

  // 重置状态当关闭时
  useEffect(() => {
    if (!show) {
      hasStarted.current = false;
      currentSessionId.current = null;
    }
  }, [show]);

  if (!show) return null;

  const isProcessing = status === 'downloading' || status === 'installing' || status === 'retrying';
  const canClose = !isProcessing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={canClose ? onClose : undefined}
    >
      <div
        className="w-full max-w-md mx-4 bg-bg-secondary rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <span className="text-sm font-medium text-text-primary">
              {t('vcredist.title', '缺少运行库')}
            </span>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          )}
        </div>

        {/* 内容区 */}
        <div className="p-4 space-y-4">
          {/* 说明文字 */}
          <div className="text-sm text-text-secondary">
            <p>
              {t(
                'vcredist.description',
                'MaaFramework 需要 Microsoft Visual C++ 运行库才能正常工作。',
              )}
            </p>
          </div>

          {/* 下载中 */}
          {status === 'downloading' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <span>{t('vcredist.downloading', '正在下载运行库...')}</span>
              </div>
              {downloadProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>
                      {formatSize(downloadProgress.downloaded_size)} /{' '}
                      {formatSize(downloadProgress.total_size)}
                    </span>
                    <span>{formatSpeed(downloadProgress.speed)}</span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${downloadProgress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 下载失败 */}
          {status === 'download_failed' && error && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-error/10 text-error rounded-lg">
                <XCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm">{t('vcredist.downloadFailed', '下载失败')}</span>
              </div>
              <p className="text-xs text-text-muted">{error}</p>
            </div>
          )}

          {/* 等待安装 */}
          {status === 'installing' && (
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>
                {t('vcredist.waitingInstall', '正在等待安装完成，请在弹出的安装程序中完成安装...')}
              </span>
            </div>
          )}

          {/* 重试加载 */}
          {status === 'retrying' && (
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>{t('vcredist.retrying', '正在重新加载...')}</span>
            </div>
          )}

          {/* 成功 */}
          {status === 'success' && (
            <div className="flex items-center gap-2 p-3 bg-success/10 text-success rounded-lg">
              <CheckCircle className="w-5 h-5" />
              <span className="text-sm">{t('vcredist.success', '运行库安装成功！')}</span>
            </div>
          )}

          {/* 最终失败 */}
          {status === 'failed' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-warning/10 text-warning rounded-lg">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
              <p className="text-xs text-text-muted">
                {t('vcredist.restartHint', '如果问题仍然存在，请重启电脑后再试。')}
              </p>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-bg-tertiary border-t border-border">
          {/* 下载失败 - 重试按钮 */}
          {status === 'download_failed' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover rounded-lg transition-colors"
              >
                {t('common.close', '关闭')}
              </button>
              <button
                onClick={() => {
                  hasStarted.current = false;
                  runAutoProcess();
                }}
                className="px-4 py-2 text-sm bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors"
              >
                {t('vcredist.retry', '重试')}
              </button>
            </>
          )}

          {/* 成功或最终失败 - 关闭按钮 */}
          {(status === 'success' || status === 'failed') && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors"
            >
              {t('common.confirm', '确定')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
