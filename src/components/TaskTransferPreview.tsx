import type { ReactNode } from 'react';

export type TaskTransferPreviewItem = {
  id: string;
  label: string;
};

export function TaskTransferPreview({
  headerRight,
  countText,
  selectAllText,
  selectNoneText,
  onSelectAll,
  onSelectNone,
  items,
  selected,
  onToggle,
  emptySelectionWarning,
  previewJson,
}: {
  headerRight?: ReactNode;
  countText: string;
  selectAllText: string;
  selectNoneText: string;
  onSelectAll: () => void;
  onSelectNone: () => void;
  items: TaskTransferPreviewItem[];
  selected: Record<string, boolean>;
  onToggle: (id: string, checked: boolean) => void;
  emptySelectionWarning?: string;
  previewJson: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-text-muted">{countText}</div>
        <div className="flex items-center gap-2">
          {headerRight}
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={onSelectAll}
          >
            {selectAllText}
          </button>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={onSelectNone}
          >
            {selectNoneText}
          </button>
        </div>
      </div>

      <div className="max-h-40 overflow-auto rounded-lg border border-border bg-bg-tertiary">
        {items.map((it) => {
          const checked = selected[it.id] !== false;
          return (
            <label
              key={it.id}
              className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary border-b border-border last:border-b-0 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggle(it.id, e.target.checked)}
              />
              <span className="truncate">{it.label}</span>
            </label>
          );
        })}
      </div>

      {emptySelectionWarning && <div className="text-xs text-warning">{emptySelectionWarning}</div>}

      <pre className="text-xs bg-bg-tertiary rounded-lg border border-border p-3 overflow-auto whitespace-pre max-h-52">
        {previewJson}
      </pre>
    </div>
  );
}

