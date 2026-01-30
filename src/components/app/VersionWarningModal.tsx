import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

interface VersionWarningModalProps {
  current: string;
  minimum: string;
  onClose: () => void;
}

export function VersionWarningModal({ current, minimum, onClose }: VersionWarningModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        role="button"
        tabIndex={0}
        aria-label="Close"
      />
      <div className="relative bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <AlertCircle className="w-6 h-6 text-amber-500" />
          <h2 className="text-lg font-semibold text-text-primary">{t('versionWarning.title')}</h2>
        </div>
        <div className="px-6 py-5 space-y-3">
          <p className="text-text-secondary">
            {t('versionWarning.message', {
              current,
              minimum,
            })}
          </p>
          <p className="text-text-secondary text-sm">{t('versionWarning.suggestion')}</p>
        </div>
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
          >
            {t('versionWarning.understand')}
          </button>
        </div>
      </div>
    </div>
  );
}
