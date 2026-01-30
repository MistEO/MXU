import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { AccentInfo, CustomAccent } from '@/themes';

interface SortableAccentTileProps {
  accent: AccentInfo;
  customAccent: CustomAccent;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableAccentTile({
  accent,
  customAccent,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: SortableAccentTileProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: customAccent.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        'relative group flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-bg-tertiary border',
        isSelected
          ? 'ring-2 ring-offset-2 ring-offset-bg-secondary border-transparent'
          : 'border-border hover:bg-bg-hover',
        isDragging && 'cursor-grabbing',
      )}
      {...attributes}
      {...(listeners ?? {})}
    >
      <span
        className="w-4 h-4 rounded-full flex-shrink-0 border border-border-strong"
        style={{ backgroundColor: accent.color }}
      />
      <span className="truncate text-text-secondary pr-8">{accent.label}</span>

      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover"
          title={t('settings.editCustomAccent')}
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 rounded-md text-text-muted hover:text-error hover:bg-error/10"
          title={t('settings.deleteCustomAccent')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
