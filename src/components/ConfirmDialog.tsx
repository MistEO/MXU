import clsx from 'clsx';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-bg-secondary rounded-xl border border-border shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {message && <p className="mt-2 text-sm text-text-secondary">{message}</p>}
        </div>

        <div className="px-5 py-4 flex justify-end gap-2 bg-bg-tertiary/30">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-bg-tertiary hover:bg-bg-hover text-text-secondary transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors shadow-sm',
              destructive ? 'bg-error hover:bg-error/90' : 'bg-accent hover:bg-accent-hover',
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

