import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { ModalPortal, useModalFocusTrap } from '@/components/ui/Modal';

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
  onConfirm: () => void;
  onSecondaryConfirm?: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useModalFocusTrap({
    active: open,
    containerRef: panelRef,
    initialFocusRef: cancelBtnRef,
    onEscape: onCancel,
  });

  // ConfirmDialog 特有的 Enter 快捷确认；Escape 和 Tab 循环由通用模态 hook 处理。
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;

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
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    open,
    onConfirm,
    confirmDisabled,
    secondaryConfirmText,
    onSecondaryConfirm,
    secondaryConfirmDisabled,
  ]);

  if (!open) return null;

  return (
    <ModalPortal>
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

          <div className="px-5 py-4 flex justify-end gap-2 bg-bg-tertiary/30 flex-shrink-0">
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
    </ModalPortal>
  );
}
