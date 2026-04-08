import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import type { ReactNode } from 'react';
import { isTauri } from '@/utils/paths';

interface DesktopOnlyWrapperProps {
  children: ReactNode;
}

/**
 * 在 WebUI 模式下为包裹的内容添加禁用遮罩和提示徽章。
 * Tauri 桌面端下透传子元素，无额外 DOM。
 */
export function DesktopOnlyWrapper({ children }: DesktopOnlyWrapperProps) {
  const { t } = useTranslation();

  if (isTauri()) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="opacity-45 pointer-events-none select-none">{children}</div>
      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/15 border border-warning/30 text-[11px] text-warning backdrop-blur-sm">
        <Monitor className="w-3 h-3" />
        <span>{t('common.desktopOnly')}</span>
      </div>
    </div>
  );
}
