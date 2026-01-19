import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutGrid,
  Monitor,
  Play,
  Pause,
  Circle,
  RefreshCw,
  Download,
  Unplug,
  Maximize2,
  Copy,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import { loggers } from '@/utils/logger';

const log = loggers.ui;

interface InstanceCardProps {
  instanceId: string;
  instanceName: string;
  isActive: boolean;
  onSelect: () => void;
}

function InstanceCard({
  instanceId,
  instanceName,
  isActive,
  onSelect,
}: InstanceCardProps) {
  const { t } = useTranslation();
  const {
    instanceConnectionStatus,
    instanceTaskStatus,
    instanceScreenshotStreaming,
    setInstanceScreenshotStreaming,
    setInstanceConnectionStatus,
  } = useAppStore();

  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const streamingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const frameIntervalRef = useRef(1000 / 3); // 中控台使用更低的帧率节省资源

  const connectionStatus = instanceConnectionStatus[instanceId];
  const taskStatus = instanceTaskStatus[instanceId];
  const isStreaming = instanceScreenshotStreaming[instanceId] ?? false;
  const isConnected = connectionStatus === 'Connected';

  // 获取截图
  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!instanceId) return null;

    try {
      const isRunning = await maaService.isRunning(instanceId);

      if (isRunning) {
        const imageData = await maaService.getCachedImage(instanceId);
        return imageData || null;
      } else {
        const screencapId = await maaService.postScreencap(instanceId);
        if (screencapId < 0) return null;

        // 等待截图完成
        const success = await maaService.waitForScreencap(screencapId, 10000);
        if (!success) return null;

        const imageData = await maaService.getCachedImage(instanceId);
        return imageData || null;
      }
    } catch {
      return null;
    }
  }, [instanceId]);

  // 截图流循环
  const streamLoop = useCallback(async () => {
    while (streamingRef.current) {
      const now = Date.now();
      const elapsed = now - lastFrameTimeRef.current;

      if (elapsed < frameIntervalRef.current) {
        await new Promise((resolve) => setTimeout(resolve, frameIntervalRef.current - elapsed));
        continue;
      }

      lastFrameTimeRef.current = Date.now();

      try {
        const imageData = await captureFrame();
        if (imageData && streamingRef.current) {
          setScreenshotUrl(imageData);
        }
      } catch {
        // 静默处理
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, [instanceId, captureFrame]);

  // 切换截图流
  const toggleStreaming = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      if (!instanceId || !isConnected) return;

      if (isStreaming) {
        streamingRef.current = false;
        setInstanceScreenshotStreaming(instanceId, false);
      } else {
        streamingRef.current = true;
        setInstanceScreenshotStreaming(instanceId, true);
        streamLoop();
      }
    },
    [instanceId, isConnected, isStreaming, setInstanceScreenshotStreaming, streamLoop]
  );

  // 组件卸载时停止流
  useEffect(() => {
    return () => {
      streamingRef.current = false;
    };
  }, []);

  // 响应 store 中 isStreaming 状态变化
  useEffect(() => {
    // 同步 ref 与 store 状态
    streamingRef.current = isStreaming;
    
    // 如果状态变为开启且已连接，启动流
    if (isStreaming && isConnected) {
      streamLoop();
    }
  }, [isStreaming, isConnected, streamLoop]);

  // 连接后自动开始截图流
  const prevConnectedRef = useRef(false);
  const hasAutoStartedRef = useRef(false);
  
  // 组件挂载或状态恢复后，如果已连接，自动启动截图流
  useEffect(() => {
    // 避免重复启动
    if (hasAutoStartedRef.current) return;
    
    if (isConnected && !isStreaming) {
      hasAutoStartedRef.current = true;
      streamingRef.current = true;
      setInstanceScreenshotStreaming(instanceId, true);
      streamLoop();
    }
  }, [isConnected, isStreaming, instanceId, setInstanceScreenshotStreaming, streamLoop]);
  
  // 连接状态变化时的处理（从未连接变为已连接时重新启动）
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    
    // 从未连接变为已连接时，重置自动启动标记并启动
    if (isConnected && !wasConnected && !isStreaming) {
      hasAutoStartedRef.current = true;
      streamingRef.current = true;
      setInstanceScreenshotStreaming(instanceId, true);
      streamLoop();
    }
  }, [isConnected, isStreaming, instanceId, setInstanceScreenshotStreaming, streamLoop]);

  // 获取状态颜色
  const getStatusColor = () => {
    if (taskStatus === 'Running') return 'text-green-500';
    if (taskStatus === 'Failed') return 'text-red-500';
    if (isConnected) return 'text-blue-500';
    return 'text-gray-400';
  };

  // 全屏模式切换
  const toggleFullscreen = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  // ESC 键退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    
    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // 保存截图
  const saveScreenshot = useCallback(async () => {
    if (!screenshotUrl) return;
    try {
      const link = document.createElement('a');
      link.href = screenshotUrl;
      link.download = `screenshot_${instanceName}_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // 静默处理
    }
  }, [screenshotUrl, instanceName]);

  // 复制截图到剪贴板
  const copyScreenshot = useCallback(async () => {
    if (!screenshotUrl) return;
    try {
      const response = await fetch(screenshotUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch (err) {
      log.warn('复制截图失败:', err);
    }
  }, [screenshotUrl]);

  // 断开连接
  const disconnect = useCallback(async () => {
    try {
      await maaService.destroyInstance(instanceId);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setScreenshotUrl(null);
      streamingRef.current = false;
      setInstanceScreenshotStreaming(instanceId, false);
    } catch {
      // 静默处理
    }
  }, [instanceId, setInstanceConnectionStatus, setInstanceScreenshotStreaming]);

  // 强制刷新
  const forceRefresh = useCallback(async () => {
    const imageData = await captureFrame();
    if (imageData) {
      setScreenshotUrl(imageData);
    }
  }, [captureFrame]);

  // 右键菜单（复用首页截图面板的菜单结构）
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const menuItems: MenuItem[] = [
        {
          id: 'stream',
          label: isStreaming
            ? t('contextMenu.stopStream')
            : t('contextMenu.startStream'),
          icon: isStreaming ? Pause : Play,
          disabled: !isConnected,
          onClick: () => {
            if (!instanceId || !isConnected) return;
            if (isStreaming) {
              streamingRef.current = false;
              setInstanceScreenshotStreaming(instanceId, false);
            } else {
              streamingRef.current = true;
              setInstanceScreenshotStreaming(instanceId, true);
              streamLoop();
            }
          },
        },
        {
          id: 'refresh',
          label: t('contextMenu.forceRefresh'),
          icon: RefreshCw,
          disabled: !isConnected,
          onClick: forceRefresh,
        },
        { id: 'divider-1', label: '', divider: true },
        {
          id: 'fullscreen',
          label: t('contextMenu.fullscreen'),
          icon: Maximize2,
          disabled: !screenshotUrl,
          onClick: () => setIsFullscreen(true),
        },
        { id: 'divider-2', label: '', divider: true },
        {
          id: 'save',
          label: t('contextMenu.saveScreenshot'),
          icon: Download,
          disabled: !screenshotUrl,
          onClick: saveScreenshot,
        },
        {
          id: 'copy',
          label: t('contextMenu.copyScreenshot'),
          icon: Copy,
          disabled: !screenshotUrl,
          onClick: copyScreenshot,
        },
        { id: 'divider-3', label: '', divider: true },
        {
          id: 'disconnect',
          label: t('contextMenu.disconnect'),
          icon: Unplug,
          disabled: !isConnected,
          danger: true,
          onClick: disconnect,
        },
      ];

      showMenu(e, menuItems);
    },
    [
      t,
      instanceId,
      isConnected,
      isStreaming,
      screenshotUrl,
      setInstanceScreenshotStreaming,
      streamLoop,
      forceRefresh,
      saveScreenshot,
      copyScreenshot,
      disconnect,
      showMenu,
    ]
  );

  const getStatusText = () => {
    if (taskStatus === 'Running') return t('dashboard.running');
    if (taskStatus === 'Succeeded') return t('dashboard.succeeded');
    if (taskStatus === 'Failed') return t('dashboard.failed');
    if (connectionStatus === 'Connecting') return t('controller.connecting');
    if (isConnected) return t('controller.connected');
    return t('controller.disconnected');
  };

  return (
    <div
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      className={clsx(
        'group relative bg-bg-secondary rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg',
        isActive ? 'border-accent shadow-md' : 'border-border hover:border-accent/50'
      )}
    >
      {/* 截图区域 */}
      <div className="aspect-video bg-bg-tertiary relative overflow-hidden">
        {screenshotUrl ? (
          <>
            <img
              src={screenshotUrl}
              alt="Screenshot"
              className="w-full h-full object-contain"
            />
            {/* 流状态指示器 */}
            {isStreaming && (
              <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-green-500/80 rounded text-white text-xs">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                LIVE
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <Monitor className="w-8 h-8 opacity-30 mb-1" />
            <span className="text-xs">
              {isConnected ? t('screenshot.noScreenshot') : t('screenshot.connectFirst')}
            </span>
          </div>
        )}

        {/* 流控制按钮 */}
        {isConnected && (
          <button
            onClick={toggleStreaming}
            className={clsx(
              'absolute bottom-2 right-2 p-1.5 rounded-md transition-all',
              'bg-black/50 hover:bg-black/70 text-white',
              'opacity-0 group-hover:opacity-100'
            )}
            title={isStreaming ? t('screenshot.stopStream') : t('screenshot.startStream')}
          >
            {isStreaming ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* 实例信息栏 */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-center justify-between">
          <span
            className={clsx(
              'font-medium truncate',
              isActive ? 'text-accent' : 'text-text-primary'
            )}
          >
            {instanceName}
          </span>
          <div className="flex items-center gap-1.5">
            <Circle className={clsx('w-2 h-2 fill-current', getStatusColor())} />
            <span className={clsx('text-xs', getStatusColor())}>{getStatusText()}</span>
          </div>
        </div>
      </div>

      {/* 运行中动画边框 */}
      {taskStatus === 'Running' && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 rounded-xl border-2 border-green-500/50 animate-pulse" />
        </div>
      )}

      {/* 右键菜单 */}
      {menuState.isOpen && (
        <ContextMenu
          items={menuState.items}
          position={menuState.position}
          onClose={hideMenu}
        />
      )}

      {/* 全屏模态框 */}
      {isFullscreen && screenshotUrl && (
        <div 
          className="fixed inset-0 z-50 bg-white/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-8"
          onClick={toggleFullscreen}
        >
          {/* 卡片容器 */}
          <div 
            className="relative bg-bg-secondary rounded-xl border border-border shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={handleContextMenu}
          >
            {/* 卡片标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-tertiary/50">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-text-secondary" />
                <span className="text-sm font-medium text-text-primary">
                  {instanceName}
                </span>
                {/* 流模式指示器 */}
                {isStreaming && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/90 rounded text-white text-xs ml-2">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                  </div>
                )}
              </div>
              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
                title={t('screenshot.exitFullscreen')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* 图片内容区 */}
            <div className="p-4 bg-bg-primary flex items-center justify-center overflow-auto">
              <img
                src={screenshotUrl}
                alt="Screenshot"
                className="max-w-full max-h-[calc(90vh-80px)] object-contain rounded-md"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardView() {
  const { t } = useTranslation();
  const {
    instances,
    activeInstanceId,
    setActiveInstance,
    toggleDashboardView,
  } = useAppStore();

  const handleSelectInstance = (instanceId: string) => {
    setActiveInstance(instanceId);
    toggleDashboardView();
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      {/* 实例网格 */}
      <div className="flex-1 overflow-auto p-6">
        {instances.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted">
            <p>{t('dashboard.noInstances')}</p>
          </div>
        ) : (
          <div
            className={clsx(
              'grid gap-4',
              instances.length === 1
                ? 'grid-cols-1 max-w-2xl mx-auto'
                : instances.length === 2
                ? 'grid-cols-2 max-w-4xl mx-auto'
                : instances.length <= 4
                ? 'grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto'
                : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            )}
          >
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instanceId={instance.id}
                instanceName={instance.name}
                isActive={instance.id === activeInstanceId}
                onSelect={() => handleSelectInstance(instance.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-secondary">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-5 h-5 text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">{t('dashboard.title')}</h1>
          <span className="px-2 py-0.5 text-xs bg-accent/10 text-accent rounded-full">
            {instances.length} {t('dashboard.instances')}
          </span>
        </div>
        <button
          onClick={toggleDashboardView}
          className="px-3 py-1.5 text-sm bg-bg-hover hover:bg-bg-active text-text-secondary rounded-lg transition-colors"
        >
          {t('dashboard.exit')}
        </button>
      </div>
    </div>
  );
}
