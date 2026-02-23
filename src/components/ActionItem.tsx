import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X, Play, GripVertical } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { ActionConfig } from '@/types/interface';
import clsx from 'clsx';
import { FileField, TextField, SwitchField } from './FormControls';

interface ActionItemProps {
  instanceId: string;
  action: ActionConfig | undefined;
  disabled?: boolean;
}

const defaultAction: ActionConfig = {
  enabled: false,
  program: '',
  args: '',
  waitForExit: false,
  skipIfRunning: true,
};

export function ActionItem({ instanceId, action, disabled }: ActionItemProps) {
  const { t } = useTranslation();
  const { setInstancePreAction } = useAppStore();
  const [expanded, setExpanded] = useState(false);

  const currentAction = useMemo<ActionConfig>(
    () => ({
      ...defaultAction,
      ...action,
    }),
    [action],
  );

  const setAction = setInstancePreAction;

  const title = t('action.preAction');
  const Icon = Play;
  const iconColor = 'text-success';

  // 删除动作
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setAction(instanceId, undefined);
  };

  // 更新动作配置
  const updateAction = (updates: Partial<ActionConfig>) => {
    setAction(instanceId, {
      ...currentAction,
      ...updates,
    });
  };

  // 切换启用状态
  const handleToggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    updateAction({ enabled: !currentAction.enabled });
  };

  // 判断是否有有效配置（有程序路径）
  const hasConfig = currentAction.program.trim().length > 0;

  return (
    <div
      className={clsx(
        'group rounded-lg border overflow-hidden transition-shadow flex-shrink-0',
        currentAction.enabled
          ? 'bg-bg-secondary border-border'
          : 'bg-bg-secondary/50 border-border/50',
        disabled && 'opacity-50',
      )}
    >
      {/* 头部 */}
      <div className="flex items-center gap-2 p-3">
        {/* 拖拽手柄占位（不可拖拽，仅用于对齐） */}
        <div className="p-1 rounded opacity-30 cursor-not-allowed">
          <GripVertical className="w-4 h-4 text-text-muted" />
        </div>

        {/* 启用复选框 */}
        <label
          className={clsx(
            'flex items-center',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
          onClick={handleToggleEnabled}
        >
          <input
            type="checkbox"
            checked={currentAction.enabled}
            onChange={() => {}}
            disabled={disabled}
            className="w-4 h-4 rounded border-border-strong accent-accent disabled:cursor-not-allowed"
          />
        </label>

        {/* 动作名称 + 展开区域 */}
        <div
          className="flex-1 flex items-center min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* 图标 */}
          <Icon className={clsx('w-4 h-4 mr-1.5 flex-shrink-0', iconColor)} />

          <span
            className={clsx(
              'text-sm font-medium truncate',
              currentAction.enabled ? 'text-text-primary' : 'text-text-muted',
            )}
          >
            {title}
          </span>

          {/* 预览：未展开时显示程序名称 */}
          {!expanded && hasConfig && (
            <span className="ml-2 text-xs text-text-tertiary truncate max-w-[200px]">
              {currentAction.program.split(/[/\\]/).pop()}
            </span>
          )}

          {/* 展开/折叠箭头 */}
          <div className="flex items-center justify-end pl-2 ml-auto">
            <ChevronRight
              className={clsx(
                'w-4 h-4 text-text-secondary transition-transform duration-150 ease-out',
                expanded && 'rotate-90',
              )}
            />
          </div>
        </div>

        {/* 删除按钮 */}
        {!disabled && (
          <button
            onClick={handleRemove}
            className={clsx(
              'p-1 rounded opacity-0 group-hover:opacity-100 transition-all',
              'text-text-muted hover:bg-error/10 hover:text-error',
            )}
            title={t('common.delete')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 展开面板 */}
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="border-t border-border bg-bg-tertiary p-3 space-y-3">
            {/* 程序路径 */}
            <FileField
              label={t('action.program')}
              value={currentAction.program}
              onChange={(v) => updateAction({ program: v })}
              placeholder={t('action.programPlaceholder')}
              disabled={disabled}
            />

            {/* 附加参数 */}
            <TextField
              label={t('action.args')}
              value={currentAction.args}
              onChange={(v) => updateAction({ args: v })}
              placeholder={t('action.argsPlaceholder')}
              disabled={disabled}
            />

            {/* 等待进程退出开关 */}
            <SwitchField
              label={t('action.waitForExit')}
              hint={t('action.waitForExitHintPre')}
              value={currentAction.waitForExit}
              onChange={(v) => updateAction({ waitForExit: v })}
              disabled={disabled}
            />

            {/* 已运行时跳过执行开关 */}
            <SwitchField
              label={t('action.skipIfRunning')}
              hint={t('action.skipIfRunningHint')}
              value={currentAction.skipIfRunning}
              onChange={(v) => updateAction({ skipIfRunning: v })}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
