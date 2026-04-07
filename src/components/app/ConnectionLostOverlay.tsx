import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff, Loader2 } from 'lucide-react';
import { isTauri } from '@/utils/paths';
import * as wsService from '@/services/wsService';

/**
 * 连接断开覆盖层（仅 WebUI 模式生效）
 *
 * 当 WebSocket 与后端的连接中断时，显示全屏遮罩提示用户连接已断开。
 * 连接恢复后自动消失。
 */
export function ConnectionLostOverlay() {
  const { t } = useTranslation();
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    if (isTauri()) return;

    const unlisten = wsService.onConnectionStatus((connected) => {
      setDisconnected(!connected);
    });

    return unlisten;
  }, []);

  if (isTauri() || !disconnected) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-sm mx-4 flex flex-col items-center py-8 px-6 animate-in fade-in zoom-in-95 duration-200">
        <WifiOff className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          {t('connectionLost.title')}
        </h2>
        <p className="text-text-secondary text-center text-sm mb-5">
          {t('connectionLost.message')}
        </p>
        <div className="flex items-center gap-2 text-text-tertiary text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('connectionLost.reconnecting')}</span>
        </div>
      </div>
    </div>
  );
}
