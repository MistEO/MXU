import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import clsx from 'clsx';
import type { ScheduleExecutionInfo } from '@/stores/types';

interface ScheduleButtonProps {
  enabledCount: number;
  scheduleExecution: ScheduleExecutionInfo | null;
  showPanel: boolean;
  onToggle: () => void;
}

export function ScheduleButton({
  enabledCount,
  scheduleExecution,
  showPanel,
  onToggle,
}: ScheduleButtonProps) {
  const { t } = useTranslation();

  // 格式化开始时间
  const formatStartTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors relative',
          scheduleExecution
            ? 'bg-success text-white'
            : showPanel
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        title={
          scheduleExecution
            ? t('schedule.executingPolicy', { name: scheduleExecution.policyName })
            : t('schedule.title')
        }
      >
        <Clock className={clsx('w-4 h-4', scheduleExecution && 'animate-pulse')} />
        <span className="hidden sm:inline">{t('schedule.button')}</span>
        {/* 启用数量徽章 */}
        {enabledCount > 0 && !showPanel && !scheduleExecution && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-accent text-white text-xs font-medium rounded-full">
            {enabledCount}
          </span>
        )}
      </button>

      {/* 定时执行状态气泡 */}
      {scheduleExecution && !showPanel && (
        <div
          className={clsx(
            'absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
            'px-3 py-2 rounded-lg shadow-lg',
            'bg-success text-white text-xs whitespace-nowrap',
            'animate-fade-in',
          )}
        >
          <div className="font-medium">
            {t('schedule.executingPolicy', { name: scheduleExecution.policyName })}
          </div>
          <div className="text-white/80 mt-0.5">
            {t('schedule.startedAt', {
              time: formatStartTime(scheduleExecution.startTime),
            })}
          </div>
          {/* 气泡箭头 */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-success" />
        </div>
      )}
    </div>
  );
}
