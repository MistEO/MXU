import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import clsx from 'clsx';
import { normalizeHex } from '@/utils/color';

export function ColorPickerPopover({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const color = useMemo(() => normalizeHex(value) ?? '#000000', [value]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`color-popover-${id}`}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'w-14 h-14 rounded-lg border-2 border-border overflow-hidden shadow-sm',
          'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50',
        )}
        style={{ backgroundColor: color }}
        title={label}
      />

      {open && (
        <div
          id={`color-popover-${id}`}
          className="absolute z-50 mt-2 w-64 rounded-xl border border-border bg-bg-secondary shadow-2xl p-3"
        >
          {label && <div className="text-xs font-medium text-text-secondary mb-2">{label}</div>}
          <div className="rounded-lg overflow-hidden border border-border bg-bg-tertiary">
            <HexColorPicker
              color={color}
              onChange={(c) => {
                const next = normalizeHex(c);
                if (next) onChange(next);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

