import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderOpen, Check } from 'lucide-react';
import { openPath } from '@tauri-apps/plugin-opener';
import { useAppStore } from '@/stores/appStore';
import { clearFallbackPendingInfo } from '@/services/updateService';
import { loggers } from '@/utils/logger';

/**
 * 兜底更新恢复提示弹窗
 *
 * 当上次自动更新失败并进入兜底（新版本整包被解压到 v<版本> 文件夹）后，
 * 下次启动检测到兜底文件夹仍存在时强制弹出，引导用户手动完成覆盖。
 * 该弹窗不可随手关闭：不渲染关闭按钮、点击遮罩无效，
 * 唯一出口为"我已手动完成"（清除标记）或用户删除兜底文件夹。
 */
export function FallbackRecoveryModal() {
  const { t } = useTranslation();

  const showFallbackRecoveryModal = useAppStore((s) => s.showFallbackRecoveryModal);
  const fallbackRecoveryInfo = useAppStore((s) => s.fallbackRecoveryInfo);
  const setShowFallbackRecoveryModal = useAppStore((s) => s.setShowFallbackRecoveryModal);

  const handleOpenFolder = useCallback(async () => {
    if (!fallbackRecoveryInfo?.fallbackDir) return;
    try {
      await openPath(fallbackRecoveryInfo.fallbackDir);
    } catch (error) {
      loggers.ui.error('打开兜底文件夹失败:', error);
    }
  }, [fallbackRecoveryInfo]);

  const handleDone = useCallback(() => {
    clearFallbackPendingInfo();
    setShowFallbackRecoveryModal(false);
  }, [setShowFallbackRecoveryModal]);

  if (!showFallbackRecoveryModal || !fallbackRecoveryInfo) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[50vw] min-w-[500px] max-h-[80vh] bg-bg-secondary rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
        {/* 标题栏（无关闭按钮，强制处理） */}
        <div className="flex items-center gap-2 px-4 py-3 bg-bg-tertiary border-b border-border shrink-0">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <span className="text-sm font-medium text-text-primary">
            {t('mirrorChyan.fallbackRecovery.title')}
          </span>
          {fallbackRecoveryInfo.newVersion && (
            <span className="font-mono text-sm text-accent font-semibold">
              {fallbackRecoveryInfo.newVersion}
            </span>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4 min-h-0 space-y-4">
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
            {t('mirrorChyan.fallbackRecovery.message')}
          </p>

          <div className="space-y-1">
            <p className="text-xs text-text-muted">{t('mirrorChyan.fallbackRecovery.pathLabel')}</p>
            <p className="font-mono text-xs text-text-secondary break-all bg-bg-tertiary rounded-lg px-3 py-2 border border-border">
              {fallbackRecoveryInfo.fallbackDir}
            </p>
          </div>

          <p className="text-xs text-warning leading-relaxed whitespace-pre-line">
            {t('mirrorChyan.fallbackRecovery.hint')}
          </p>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-bg-tertiary border-t border-border shrink-0">
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            {t('mirrorChyan.fallbackRecovery.openFolder')}
          </button>
          <button
            onClick={handleDone}
            className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover rounded-lg transition-colors"
          >
            <Check className="w-4 h-4" />
            {t('mirrorChyan.fallbackRecovery.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
