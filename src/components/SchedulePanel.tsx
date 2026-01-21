import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { SchedulePolicy } from '@/types/interface';
import clsx from 'clsx';

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// 小时选项 (0-23)
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface SchedulePanelProps {
  instanceId: string;
  onClose: () => void;
}

/** 策略卡片组件 */
function PolicyCard({
  policy,
  onUpdate,
  onDelete,
  isExpanded,
  onToggleExpand,
}: {
  policy: SchedulePolicy;
  onUpdate: (updates: Partial<SchedulePolicy>) => void;
  onDelete: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation();

  const weekdayLabels = t('schedule.weekdays', { returnObjects: true }) as string[];

  const handleToggleWeekday = (day: number) => {
    const newWeekdays = policy.weekdays.includes(day)
      ? policy.weekdays.filter(d => d !== day)
      : [...policy.weekdays, day].sort((a, b) => a - b);
    onUpdate({ weekdays: newWeekdays });
  };

  const handleToggleHour = (hour: number) => {
    const newHours = policy.hours.includes(hour)
      ? policy.hours.filter(h => h !== hour)
      : [...policy.hours, hour].sort((a, b) => a - b);
    onUpdate({ hours: newHours });
  };

  const handleSelectAllWeekdays = () => {
    // 已全选时取消全选，否则全选
    if (policy.weekdays.length === 7) {
      onUpdate({ weekdays: [] });
    } else {
      onUpdate({ weekdays: [0, 1, 2, 3, 4, 5, 6] });
    }
  };

  const handleSelectAllHours = () => {
    // 已全选时取消全选，否则全选
    if (policy.hours.length === 24) {
      onUpdate({ hours: [] });
    } else {
      onUpdate({ hours: HOURS });
    }
  };

  // 格式化显示已选周几
  const formatWeekdays = () => {
    if (policy.weekdays.length === 0) return t('schedule.noWeekdays');
    if (policy.weekdays.length === 7) return t('schedule.everyday');
    return policy.weekdays.map(d => weekdayLabels[d]).join(', ');
  };

  // 格式化显示已选时间
  const formatHours = () => {
    if (policy.hours.length === 0) return t('schedule.noHours');
    if (policy.hours.length === 24) return t('schedule.everyHour');
    if (policy.hours.length <= 3) {
      return policy.hours.map(h => `${h.toString().padStart(2, '0')}:00`).join(', ');
    }
    return `${policy.hours.length} ${t('schedule.hoursSelected')}`;
  };

  return (
    <div className={clsx(
      'bg-bg-secondary rounded-lg border border-border overflow-hidden',
      !policy.enabled && 'opacity-60'
    )}>
      {/* 卡片头部 */}
      <div className="flex items-center gap-2 p-3">
        {/* 启用开关 */}
        <button
          onClick={() => onUpdate({ enabled: !policy.enabled })}
          className="p-1 rounded hover:bg-bg-hover"
          title={policy.enabled ? t('schedule.disable') : t('schedule.enable')}
        >
          {policy.enabled ? (
            <ToggleRight className="w-5 h-5 text-accent" />
          ) : (
            <ToggleLeft className="w-5 h-5 text-text-muted" />
          )}
        </button>

        {/* 策略名称 */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate block">
            {policy.name}
          </span>
        </div>

        {/* 展开/折叠 */}
        <button
          onClick={onToggleExpand}
          className="p-1 rounded hover:bg-bg-hover"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-text-secondary" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-secondary" />
          )}
        </button>

        {/* 删除按钮 */}
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-error/10 text-text-muted hover:text-error"
          title={t('common.delete')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 展开的配置面板 */}
      {isExpanded && (
        <div className="border-t border-border bg-bg-tertiary p-3 space-y-3">
          {/* 策略名称 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">
              {t('schedule.policyName')}
            </label>
            <input
              type="text"
              value={policy.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  onUpdate({ name: t('schedule.defaultPolicyName') });
                }
              }}
              className={clsx(
                'w-full px-2 py-1.5 text-sm rounded border',
                'bg-bg-primary text-text-primary border-border',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20'
              )}
            />
          </div>

          {/* 重复日期选择 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">
              {t('schedule.repeatDays')}
            </label>
            {/* 选择按钮 */}
            <div className="flex flex-wrap gap-1">
              <button
                onClick={handleSelectAllWeekdays}
                className={clsx(
                  'px-2 py-1 text-xs rounded border transition-colors',
                  policy.weekdays.length === 7
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-primary text-text-secondary border-border hover:border-accent hover:text-accent'
                )}
              >
                {t('schedule.everyday')}
              </button>
              {[1, 2, 3, 4, 5, 6, 0].map(day => (
                <button
                  key={day}
                  onClick={() => handleToggleWeekday(day)}
                  className={clsx(
                    'px-2 py-1 text-xs rounded border transition-colors',
                    policy.weekdays.includes(day)
                      ? 'bg-accent text-white border-accent'
                      : 'bg-bg-primary text-text-secondary border-border hover:border-accent hover:text-accent'
                  )}
                >
                  {weekdayLabels[day]}
                </button>
              ))}
            </div>
          </div>

          {/* 开始时间选择 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">
              {t('schedule.startTime')}
              <span className="text-text-muted font-normal ml-1">({t('schedule.multiSelect')})</span>
            </label>
            {/* 时间网格 */}
            <div className="grid grid-cols-7 gap-1">
              <button
                onClick={handleSelectAllHours}
                className={clsx(
                  'px-1 py-1.5 text-xs rounded border transition-colors',
                  policy.hours.length === 24
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-primary text-text-secondary border-border hover:border-accent hover:text-accent'
                )}
              >
                {t('schedule.all')}
              </button>
              {HOURS.map(hour => (
                <button
                  key={hour}
                  onClick={() => handleToggleHour(hour)}
                  className={clsx(
                    'px-1 py-1.5 text-xs rounded border transition-colors',
                    policy.hours.includes(hour)
                      ? 'bg-accent text-white border-accent'
                      : 'bg-bg-primary text-text-secondary border-border hover:border-accent hover:text-accent'
                  )}
                >
                  {hour.toString().padStart(2, '0')}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              {t('schedule.timeZoneHint')}
            </p>
          </div>

          {/* 摘要显示 */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-text-secondary">
              {formatWeekdays()} · {formatHours()}
            </p>
          </div>
        </div>
      )}

      {/* 未展开时显示简要信息 */}
      {!isExpanded && (
        <div className="px-3 pb-2">
          <p className="text-xs text-text-muted truncate">
            {formatWeekdays()} · {formatHours()}
          </p>
        </div>
      )}
    </div>
  );
}

export function SchedulePanel({ instanceId, onClose }: SchedulePanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const { getActiveInstance, updateInstance } = useAppStore();
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);

  const instance = getActiveInstance();
  const policies = instance?.schedulePolicies || [];

  // 点击外部关闭面板
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleAddPolicy = useCallback(() => {
    const newPolicy: SchedulePolicy = {
      id: generateId(),
      name: `${t('schedule.defaultPolicyName')} ${policies.length + 1}`,
      enabled: true,
      weekdays: [1, 2, 3, 4, 5], // 默认工作日
      hours: [8], // 默认早上8点
    };
    updateInstance(instanceId, {
      schedulePolicies: [...policies, newPolicy],
    });
    setExpandedPolicyId(newPolicy.id);
  }, [instanceId, policies, t, updateInstance]);

  const handleUpdatePolicy = useCallback((policyId: string, updates: Partial<SchedulePolicy>) => {
    const updatedPolicies = policies.map(p =>
      p.id === policyId ? { ...p, ...updates } : p
    );
    updateInstance(instanceId, { schedulePolicies: updatedPolicies });
  }, [instanceId, policies, updateInstance]);

  const handleDeletePolicy = useCallback((policyId: string) => {
    const updatedPolicies = policies.filter(p => p.id !== policyId);
    updateInstance(instanceId, { schedulePolicies: updatedPolicies });
    if (expandedPolicyId === policyId) {
      setExpandedPolicyId(null);
    }
  }, [instanceId, policies, expandedPolicyId, updateInstance]);

  return (
    <div
      ref={panelRef}
      className={clsx(
        'absolute bottom-full right-0 mb-2 w-80',
        'bg-bg-primary border border-border rounded-lg shadow-lg',
        'z-50'
      )}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">
            {t('schedule.title')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-hover"
        >
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      {/* 策略列表 */}
      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
        {policies.length === 0 ? (
          <div className="text-center py-6">
            <Clock className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-sm text-text-muted">{t('schedule.noPolicies')}</p>
            <p className="text-xs text-text-muted mt-1">{t('schedule.noPoliciesHint')}</p>
          </div>
        ) : (
          policies.map(policy => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onUpdate={(updates) => handleUpdatePolicy(policy.id, updates)}
              onDelete={() => handleDeletePolicy(policy.id)}
              isExpanded={expandedPolicyId === policy.id}
              onToggleExpand={() => setExpandedPolicyId(
                expandedPolicyId === policy.id ? null : policy.id
              )}
            />
          ))
        )}
      </div>

      {/* 添加按钮 */}
      <div className="px-3 pb-3">
        <button
          onClick={handleAddPolicy}
          className={clsx(
            'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg',
            'text-sm text-text-secondary',
            'border border-dashed border-border',
            'hover:bg-bg-hover hover:border-border-strong',
            'transition-colors'
          )}
        >
          <Plus className="w-4 h-4" />
          <span>{t('schedule.addPolicy')}</span>
        </button>
      </div>

      {/* 提示信息 */}
      <div className="px-4 py-2 border-t border-border bg-bg-tertiary rounded-b-lg">
        <p className="text-xs text-text-muted">
          {t('schedule.hint')}
        </p>
      </div>
    </div>
  );
}
