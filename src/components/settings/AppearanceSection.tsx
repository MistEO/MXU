import { type CSSProperties, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Palette, ListChecks } from 'lucide-react';
import clsx from 'clsx';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';

import { useAppStore } from '@/stores/appStore';
import { getAccentInfoList, type AccentColor, type CustomAccent } from '@/themes';
import { FrameRateSelector } from '../FrameRateSelector';
import { SortableAccentTile } from './SortableAccentTile';

interface AppearanceSectionProps {
  onOpenCreateAccentModal: () => void;
  onOpenEditAccentModal: (accent: CustomAccent) => void;
  onDeleteAccent: (id: string) => void;
}

export function AppearanceSection({
  onOpenCreateAccentModal,
  onOpenEditAccentModal,
  onDeleteAccent,
}: AppearanceSectionProps) {
  const { t } = useTranslation();
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    customAccents,
    reorderCustomAccents,
    language,
    setLanguage,
    showOptionPreview,
    setShowOptionPreview,
  } = useAppStore();

  // 获取强调色列表（包含自定义强调色）
  const accentColors = useMemo(
    () => getAccentInfoList(language, customAccents),
    [language, customAccents],
  );

  const customAccentIds = useMemo(() => customAccents.map((a) => a.id), [customAccents]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleAccentDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = customAccentIds.indexOf(String(active.id));
      const newIndex = customAccentIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      reorderCustomAccents(oldIndex, newIndex);
    },
    [customAccentIds, reorderCustomAccents],
  );

  const handleLanguageChange = (
    lang: 'system' | 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR',
  ) => {
    setLanguage(lang);
  };

  return (
    <section id="section-appearance" className="space-y-4 scroll-mt-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
        <Palette className="w-4 h-4" />
        {t('settings.appearance')}
      </h2>

      {/* 语言 */}
      <div className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center gap-3 mb-3">
          <Globe className="w-5 h-5 text-accent" />
          <span className="font-medium text-text-primary">{t('settings.language')}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['system', 'zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => handleLanguageChange(lang)}
              className={clsx(
                'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                language === lang
                  ? 'bg-accent text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
              )}
            >
              {lang === 'system'
                ? t('settings.languageSystem')
                : lang === 'zh-CN'
                  ? '简体中文'
                  : lang === 'zh-TW'
                    ? '繁體中文'
                    : lang === 'en-US'
                      ? 'English'
                      : lang === 'ja-JP'
                        ? '日本語'
                        : '한국어'}
            </button>
          ))}
        </div>
      </div>

      {/* 主题 */}
      <div className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center gap-3 mb-3">
          <Palette className="w-5 h-5 text-accent" />
          <span className="font-medium text-text-primary">{t('settings.theme')}</span>
        </div>
        <div className="flex gap-2">
          {(['system', 'light', 'dark'] as const).map((t_) => (
            <button
              key={t_}
              onClick={() => setTheme(t_)}
              className={clsx(
                'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                theme === t_
                  ? 'bg-accent text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
              )}
            >
              {t(`settings.theme${t_.charAt(0).toUpperCase() + t_.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {/* 强调色 */}
      <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-4">
        <div className="flex items-center gap-3 mb-3">
          <Palette className="w-5 h-5 text-accent" />
          <span className="font-medium text-text-primary">{t('settings.accentColor')}</span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleAccentDragEnd}
        >
          <SortableContext items={customAccentIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-2">
              {accentColors.map((accent) => {
                const isSelected = accentColor === accent.name;
                if (accent.isCustom) {
                  const customAccent = customAccents.find((a) => a.name === accent.name);
                  if (!customAccent) return null;
                  return (
                    <SortableAccentTile
                      key={customAccent.id}
                      accent={accent}
                      customAccent={customAccent}
                      isSelected={isSelected}
                      onSelect={() => setAccentColor(accent.name as AccentColor)}
                      onEdit={() => onOpenEditAccentModal(customAccent)}
                      onDelete={() => onDeleteAccent(customAccent.id)}
                    />
                  );
                }

                return (
                  <button
                    key={accent.name}
                    onClick={() => setAccentColor(accent.name as AccentColor)}
                    className={clsx(
                      'relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-bg-tertiary border',
                      isSelected
                        ? 'ring-2 ring-offset-2 ring-offset-bg-secondary border-transparent'
                        : 'border-border hover:bg-bg-hover',
                    )}
                    style={
                      isSelected ? ({ '--tw-ring-color': accent.color } as CSSProperties) : undefined
                    }
                  >
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0 border border-border-strong"
                      style={{ backgroundColor: accent.color }}
                    />
                    <span className="truncate text-text-secondary">{accent.label}</span>
                  </button>
                );
              })}

              {/* + 新增自定义强调色 */}
              <button
                type="button"
                onClick={onOpenCreateAccentModal}
                className="flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-bg-tertiary border-2 border-dashed border-border hover:bg-bg-hover text-text-muted transition-colors"
                title={t('settings.addCustomAccent')}
              >
                <span className="text-xl">+</span>
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* 选项预览 */}
      <div className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ListChecks className="w-5 h-5 text-accent" />
            <div>
              <span className="font-medium text-text-primary">{t('settings.showOptionPreview')}</span>
              <p className="text-xs text-text-muted mt-0.5">{t('settings.showOptionPreviewHint')}</p>
            </div>
          </div>
          <button
            onClick={() => setShowOptionPreview(!showOptionPreview)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
              showOptionPreview ? 'bg-accent' : 'bg-bg-active',
            )}
          >
            <span
              className={clsx(
                'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                showOptionPreview ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      {/* 实时截图帧率 */}
      <FrameRateSelector />
    </section>
  );
}
