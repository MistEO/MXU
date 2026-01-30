import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { HexColorPicker } from 'react-colorful';
import clsx from 'clsx';
import { normalizeHex } from '@/utils/color';

function clampChannel(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(255, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const nr = clampChannel(r);
  const ng = clampChannel(g);
  const nb = clampChannel(b);
  return `#${nr.toString(16).padStart(2, '0')}${ng
    .toString(16)
    .padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`.toUpperCase();
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

  const color = useMemo(() => normalizeHex(value) ?? '#000000', [value]);

  const [rgbInput, setRgbInput] = useState(() => {
    const { r, g, b } = hexToRgb(color);
    return { r: String(r), g: String(g), b: String(b) };
  });

  // sync RGB inputs when external color changes (picker / parent)
  useEffect(() => {
    const { r, g, b } = hexToRgb(color);
    setRgbInput({ r: String(r), g: String(g), b: String(b) });
  }, [color]);

  const handleRgbChange = (channel: 'r' | 'g' | 'b') => (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;

    // allow empty string while typing
    if (raw === '') {
      setRgbInput((prev) => ({ ...prev, [channel]: '' }));
      return;
    }

    // only allow digits
    if (!/^\d+$/.test(raw)) return;

    const numeric = parseInt(raw, 10);
    if (Number.isNaN(numeric)) return;

    // keep input within 0-255
    const clamped = clampChannel(numeric);
    setRgbInput((prev) => ({ ...prev, [channel]: String(clamped) }));

    const current = hexToRgb(color);
    const merged = {
      ...current,
      [channel]: clamped,
    };
    const nextHex = rgbToHex(merged.r, merged.g, merged.b);
    onChange(nextHex);
  };

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
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden border border-border bg-bg-tertiary">
              <HexColorPicker
                color={color}
                onChange={(c: string) => {
                  const next = normalizeHex(c);
                  if (next) onChange(next);
                }}
              />
            </div>

            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-md border border-border-strong shadow-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <div className="flex items-center gap-1 flex-1">
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-[10px] font-medium text-text-muted leading-none">R</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgbInput.r}
                    onChange={handleRgbChange('r')}
                    className="w-full px-1.5 py-1 rounded-md bg-bg-tertiary border border-border text-[11px] font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/60 focus:border-accent/60"
                  />
                </div>
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-[10px] font-medium text-text-muted leading-none">G</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgbInput.g}
                    onChange={handleRgbChange('g')}
                    className="w-full px-1.5 py-1 rounded-md bg-bg-tertiary border border-border text-[11px] font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/60 focus:border-accent/60"
                  />
                </div>
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-[10px] font-medium text-text-muted leading-none">B</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgbInput.b}
                    onChange={handleRgbChange('b')}
                    className="w-full px-1.5 py-1 rounded-md bg-bg-tertiary border border-border text-[11px] font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/60 focus:border-accent/60"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
