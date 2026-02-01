import { useTranslation } from 'react-i18next';
import { Key, Play, StopCircle, AlertCircle, Globe } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/stores/appStore';

export function HotkeySection() {
  const { t } = useTranslation();
  const { hotkeys, setHotkeys } = useAppStore();

  // 生成统一的快捷键组合字符串
  const buildCombo = (e: React.KeyboardEvent): string | null => {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let key = e.key as string;
    // 忽略纯修饰键
    if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
      return null;
    }

    if (/^f\d+$/i.test(key)) {
      key = key.toUpperCase();
    } else if (key.length === 1) {
      key = key.toUpperCase();
    }

    parts.push(key);
    return parts.join('+');
  };

  return (
    <section id="section-hotkeys" className="space-y-4 scroll-mt-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
        <Key className="w-4 h-4" />
        {t('settings.hotkeys')}
      </h2>

      <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-4">
        <p className="text-xs text-text-muted">{t('settings.hotkeysHint')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 开始任务快捷键 */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
              <Play className="w-3 h-3 text-accent" />
              <span>{t('settings.hotkeysStartTasks')}</span>
            </label>
            <input
              type="text"
              readOnly
              value={hotkeys.startTasks}
              placeholder="F10"
              onKeyDown={(e) => {
                e.preventDefault();
                const combo = buildCombo(e);
                if (!combo) return;
                setHotkeys({
                  ...hotkeys,
                  startTasks: combo,
                });
              }}
              className="w-full px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 cursor-pointer"
            />
          </div>

          {/* 结束任务快捷键 */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
              <StopCircle className="w-3 h-3 text-accent" />
              <span>{t('settings.hotkeysStopTasks')}</span>
            </label>
            <input
              type="text"
              readOnly
              value={hotkeys.stopTasks}
              placeholder="F11"
              onKeyDown={(e) => {
                e.preventDefault();
                const combo = buildCombo(e);
                if (!combo) return;
                setHotkeys({
                  ...hotkeys,
                  stopTasks: combo,
                });
              }}
              className="w-full px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 cursor-pointer"
            />
          </div>
        </div>

        {hotkeys.startTasks === hotkeys.stopTasks && (
          <div className="flex items-center gap-2 text-xs text-warning">
            <AlertCircle className="w-3 h-3" />
            <span>{t('settings.hotkeysConflict')}</span>
          </div>
        )}

        {/* 全局快捷键开关 */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('settings.hotkeysGlobal')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('settings.hotkeysGlobalHint')}</p>
            </div>
          </div>
          <button
            onClick={() => setHotkeys({ ...hotkeys, globalEnabled: !hotkeys.globalEnabled })}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
              hotkeys.globalEnabled ? 'bg-accent' : 'bg-bg-active',
            )}
          >
            <span
              className={clsx(
                'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                hotkeys.globalEnabled ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
