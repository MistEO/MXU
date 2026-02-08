import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, ListChecks, AppWindowMac, AlertCircle, Maximize2 } from 'lucide-react';

import { useAppStore } from '@/stores/appStore';
import { defaultWindowSize } from '@/types/config';
import { isTauri } from '@/utils/paths';
import { SwitchButton } from '@/components/FormControls';
import { FrameRateSelector } from '../FrameRateSelector';

export function GeneralSection() {
  const { t } = useTranslation();
  const {
    showOptionPreview,
    setShowOptionPreview,
    confirmBeforeDelete,
    setConfirmBeforeDelete,
    minimizeToTray,
    setMinimizeToTray,
    setRightPanelWidth,
    setRightPanelCollapsed,
  } = useAppStore();

  const handleResetWindowLayout = useCallback(async () => {
    if (!isTauri()) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const currentWindow = getCurrentWindow();

      await currentWindow.setSize(
        new LogicalSize(defaultWindowSize.width, defaultWindowSize.height),
      );

      await currentWindow.center();
      useAppStore.getState().setWindowPosition(undefined);

      setRightPanelWidth(320);
      setRightPanelCollapsed(false);
    } catch {
      // ignore
    }
  }, [setRightPanelWidth, setRightPanelCollapsed]);

  return (
    <section id="section-general" className="space-y-4 scroll-mt-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
        <Settings2 className="w-4 h-4" />
        {t('settings.general')}
      </h2>

      <div className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ListChecks className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">
                {t('settings.showOptionPreview')}
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                {t('settings.showOptionPreviewHint')}
              </p>
            </div>
          </div>
          <SwitchButton value={showOptionPreview} onChange={(v) => setShowOptionPreview(v)} />
        </div>
      </div>

      <FrameRateSelector />

      <div className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AppWindowMac className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('settings.minimizeToTray')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('settings.minimizeToTrayHint')}</p>
            </div>
          </div>
          <SwitchButton value={minimizeToTray} onChange={(v) => setMinimizeToTray(v)} />
        </div>
      </div>

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
          <SwitchButton value={confirmBeforeDelete} onChange={(v) => setConfirmBeforeDelete(v)} />
        </div>
      </div>

      {isTauri() && (
        <div className="bg-bg-secondary rounded-xl p-4 border border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Maximize2 className="w-5 h-5 text-accent" />
              <div>
                <span className="font-medium text-text-primary">
                  {t('settings.resetWindowLayout')}
                </span>
                <p className="text-xs text-text-muted mt-0.5">
                  {t('settings.resetWindowLayoutHint')}
                </p>
              </div>
            </div>
            <button
              onClick={handleResetWindowLayout}
              className="px-4 py-2 text-sm font-medium bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
            >
              {t('common.reset')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
