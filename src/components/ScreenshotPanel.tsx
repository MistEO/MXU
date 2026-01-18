import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Maximize2,
  X,
  Monitor,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  RefreshCw,
  Download,
  Copy,
  Unplug,
} from 'lucide-react';
import clsx from 'clsx';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu';
import { loggers } from '@/utils/logger';

const log = loggers.ui;

// 默认帧率限制：每秒 5 帧
const DEFAULT_FPS = 5;

export function ScreenshotPanel() {
  const { t } = useTranslation();
  const {
    activeInstanceId,
    instanceConnectionStatus,
    sidePanelExpanded,
    instanceScreenshotStreaming,
    setInstanceScreenshotStreaming,
  } = useAppStore();
  
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { state: menuState, show: showMenu, hide: hideMenu } = useContextMenu();
  
  // 用于控制截图流的引用
  const streamingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const frameIntervalRef = useRef(1000 / DEFAULT_FPS);
  
  const instanceId = activeInstanceId || '';
  
  // 从 store 获取当前实例的截图流状态
  const isStreaming = instanceId ? (instanceScreenshotStreaming[instanceId] ?? false) : false;
  
  // 更新截图流状态
  const setIsStreaming = useCallback((streaming: boolean) => {
    if (instanceId) {
      setInstanceScreenshotStreaming(instanceId, streaming);
    }
  }, [instanceId, setInstanceScreenshotStreaming]);

  // 获取单帧截图（任务未运行时使用）
  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!instanceId) return null;
    
    try {
      // 发起截图请求
      const screencapId = await maaService.postScreencap(instanceId);
      if (screencapId < 0) {
        throw new Error('Failed to post screencap');
      }
      
      // 等待截图完成
      const success = await maaService.screencapWait(instanceId, screencapId);
      if (!success) {
        throw new Error('Screencap failed');
      }
      
      // 获取缓存的图像
      const imageData = await maaService.getCachedImage(instanceId);
      return imageData || null;
    } catch (err) {
      log.warn('截图失败:', err);
      throw err;
    }
  }, [instanceId]);

  // 获取缓存截图（任务运行时直接获取）
  const getCachedFrame = useCallback(async (): Promise<string | null> => {
    if (!instanceId) return null;
    
    try {
      const imageData = await maaService.getCachedImage(instanceId);
      return imageData || null;
    } catch (err) {
      log.warn('获取缓存截图失败:', err);
      throw err;
    }
  }, [instanceId]);

  // 全屏模式切换
  const toggleFullscreen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsFullscreen(!isFullscreen);
  };

  // 组件卸载时停止截图流
  useEffect(() => {
    return () => {
      streamingRef.current = false;
    };
  }, []);

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

  // 截图流循环
  const streamLoop = useCallback(async () => {
    // 保存启动时的实例 ID，用于检查是否仍是活动实例
    const loopInstanceId = instanceId;
    
    while (streamingRef.current) {
      // 检查当前实例是否仍是活动实例，避免非活动 tab 刷新截图
      const currentActiveId = useAppStore.getState().activeInstanceId;
      if (loopInstanceId !== currentActiveId) {
        break;
      }
      
      const now = Date.now();
      const elapsed = now - lastFrameTimeRef.current;
      
      // 帧率限制
      if (elapsed < frameIntervalRef.current) {
        await new Promise(resolve => setTimeout(resolve, frameIntervalRef.current - elapsed));
        continue;
      }
      
      lastFrameTimeRef.current = Date.now();
      
      try {
        // 检查任务是否正在运行
        const isRunning = await maaService.isRunning(loopInstanceId);
        
        let imageData: string | null = null;
        
        if (isRunning) {
          // 任务运行中，直接获取缓存的截图（任务会自动更新缓存）
          imageData = await getCachedFrame();
        } else {
          // 任务未运行，需要主动发起截图
          imageData = await captureFrame();
        }
        
        // 再次检查是否仍是活动实例，避免更新非活动 tab 的截图
        if (imageData && streamingRef.current && loopInstanceId === useAppStore.getState().activeInstanceId) {
          setScreenshotUrl(imageData);
          setError(null);
        }
      } catch {
        // 静默处理错误，继续下一帧
      }
      
      // 短暂等待再进行下一次循环检查
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }, [instanceId, captureFrame, getCachedFrame]);

  // 开始/停止截图流
  const toggleStreaming = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    if (!instanceId) return;
    
    if (isStreaming) {
      // 停止流
      streamingRef.current = false;
      setIsStreaming(false);
    } else {
      // 开始流
      streamingRef.current = true;
      setIsStreaming(true);
      setError(null);
      streamLoop();
    }
  }, [instanceId, isStreaming, setIsStreaming, streamLoop]);

  // 实例切换时重置截图和错误，但保留截图流状态
  useEffect(() => {
    // 清除截图，等待新实例的截图
    setScreenshotUrl(null);
    setError(null);
    
    // 同步 streamingRef 与新实例的截图流状态
    const newInstanceStreaming = instanceId ? (instanceScreenshotStreaming[instanceId] ?? false) : false;
    streamingRef.current = newInstanceStreaming;
    
    // 如果新实例的截图流是开启的，启动流循环
    if (newInstanceStreaming && instanceId) {
      streamLoop();
    }
  }, [instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 面板折叠或被隐藏时停止流（但不改变 store 中的状态，只停止实际的流循环）
  useEffect(() => {
    if (isCollapsed || !sidePanelExpanded) {
      streamingRef.current = false;
    } else if (isStreaming && instanceId) {
      // 面板重新展开时，如果状态是开启的，恢复流
      streamingRef.current = true;
      streamLoop();
    }
  }, [isCollapsed, sidePanelExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // 连接成功后自动开始实时截图（仅当面板可见且未开启时）
  const connectionStatus = instanceId ? instanceConnectionStatus[instanceId] : undefined;
  const prevConnectionStatusRef = useRef<typeof connectionStatus>(undefined);

  // 保存截图
  const saveScreenshot = useCallback(async () => {
    if (!screenshotUrl) return;

    try {
      // 创建下载链接
      const link = document.createElement('a');
      link.href = screenshotUrl;
      link.download = `screenshot_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      log.warn('保存截图失败:', err);
    }
  }, [screenshotUrl]);

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

  // 强制刷新截图
  const forceRefresh = useCallback(async () => {
    if (!instanceId) return;

    try {
      const imageData = await captureFrame();
      if (imageData) {
        setScreenshotUrl(imageData);
        setError(null);
      }
    } catch (err) {
      log.warn('强制刷新失败:', err);
    }
  }, [instanceId, captureFrame]);

  // 断开连接（销毁实例）
  const disconnect = useCallback(async () => {
    if (!instanceId) return;

    try {
      // 销毁实例会断开连接
      await maaService.destroyInstance(instanceId);
      // 更新连接状态
      useAppStore.getState().setInstanceConnectionStatus(instanceId, 'Disconnected');
      setScreenshotUrl(null);
      streamingRef.current = false;
      setIsStreaming(false);
    } catch (err) {
      log.warn('断开连接失败:', err);
    }
  }, [instanceId, setIsStreaming]);

  // 右键菜单处理
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const isConnected = connectionStatus === 'Connected';

      const menuItems: MenuItem[] = [
        {
          id: 'stream',
          label: isStreaming
            ? t('contextMenu.stopStream')
            : t('contextMenu.startStream'),
          icon: isStreaming ? Pause : Play,
          disabled: !instanceId || !isConnected,
          onClick: () => toggleStreaming(),
        },
        {
          id: 'refresh',
          label: t('contextMenu.forceRefresh'),
          icon: RefreshCw,
          disabled: !instanceId || !isConnected,
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
      connectionStatus,
      isStreaming,
      screenshotUrl,
      toggleStreaming,
      forceRefresh,
      saveScreenshot,
      copyScreenshot,
      disconnect,
      showMenu,
    ]
  );
  
  useEffect(() => {
    // 检测连接状态从非 Connected 变为 Connected
    const wasConnected = prevConnectionStatusRef.current === 'Connected';
    const isConnected = connectionStatus === 'Connected';
    prevConnectionStatusRef.current = connectionStatus;
    
    if (isConnected && !wasConnected && !isStreaming && !isCollapsed && sidePanelExpanded && instanceId) {
      streamingRef.current = true;
      setIsStreaming(true);
      setError(null);
      streamLoop();
    }
  }, [connectionStatus, instanceId, isCollapsed, sidePanelExpanded, isStreaming, setIsStreaming, streamLoop]);

  return (
    <div className="bg-bg-secondary rounded-lg border border-border">
      {/* 标题栏（可点击折叠） */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsCollapsed(!isCollapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsCollapsed(!isCollapsed);
          }
        }}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-2 hover:bg-bg-hover transition-colors cursor-pointer',
          isCollapsed ? 'rounded-lg' : 'rounded-t-lg border-b border-border'
        )}
      >
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            {t('screenshot.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 流模式开关按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleStreaming();
            }}
            disabled={!instanceId}
            className={clsx(
              'p-1 rounded-md transition-colors',
              !instanceId
                ? 'text-text-muted cursor-not-allowed'
                : isStreaming
                ? 'text-green-500 hover:bg-bg-tertiary'
                : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            )}
            title={isStreaming ? t('screenshot.stopStream') : t('screenshot.startStream')}
          >
            {isStreaming ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>
          
          {/* 全屏按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            disabled={!screenshotUrl}
            className={clsx(
              'p-1 rounded-md transition-colors',
              !screenshotUrl
                ? 'text-text-muted cursor-not-allowed'
                : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            )}
            title={t('screenshot.fullscreen')}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {isCollapsed ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </div>

      {/* 可折叠内容 */}
      {!isCollapsed && (
        <div className="p-3">
          {/* 截图区域 */}
          <div
            className="aspect-video bg-bg-tertiary rounded-md flex items-center justify-center overflow-hidden relative"
            onContextMenu={handleContextMenu}
          >
            {screenshotUrl ? (
              <>
                <img
                  src={screenshotUrl}
                  alt="Screenshot"
                  className="w-full h-full object-contain rounded-md"
                />
                {/* 流模式指示器 */}
                {isStreaming && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-green-500/80 rounded text-white text-xs">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <Monitor className="w-10 h-10 opacity-30" />
                {error ? (
                  <span className="text-xs text-red-500">{error}</span>
                ) : (
                  <>
                    <span className="text-xs">{t('screenshot.noScreenshot')}</span>
                    <span className="text-xs text-text-muted">
                      {t('screenshot.connectFirst')}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
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
                  {t('screenshot.title')}
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

      {/* 右键菜单 */}
      {menuState.isOpen && (
        <ContextMenu
          items={menuState.items}
          position={menuState.position}
          onClose={hideMenu}
        />
      )}
    </div>
  );
}
