import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff, Loader2 } from 'lucide-react';
import { isTauri } from '@/utils/paths';
import * as wsService from '@/services/wsService';

/**
 * 连接断开顶栏提示（仅 WebUI 模式生效）
 *
 * 当 WebSocket 与后端的连接中断时，在页面顶部显示不可关闭的提示栏。
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
    <div className="flex items-center justify-center gap-2 bg-red-500/90 text-white px-4 py-1.5 text-xs shadow-sm shrink-0 select-none animate-in slide-in-from-top duration-200">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span className="font-medium">{t('connectionLost.title')}</span>
      <span className="text-white/80">—</span>
      <span className="text-white/80">{t('connectionLost.message')}</span>
      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 ml-1" />
    </div>
  );
}
