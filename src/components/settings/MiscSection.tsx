import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { SwitchButton } from '@/components/FormControls';

export function MiscSection() {
  const { t } = useTranslation();
  const { confirmBeforeDelete, setConfirmBeforeDelete } = useAppStore();

  return (
    <section id="section-misc" className="space-y-4 scroll-mt-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
        <SlidersHorizontal className="w-4 h-4" />
        {t('settings.misc')}
      </h2>

      <div className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">
                {t('settings.confirmBeforeDelete')}
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                {t('settings.confirmBeforeDeleteHint')}
              </p>
            </div>
          </div>
          <SwitchButton
            value={confirmBeforeDelete}
            onChange={(v) => setConfirmBeforeDelete(v)}
          />
        </div>
      </div>

    </section>
  );
}
