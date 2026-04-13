import {
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  X,
  Check,
  Copy,
  Edit3,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import type { MenuItem } from './ContextMenu';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// 右键菜单构建器 — TaskItem 和 ActionItem 复用
// ---------------------------------------------------------------------------

export interface ListItemMenuLabels {
  duplicate: string;
  rename: string;
  enable: string;
  disable: string;
  expand: string;
  collapse: string;
  moveUp: string;
  moveDown: string;
  moveToTop: string;
  moveToBottom: string;
  delete: string;
}

export interface ListItemMenuConfig {
  labels: ListItemMenuLabels;
  /** 当前是否启用 */
  isEnabled: boolean;
  /** 当前是否展开 */
  isExpanded: boolean;
  /** 是否能展开（无内容时为 false 可隐藏此菜单项） */
  canExpand?: boolean;
  /** 是否位于列表首位 */
  isFirst: boolean;
  /** 是否位于列表末位 */
  isLast: boolean;
  /** 项目不可修改（如实例运行中） */
  isLocked: boolean;

  onDuplicate: () => void;
  onRename: () => void;
  onToggle: () => void;
  onExpand: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
  onDelete: () => void;
}

export function buildListItemMenuItems(cfg: ListItemMenuConfig): MenuItem[] {
  const { labels, isEnabled, isExpanded, canExpand = true, isFirst, isLast, isLocked } = cfg;

  return [
    {
      id: 'duplicate',
      label: labels.duplicate,
      icon: Copy,
      disabled: isLocked,
      onClick: cfg.onDuplicate,
    },
    {
      id: 'rename',
      label: labels.rename,
      icon: Edit3,
      onClick: cfg.onRename,
    },
    { id: 'divider-1', label: '', divider: true },
    {
      id: 'toggle',
      label: isEnabled ? labels.disable : labels.enable,
      icon: isEnabled ? ToggleLeft : ToggleRight,
      disabled: isLocked,
      onClick: cfg.onToggle,
    },
    ...(canExpand
      ? [
          {
            id: 'expand',
            label: isExpanded ? labels.collapse : labels.expand,
            icon: isExpanded ? ChevronUp : ChevronDown,
            onClick: cfg.onExpand,
          },
        ]
      : []),
    { id: 'divider-2', label: '', divider: true },
    {
      id: 'move-up',
      label: labels.moveUp,
      icon: ChevronUp,
      disabled: isFirst || isLocked,
      onClick: cfg.onMoveUp,
    },
    {
      id: 'move-down',
      label: labels.moveDown,
      icon: ChevronDown,
      disabled: isLast || isLocked,
      onClick: cfg.onMoveDown,
    },
    {
      id: 'move-top',
      label: labels.moveToTop,
      icon: ChevronsUp,
      disabled: isFirst || isLocked,
      onClick: cfg.onMoveToTop,
    },
    {
      id: 'move-bottom',
      label: labels.moveToBottom,
      icon: ChevronsDown,
      disabled: isLast || isLocked,
      onClick: cfg.onMoveToBottom,
    },
    { id: 'divider-3', label: '', divider: true },
    {
      id: 'delete',
      label: labels.delete,
      icon: Trash2,
      danger: true,
      disabled: isLocked,
      onClick: cfg.onDelete,
    },
  ];
}

// ---------------------------------------------------------------------------
// 内联重命名编辑器 — TaskItem 和 ActionItem 复用
// ---------------------------------------------------------------------------

interface InlineNameEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder: string;
}

export function InlineNameEditor({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
}: InlineNameEditorProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSave();
    else if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onSave}
        placeholder={placeholder}
        autoFocus
        className={clsx(
          'flex-1 px-2 py-1 text-sm rounded border border-accent',
          'bg-bg-primary text-text-primary',
          'focus:outline-none focus:ring-1 focus:ring-accent/20',
        )}
      />
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSave();
        }}
        className="p-1 rounded hover:bg-success/10 text-success"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        className="p-1 rounded hover:bg-error/10 text-error"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
