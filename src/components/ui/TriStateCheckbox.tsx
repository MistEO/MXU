import type { MouseEvent } from 'react';
import { Check, CircleDot } from 'lucide-react';
import clsx from 'clsx';

export type TaskCheckboxState = 'off' | 'on' | 'once';

export function getTaskCheckboxState(enabled: boolean, runOnce: boolean): TaskCheckboxState {
  if (runOnce) return 'once';
  if (enabled) return 'on';
  return 'off';
}

interface TriStateCheckboxProps {
  state: TaskCheckboxState;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function TriStateCheckbox({
  state,
  disabled,
  title,
  onClick,
  onContextMenu,
}: TriStateCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'on' ? true : state === 'once' ? 'mixed' : false}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      onContextMenu={onContextMenu}
      className={clsx(
        'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        state === 'off' && 'border-border-strong bg-bg-primary hover:border-accent/60',
        state === 'on' && 'border-accent bg-accent text-white',
        state === 'once' && 'border-accent bg-accent/15 text-accent hover:bg-accent/25',
      )}
    >
      {state === 'on' && <Check className="w-3 h-3" strokeWidth={3} />}
      {state === 'once' && <CircleDot className="w-3 h-3" />}
    </button>
  );
}
