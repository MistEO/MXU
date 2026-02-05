import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle, XCircle, Archive } from 'lucide-react';

type ExportStatus = 'exporting' | 'success' | 'error';

interface ExportLogsModalProps {
  show: boolean;
  status: ExportStatus;
  zipPath?: string;
  error?: string;
  onClose: () => void;
}

export function ExportLogsModal({ show, status, zipPath, error, onClose }: ExportLogsModalProps) {
  const { t } = useTranslation();

  if (!show) return null;

  const canClose = status !== 'exporting';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={canClose ? onClose : undefined}
    >
      <div
        className="w-full max-w-sm mx-4 bg-bg-secondary rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-accent" />
            <span className="text-sm font-medium text-text-primary">{t('debug.exportLogs')}</span>
          </div>
        </div>

        {/* 内容区 */}
        <div className="p-4 space-y-4">
          {status === 'exporting' && (
            <div className="flex items-center gap-3 text-sm text-text-primary">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span>{t('debug.exportingLogs')}</span>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-success/10 text-success rounded-lg">
                <CheckCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm">{t('debug.logsExported')}</span>
              </div>
              {zipPath && <p className="text-xs text-text-muted break-all">{zipPath}</p>}
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-error/10 text-error rounded-lg">
                <XCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm">{t('debug.exportLogsFailed')}</span>
              </div>
              {error && <p className="text-xs text-text-muted break-all">{error}</p>}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        {canClose && (
          <div className="flex items-center justify-end px-4 py-3 bg-bg-tertiary border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors"
            >
              {t('common.confirm')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
