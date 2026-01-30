import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, X, AlertCircle } from 'lucide-react';

import type { CustomAccent } from '@/themes';
import { ColorPickerPopover } from '../ColorPickerPopover';
import { HexColorTextInput } from '../HexColorTextInput';

interface CustomAccentModalProps {
  isOpen: boolean;
  editingAccent: CustomAccent | null;
  onClose: () => void;
  onSave: (accent: CustomAccent) => void;
}

export function CustomAccentModal({
  isOpen,
  editingAccent,
  onClose,
  onSave,
}: CustomAccentModalProps) {
  const { t, i18n } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [accentName, setAccentName] = useState('');
  const [isAutoAccentName, setIsAutoAccentName] = useState(false);
  const [accentMainColor, setAccentMainColor] = useState('#5D4E6D');
  const [accentHoverColor, setAccentHoverColor] = useState('#534361');
  const [accentLightColor, setAccentLightColor] = useState('#746B7D');
  const [accentLightDarkColor, setAccentLightDarkColor] = useState('#413647');
  const [nameError, setNameError] = useState<string | null>(null);

  const buildAutoAccentName = useCallback(
    (hex: string) => t('settings.autoAccentName', { hex: hex.toUpperCase() }),
    [t],
  );

  // 将十六进制颜色稍微变亮/变暗的辅助函数
  const adjustColor = useCallback((hex: string, factor: number): string => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return hex;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
    const nr = adjust(r);
    const ng = adjust(g);
    const nb = adjust(b);
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
  }, []);

  // 主色变更时自动生成其他颜色
  const handleMainColorChange = useCallback(
    (value: string) => {
      setAccentMainColor(value);
      setAccentHoverColor(adjustColor(value, 0.9));
      setAccentLightColor(adjustColor(value, 1.2));
      setAccentLightDarkColor(adjustColor(value, 0.7));

      if (!editingAccent && (isAutoAccentName || accentName.trim() === '')) {
        setAccentName(buildAutoAccentName(value));
        setIsAutoAccentName(true);
      }
    },
    [adjustColor, editingAccent, isAutoAccentName, accentName, buildAutoAccentName],
  );

  // 初始化表单
  useEffect(() => {
    if (!isOpen) return;

    if (editingAccent) {
      const langKey = i18n.language as keyof CustomAccent['label'];
      const resolvedName =
        editingAccent.label?.[langKey] || editingAccent.label['en-US'] || editingAccent.name;
      setAccentName(resolvedName);
      setIsAutoAccentName(false);
      setAccentMainColor(editingAccent.colors.default);
      setAccentHoverColor(editingAccent.colors.hover);
      setAccentLightColor(editingAccent.colors.light);
      setAccentLightDarkColor(editingAccent.colors.lightDark);
    } else {
      setAccentName(buildAutoAccentName('#5D4E6D'));
      setIsAutoAccentName(true);
      setAccentMainColor('#5D4E6D');
      setAccentHoverColor('#534361');
      setAccentLightColor('#746B7D');
      setAccentLightDarkColor('#413647');
    }
    setNameError(null);

    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [isOpen, editingAccent, buildAutoAccentName, i18n.language]);

  // Esc 关闭 + 基础 focus trap
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = modalRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleSave = useCallback(() => {
    const trimmedName = accentName.trim();
    if (!trimmedName) {
      setNameError(t('settings.customAccentNameRequired'));
      return;
    }

    const accentId = editingAccent?.id ?? crypto.randomUUID();
    const accentInternalName = editingAccent?.name ?? `custom-${accentId}`;
    const newAccent: CustomAccent = {
      id: accentId,
      name: accentInternalName,
      label: {
        'zh-CN': trimmedName,
        'zh-TW': trimmedName,
        'en-US': trimmedName,
        'ja-JP': trimmedName,
        'ko-KR': trimmedName,
      },
      colors: {
        default: accentMainColor,
        hover: accentHoverColor,
        light: accentLightColor,
        lightDark: accentLightDarkColor,
      },
    };

    onSave(newAccent);
    onClose();
  }, [
    accentName,
    accentMainColor,
    accentHoverColor,
    accentLightColor,
    accentLightDarkColor,
    editingAccent,
    onSave,
    onClose,
    t,
  ]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={editingAccent ? t('settings.editCustomAccent') : t('settings.addCustomAccent')}
        className="w-full max-w-lg max-h-[85vh] bg-bg-secondary rounded-xl border border-border shadow-2xl overflow-hidden flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">
              {editingAccent ? t('settings.editCustomAccent') : t('settings.addCustomAccent')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
          {/* 名称输入 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-primary">
              {t('settings.accentName')}
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={accentName}
              onChange={(e) => {
                setAccentName(e.target.value);
                setIsAutoAccentName(false);
                setNameError(null);
              }}
              placeholder={t('settings.accentNamePlaceholder')}
              className="w-full px-4 py-2.5 rounded-lg bg-bg-tertiary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
            />
            {nameError && (
              <p className="text-xs text-error mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {nameError}
              </p>
            )}
          </div>

          {/* 颜色选择器 */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-text-primary">
              {t('settings.accentColorConfig')}
            </label>
            <div className="grid grid-cols-2 gap-4">
              {/* 主色 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-secondary">
                  {t('settings.accentMainColor')}
                </label>
                <div className="flex items-center gap-2">
                  <ColorPickerPopover
                    value={accentMainColor}
                    onChange={(c) => handleMainColorChange(c)}
                    label={t('settings.accentMainColor')}
                  />
                  <HexColorTextInput
                    value={accentMainColor}
                    onCommit={(normalized) => handleMainColorChange(normalized)}
                    className="flex-1 px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
                    placeholder="#4F46E5"
                  />
                </div>
              </div>

              {/* 悬停色 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-secondary">
                  {t('settings.accentHoverColor')}
                </label>
                <div className="flex items-center gap-2">
                  <ColorPickerPopover
                    value={accentHoverColor}
                    onChange={(c) => setAccentHoverColor(c)}
                    label={t('settings.accentHoverColor')}
                  />
                  <HexColorTextInput
                    value={accentHoverColor}
                    onCommit={(normalized) => setAccentHoverColor(normalized)}
                    className="flex-1 px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
                    placeholder="#4F46E5"
                  />
                </div>
              </div>

              {/* 浅色背景 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-secondary">
                  {t('settings.accentLightColor')}
                </label>
                <div className="flex items-center gap-2">
                  <ColorPickerPopover
                    value={accentLightColor}
                    onChange={(c) => setAccentLightColor(c)}
                    label={t('settings.accentLightColor')}
                  />
                  <HexColorTextInput
                    value={accentLightColor}
                    onCommit={(normalized) => setAccentLightColor(normalized)}
                    className="flex-1 px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
                    placeholder="#4F46E5"
                  />
                </div>
              </div>

              {/* 深色背景 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-secondary">
                  {t('settings.accentLightDarkColor')}
                </label>
                <div className="flex items-center gap-2">
                  <ColorPickerPopover
                    value={accentLightDarkColor}
                    onChange={(c) => setAccentLightDarkColor(c)}
                    label={t('settings.accentLightDarkColor')}
                  />
                  <HexColorTextInput
                    value={accentLightDarkColor}
                    onCommit={(normalized) => setAccentLightDarkColor(normalized)}
                    className="flex-1 px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
                    placeholder="#4F46E5"
                  />
                </div>
              </div>
            </div>

            {/* 颜色预览 */}
            <div className="pt-4 border-t border-border">
              <label className="block text-xs font-medium text-text-secondary mb-3">
                {t('settings.accentPreview')}
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 shadow-sm"
                  style={{
                    backgroundColor: accentMainColor,
                    color: '#ffffff',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = accentHoverColor;
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = accentMainColor;
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  {t('settings.accentPreviewMainButton')}
                </button>
                <div
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-border/50"
                  style={{
                    backgroundColor: accentLightColor,
                    color: '#000000',
                  }}
                >
                  {t('settings.accentPreviewLightBg')}
                </div>
                <div
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-border/50"
                  style={{
                    backgroundColor: accentLightDarkColor,
                    color: '#ffffff',
                  }}
                >
                  {t('settings.accentPreviewDarkBg')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-bg-tertiary/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-bg-tertiary hover:bg-bg-hover text-text-secondary transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors shadow-sm"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
