import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import clsx from 'clsx';

function normalizeHex(input: string): string {
  let v = input.trim();
  if (!v) return '#000000';
  if (!v.startsWith('#')) v = `#${v}`;
  v = v.toLowerCase();
  // Allow short values during typing elsewhere; here we normalize on blur/commit.
  if (/^#[0-9a-f]{3}$/.test(v)) {
    const r = v[1];
    const g = v[2];
    const b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  // pad / truncate
  const hex = v.replace(/[^0-9a-f]/g, '').slice(0, 6).padEnd(6, '0');
  return `#${hex}`;
}

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

  const color = useMemo(() => normalizeHex(value), [value]);

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
            <HexColorPicker color={color} onChange={(c) => onChange(normalizeHex(c))} />
          </div>
        </div>
      )}
    </div>
  );
}

