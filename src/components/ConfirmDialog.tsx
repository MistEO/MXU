import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmText,
  secondaryConfirmText,
  cancelText,
  destructive,
  confirmDisabled,
  secondaryConfirmDisabled,
  secondaryDestructive,
  dontAskAgain,
  onToggleDontAskAgain,
  onConfirm,
  onSecondaryConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  children?: ReactNode;
  confirmText: string;
  secondaryConfirmText?: string;
  cancelText: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  secondaryConfirmDisabled?: boolean;
  secondaryDestructive?: boolean;
  dontAskAgain?: boolean;
  onToggleDontAskAgain?: (v: boolean) => void;
  onConfirm: () => void;
  onSecondaryConfirm?: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        if (!confirmDisabled) {
          e.preventDefault();
          onConfirm();
          return;
        }

        if (secondaryConfirmText && onSecondaryConfirm && !secondaryConfirmDisabled) {
          e.preventDefault();
          onSecondaryConfirm();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
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
  }, [
    open,
    onCancel,
    onConfirm,
    confirmDisabled,
    secondaryConfirmText,
    onSecondaryConfirm,
    secondaryConfirmDisabled,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm max-h-[85vh] bg-bg-secondary rounded-xl border border-border shadow-2xl overflow-hidden flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex-shrink-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {message && <p className="mt-2 text-sm text-text-secondary">{message}</p>}
        </div>

        {children && <div className="px-5 py-4 overflow-auto flex-1 min-h-0">{children}</div>}

        <div className="px-5 py-4 flex items-center justify-between bg-bg-tertiary/30 flex-shrink-0">
          {onToggleDontAskAgain ? (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => onToggleDontAskAgain(e.target.checked)}
                className="rounded border-border text-accent focus:ring-accent"
              />
              <span className="text-xs text-text-muted">{t('common.dontAskAgain')}</span>
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            ref={cancelBtnRef}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-bg-tertiary hover:bg-bg-hover text-text-secondary transition-colors"
          >
            {cancelText}
          </button>
          {secondaryConfirmText && onSecondaryConfirm && (
            <button
              type="button"
              onClick={onSecondaryConfirm}
              disabled={secondaryConfirmDisabled}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors shadow-sm',
                secondaryConfirmDisabled
                  ? 'bg-bg-active text-text-muted cursor-not-allowed shadow-none'
                  : secondaryDestructive
                    ? 'bg-error hover:bg-error/90'
                    : 'bg-accent hover:bg-accent-hover',
              )}
            >
              {secondaryConfirmText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors shadow-sm',
              confirmDisabled
                ? 'bg-bg-active text-text-muted cursor-not-allowed shadow-none'
                : destructive
                  ? 'bg-error hover:bg-error/90'
                  : 'bg-accent hover:bg-accent-hover',
            )}
          >
            {confirmText}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
