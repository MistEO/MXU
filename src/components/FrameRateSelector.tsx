import { useState, useEffect, useRef, useId, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/stores/appStore';
import type { ScreenshotFrameRate } from '@/types/config';

interface FrameRateSelectorProps {
  /** 紧凑模式：用于中控台底部工具栏 */
  compact?: boolean;
  /** 额外的 className */
  className?: string;
}

// 帧率选项配置
const FRAME_RATE_OPTIONS: { value: ScreenshotFrameRate; labelKey: string }[] = [
  { value: 'unlimited', labelKey: 'screenshot.frameRate.unlimited' },
  { value: '5', labelKey: 'screenshot.frameRate.fps5' },
  { value: '1', labelKey: 'screenshot.frameRate.fps1' },
  { value: '0.2', labelKey: 'screenshot.frameRate.every5s' },
  { value: '0.033', labelKey: 'screenshot.frameRate.every30s' },
];

/** 根据帧率设置计算帧间隔（毫秒） */
export function getFrameInterval(frameRate: ScreenshotFrameRate): number {
  switch (frameRate) {
    case 'unlimited':
      return 0; // 尽可能快
    case '5':
      return 200; // 每秒 5 帧
    case '1':
      return 1000; // 每秒 1 帧
    case '0.2':
      return 5000; // 5 秒一帧
    case '0.033':
      return 30000; // 30 秒一帧
    default:
      return 200;
  }
}

export function FrameRateSelector({ compact = false, className }: FrameRateSelectorProps) {
  const { t } = useTranslation();
  const { screenshotFrameRate, setScreenshotFrameRate } = useAppStore();

  if (compact) {
    // 紧凑模式：仅下拉框，用于中控台
    return (
      <div className={clsx('flex items-center gap-2', className)}>
        <Camera className="w-4 h-4 text-text-secondary" />
        <select
          value={screenshotFrameRate}
          onChange={(e) => setScreenshotFrameRate(e.target.value as ScreenshotFrameRate)}
          className="px-2 py-1 text-sm bg-bg-tertiary border border-border rounded-md text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          {FRAME_RATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // 完整模式：带标题和图标，用于设置页面
  return (
    <div className={clsx('bg-bg-secondary rounded-xl p-4 border border-border', className)}>
      <div className="flex items-center gap-3 mb-3">
        <Camera className="w-5 h-5 text-accent" />
        <div>
          <span className="font-medium text-text-primary">{t('screenshot.frameRate.title')}</span>
          <p className="text-xs text-text-muted mt-0.5">{t('screenshot.frameRate.hint')}</p>
        </div>
      </div>

      {/* 自定义美化下拉菜单 */}
      <FrameRateDropdown
        value={screenshotFrameRate}
        onChange={(next) => setScreenshotFrameRate(next)}
      />
    </div>
  );
}

interface FrameRateDropdownProps {
  value: ScreenshotFrameRate;
  onChange: (value: ScreenshotFrameRate) => void;
}

function FrameRateDropdown({ value, onChange }: FrameRateDropdownProps) {
  const { t } = useTranslation();
  const triggerId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      FRAME_RATE_OPTIONS.findIndex((option) => option.value === value),
    ),
  );

  const selectedOption =
    FRAME_RATE_OPTIONS.find((option) => option.value === value) ?? FRAME_RATE_OPTIONS[0];

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        // 关闭时将焦点返回到触发按钮
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // 打开时初始化活动项并将焦点移动到列表
  useEffect(() => {
    if (open) {
      const index = Math.max(
        0,
        FRAME_RATE_OPTIONS.findIndex((option) => option.value === value),
      );
      setActiveIndex(index);
      // 使用 setTimeout 确保元素已渲染
      setTimeout(() => {
        listboxRef.current?.focus();
      }, 0);
    }
  }, [open, value]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setOpen((prev) => !prev);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(FRAME_RATE_OPTIONS.length - 1, prev + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(FRAME_RATE_OPTIONS.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTrigger();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = FRAME_RATE_OPTIONS[activeIndex];
      if (option) {
        onChange(option.value);
        closeAndFocusTrigger();
      }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className={clsx(
          'w-full px-3 py-2.5 rounded-lg border text-sm flex items-center justify-between gap-2',
          'bg-bg-tertiary border-border text-text-primary',
          'hover:bg-bg-hover transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-accent/50',
        )}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span className="truncate">{t(selectedOption.labelKey)}</span>
        <ChevronDown
          className={clsx(
            'w-4 h-4 text-text-secondary transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          ref={listboxRef}
          className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-bg-primary shadow-lg outline-none"
          role="listbox"
          aria-labelledby={triggerId}
          tabIndex={-1}
          onKeyDown={handleListboxKeyDown}
        >
          {FRAME_RATE_OPTIONS.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            const optionId = `${listboxId}-option-${option.value}`;
            return (
              <button
                key={optionId}
                id={optionId}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  closeAndFocusTrigger();
                }}
                className={clsx(
                  'w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2',
                  isActive
                    ? 'bg-bg-active text-text-primary'
                    : isSelected
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-primary hover:bg-bg-hover',
                )}
                role="option"
                aria-selected={isSelected}
              >
                <span className="truncate">{t(option.labelKey)}</span>
                {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
