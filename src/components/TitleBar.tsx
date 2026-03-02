import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Copy, Box, Pin } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { getInterfaceLangKey } from '@/i18n';
import { loadIconAsDataUrl } from '@/services/contentResolver';
import { loggers } from '@/utils/logger';
import { isTauri } from '@/utils/paths';

// 平台类型
type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

export function TitleBar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);
  const windowRef = useRef<Awaited<ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>> | null>(null);

  const { projectInterface, language, resolveI18nText, basePath, interfaceTranslations, instances, activeInstanceId } =
    useAppStore();

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  // 检测平台（通过 userAgent）
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) setPlatform('windows');
    else if (ua.includes('mac')) setPlatform('macos');
    else if (ua.includes('linux')) setPlatform('linux');
  }, []);

  // 异步加载图标（Tauri 环境下需要转换为 data URL）
  useEffect(() => {
    if (!projectInterface?.icon) {
      setIconUrl(undefined);
      return;
    }
    loadIconAsDataUrl(projectInterface.icon, basePath, translations).then(setIconUrl);
  }, [projectInterface?.icon, basePath, translations]);

  // 检测是否使用前台截图（前台截图时禁用置顶）
  const isPinDisabled = useMemo(() => {
    if (!projectInterface || !activeInstanceId) return false;

    const activeInstance = instances.find((i) => i.id === activeInstanceId);
    if (!activeInstance?.controllerName) return false;

    const controller = projectInterface.controller.find((c) => c.name === activeInstance.controllerName);
    if (!controller) return false;

    // 仅 Win32 的特定前台截图方法需要禁用置顶
    if (controller.type === 'Win32' && controller.win32?.screencap) {
      const screencap = controller.win32.screencap;
      const foregroundMethods = new Set(['GDI', '1', 'DXGI_DesktopDup', '4', 'DXGI_DesktopDup_Window', '8', 'ScreenDC', '32']);
      return foregroundMethods.has(screencap);
    }

    // 其他情况（ADB、PlayCover、Gamepad 或 Win32 后台截图）均支持置顶
    return false;
  }, [projectInterface, instances, activeInstanceId]);

  // 监听窗口最大化状态变化（仅 Windows，用于切换最大化/还原按钮图标）
  useEffect(() => {
    if (!isTauri() || platform !== 'windows') return;

    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        windowRef.current = appWindow;

        // 获取初始状态
        setIsMaximized(await appWindow.isMaximized());
        setIsAlwaysOnTop(await appWindow.isAlwaysOnTop());

        // 监听窗口状态变化
        unlisten = await appWindow.onResized(async () => {
          setIsMaximized(await appWindow.isMaximized());
        });
      } catch (err) {
        loggers.ui.warn('Failed to setup window state listener:', err);
      }
    };

    setup();

    return () => {
      if (unlisten) unlisten();
      windowRef.current = null;
    };
  }, [platform]);

  const handleMinimize = async () => {
    if (!windowRef.current) return;
    try {
      await windowRef.current.minimize();
    } catch (err) {
      loggers.ui.warn('Failed to minimize window:', err);
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    if (!windowRef.current) return;
    const newState = !isAlwaysOnTop;
    setIsAlwaysOnTop(newState); // Optimistic update
    try {
      await windowRef.current.setAlwaysOnTop(newState);
    } catch (err) {
      setIsAlwaysOnTop(!newState); // Revert on error
      loggers.ui.warn('Failed to toggle always on top:', err);
    }
  };

  const handleToggleMaximize = async () => {
    if (!windowRef.current) return;
    try {
      await windowRef.current.toggleMaximize();
    } catch (err) {
      loggers.ui.warn('Failed to toggle maximize:', err);
    }
  };

  const handleClose = async () => {
    if (!windowRef.current) return;
    try {
      await windowRef.current.close();
    } catch (err) {
      loggers.ui.warn('Failed to close window:', err);
    }
  };

  // 计算窗口标题
  const getWindowTitle = () => {
    if (!projectInterface) return 'MXU';

    // 优先使用 title 字段（支持国际化），否则使用 name + version
    if (projectInterface.title) {
      return resolveI18nText(projectInterface.title, langKey);
    }

    const version = projectInterface.version;
    return version ? `${projectInterface.name} ${version}` : projectInterface.name;
  };

  // macOS/Linux 使用原生标题栏，不渲染自定义标题栏
  // 仅 Windows 使用自定义标题栏
  if (platform === 'macos' || platform === 'linux') {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      className="h-8 flex items-center justify-between bg-bg-secondary border-b border-border select-none shrink-0"
    >
      {/* 左侧：窗口图标和标题 */}
      <div className="flex items-center h-full" data-tauri-drag-region>
        {/* 窗口图标 */}
        <div className="w-8 h-8 flex items-center justify-center">
          {iconUrl ? (
            <img src={iconUrl} alt="icon" className="w-4 h-4" />
          ) : (
            // 默认图标（无 icon 配置或加载中）
            <Box className="w-4 h-4 text-text-secondary" />
          )}
        </div>
        <span className="text-xs text-text-secondary px-2 truncate max-w-lg" data-tauri-drag-region>
          {getWindowTitle()}
        </span>
      </div>

      {/* 右侧：窗口控制按钮（仅 Windows/Linux 显示） */}
      {isTauri() && (
        <div className="flex h-full">
          <button
            onClick={handleToggleAlwaysOnTop}
            disabled={isPinDisabled}
            className={`w-12 h-full flex items-center justify-center transition-colors ${
              isPinDisabled
                ? 'text-text-tertiary cursor-not-allowed'
                : isAlwaysOnTop
                  ? 'text-accent bg-accent/10 hover:bg-accent/20'
                  : 'text-text-secondary hover:bg-bg-hover'
            }`}
            title={
              isPinDisabled
                ? t('windowControls.pinDisabled')
                : isAlwaysOnTop
                  ? t('windowControls.unpin')
                  : t('windowControls.pin')
            }
          >
            <Pin className={`w-4 h-4 transition-transform ${isAlwaysOnTop ? '' : 'rotate-45'}`} />
          </button>
          <button
            onClick={handleMinimize}
            className="w-12 h-full flex items-center justify-center text-text-secondary hover:bg-bg-hover transition-colors"
            title={t('windowControls.minimize')}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="w-12 h-full flex items-center justify-center text-text-secondary hover:bg-bg-hover transition-colors"
            title={isMaximized ? t('windowControls.restore') : t('windowControls.maximize')}
          >
            {isMaximized ? (
              <Copy className="w-3.5 h-3.5 rotate-180" />
            ) : (
              <Square className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="w-12 h-full flex items-center justify-center text-text-secondary hover:bg-red-500 hover:text-white transition-colors"
            title={t('windowControls.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
