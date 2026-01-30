import { useTranslation } from 'react-i18next';
import { ShieldAlert, Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface PermissionModalProps {
  isOpen: boolean;
  isRestarting: boolean;
  onCancel: () => void;
  onRestart: () => void;
}

export function PermissionModal({
  isOpen,
  isRestarting,
  onCancel,
  onRestart,
}: PermissionModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-primary rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-bg-secondary">
          <ShieldAlert className="w-5 h-5 text-warning" />
          <h3 className="font-medium text-text-primary">{t('permission.title')}</h3>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4">
          <p className="text-text-secondary text-sm leading-relaxed">{t('permission.message')}</p>
          <p className="text-text-muted text-xs mt-3">{t('permission.hint')}</p>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-bg-secondary">
          <button
            onClick={onCancel}
            disabled={isRestarting}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onRestart}
            disabled={isRestarting}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              isRestarting
                ? 'bg-accent/70 text-white cursor-wait'
                : 'bg-accent hover:bg-accent-hover text-white',
            )}
          >
            {isRestarting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('permission.restarting')}</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4" />
                <span>{t('permission.restart')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
