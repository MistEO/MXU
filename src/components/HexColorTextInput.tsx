import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { isHexLike, normalizeHex } from '@/utils/color';

export function HexColorTextInput({
  value,
  onCommit,
  className,
  placeholder = '#4F46E5',
}: {
  value: string;
  onCommit: (normalized: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const committed = useMemo(() => normalizeHex(value) ?? '#000000', [value]);
  const [raw, setRaw] = useState(committed.toUpperCase());

  // sync when external value changes (e.g. picker)
  useEffect(() => {
    setRaw(committed.toUpperCase());
  }, [committed]);

  return (
    <input
      type="text"
      value={raw}
      onChange={(e) => {
        const nextRaw = e.target.value;
        // Allow transient states while typing: '', '#', partial hex
        if (!isHexLike(nextRaw)) return;
        setRaw(nextRaw.toUpperCase());

        // Commit only when user has typed a complete/normalizable value
        const normalized = normalizeHex(nextRaw);
        if (normalized) onCommit(normalized);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const normalized = normalizeHex(raw);
          if (normalized) onCommit(normalized);
          else setRaw(committed.toUpperCase());
        }
      }}
      onBlur={() => {
        const normalized = normalizeHex(raw);
        if (normalized) {
          onCommit(normalized);
          setRaw(normalized.toUpperCase());
        } else {
          // Revert to last committed value if user leaves it invalid/empty
          setRaw(committed.toUpperCase());
        }
      }}
      className={clsx(className)}
      placeholder={placeholder}
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
    />
  );
}

