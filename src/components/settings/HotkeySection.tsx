import { useTranslation } from 'react-i18next';
import { Key, Play, StopCircle, AlertCircle } from 'lucide-react';
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
      </div>
    </section>
  );
}
