import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  TabBar,
  TaskList,
  AddTaskPanel,
  Toolbar,
  ScreenshotPanel,
  LogsPanel,
  SettingsPage,
  WelcomeDialog,
  ConnectionPanel,
  DashboardView,
} from '@/components';
import { autoLoadInterface, loadConfig, loadConfigFromStorage, resolveI18nText, checkUpdate, openMirrorChyanWebsite } from '@/services';
import { Loader2, AlertCircle, RefreshCw, X, Download, ExternalLink } from 'lucide-react';
import { simpleMarkdownToHtml } from '@/services/contentResolver';
import { useTranslation } from 'react-i18next';
import { loggers } from '@/utils/logger';

const log = loggers.app;

type LoadingState = 'loading' | 'success' | 'error';

// 检测是否在 Tauri 环境中
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * 设置窗口标题
 */
async function setWindowTitle(title: string) {
  // 同时设置 document.title（对浏览器和 Tauri 都有效）
  document.title = title;
  
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      await currentWindow.setTitle(title);
    } catch (err) {
      log.warn('设置窗口标题失败:', err);
    }
  }
}

/**
 * 设置窗口大小
 */
async function setWindowSize(width: number, height: number) {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const currentWindow = getCurrentWindow();
      await currentWindow.setSize(new LogicalSize(width, height));
    } catch (err) {
      log.warn('设置窗口大小失败:', err);
    }
  }
}

/**
 * 获取当前窗口大小
 */
async function getWindowSize(): Promise<{ width: number; height: number } | null> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const size = await currentWindow.innerSize();
      const scaleFactor = await currentWindow.scaleFactor();
      // 转换为逻辑像素
      return {
        width: Math.round(size.width / scaleFactor),
        height: Math.round(size.height / scaleFactor),
      };
    } catch (err) {
      log.warn('获取窗口大小失败:', err);
    }
  }
  return null;
}

// 更新弹窗组件
function UpdateDialog({
  updateInfo,
  currentVersion,
  onClose,
  onDownload,
}: {
  updateInfo: { versionName: string; releaseNote: string; downloadUrl?: string; channel?: string };
  currentVersion: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-border">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 bg-accent text-white">
          <div className="flex items-center gap-3">
            <Download className="w-6 h-6" />
            <h2 className="text-lg font-bold">{t('mirrorChyan.newVersion')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* 版本信息 */}
        <div className="px-6 py-4 space-y-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-secondary">{t('mirrorChyan.currentVersion')}</span>
            <span className="font-mono text-text-primary">{currentVersion}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-text-secondary">{t('mirrorChyan.latestVersion')}</span>
            <span className="font-mono text-accent font-bold">{updateInfo.versionName}</span>
          </div>
          {updateInfo.channel && updateInfo.channel !== 'stable' && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-text-secondary">{t('mirrorChyan.channel')}</span>
              <span className="px-2 py-0.5 bg-warning/20 text-warning text-xs rounded-full font-medium">
                {updateInfo.channel}
              </span>
            </div>
          )}
        </div>
        
        {/* 更新日志 */}
        <div className="px-6 pb-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">{t('mirrorChyan.releaseNotes')}</h3>
          <div className="max-h-48 overflow-y-auto bg-bg-secondary rounded-lg p-3 border border-border">
            {updateInfo.releaseNote ? (
              <div 
                className="text-sm text-text-secondary prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(updateInfo.releaseNote) }}
              />
            ) : (
              <p className="text-sm text-text-muted italic">{t('mirrorChyan.noReleaseNotes')}</p>
            )}
          </div>
        </div>
        
        {/* 操作按钮 */}
        <div className="px-6 py-4 bg-bg-secondary border-t border-border flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-tertiary text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('mirrorChyan.later')}
          </button>
          {updateInfo.downloadUrl ? (
            <button
              onClick={onDownload}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <Download className="w-4 h-4" />
              {t('mirrorChyan.downloadNow')}
            </button>
          ) : (
            <button
              onClick={() => openMirrorChyanWebsite('mxu_update_dialog')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              {t('mirrorChyan.getCdk')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const { t } = useTranslation();

  const {
    setProjectInterface,
    setInterfaceTranslations,
    setBasePath,
    importConfig,
    createInstance,
    theme,
    currentPage,
    projectInterface,
    interfaceTranslations,
    language,
    sidePanelExpanded,
    dashboardView,
    setWindowSize: setWindowSizeStore,
    mirrorChyanSettings,
    updateInfo,
    showUpdateDialog,
    setUpdateInfo,
    setShowUpdateDialog,
  } = useAppStore();

  const initialized = useRef(false);

  // 设置窗口标题
  useEffect(() => {
    if (!projectInterface) return;
    
    const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
    const translations = interfaceTranslations[langKey];
    
    // 优先使用 title 字段，否则使用 name + version
    let title: string;
    if (projectInterface.title) {
      title = resolveI18nText(projectInterface.title, translations);
    } else {
      const name = resolveI18nText(projectInterface.label, translations) || projectInterface.name;
      const version = projectInterface.version;
      title = version ? `${name} v${version}` : name;
    }
    
    setWindowTitle(title);
  }, [projectInterface, language, interfaceTranslations]);

  // 加载 interface.json 和配置文件
  const loadInterface = async () => {
    setLoadingState('loading');
    setErrorMessage('');

    try {
      log.info('加载 interface.json...');
      const result = await autoLoadInterface();
      setProjectInterface(result.interface);
      setBasePath(result.basePath);

      // 设置翻译
      for (const [lang, trans] of Object.entries(result.translations)) {
        setInterfaceTranslations(lang, trans);
      }

      // 加载用户配置（mxu.json）
      let config = await loadConfig(result.basePath);
      
      // 浏览器环境下，如果没有从 public 目录加载到配置，尝试从 localStorage 加载
      if (config.instances.length === 0) {
        const storageConfig = loadConfigFromStorage();
        if (storageConfig && storageConfig.instances.length > 0) {
          config = storageConfig;
        }
      }

      // 应用配置
      if (config.instances.length > 0) {
        importConfig(config);
      }
      
      // 应用保存的窗口大小
      if (config.settings.windowSize) {
        await setWindowSize(config.settings.windowSize.width, config.settings.windowSize.height);
      }

      log.info('加载完成, 项目:', result.interface.name);
      setLoadingState('success');

      // 如果没有实例，创建一个默认实例
      setTimeout(() => {
        const currentInstances = useAppStore.getState().instances;
        if (currentInstances.length === 0) {
          createInstance(t('instance.defaultName', '多开 1'));
        }
      }, 0);
      
      // 自动检查更新
      if (result.interface.mirrorchyan_rid && result.interface.version) {
        const appState = useAppStore.getState();
        checkUpdate({
          resourceId: result.interface.mirrorchyan_rid,
          currentVersion: result.interface.version,
          cdk: appState.mirrorChyanSettings.cdk || undefined,
          channel: appState.mirrorChyanSettings.channel,
          userAgent: 'MXU',
        }).then(updateResult => {
          if (updateResult) {
            setUpdateInfo(updateResult);
            if (updateResult.hasUpdate) {
              log.info(`发现新版本: ${updateResult.versionName}`);
              setShowUpdateDialog(true);
            }
          }
        }).catch(err => {
          log.warn('自动检查更新失败:', err);
        });
      }
    } catch (err) {
      log.error('加载 interface.json 失败:', err);
      setErrorMessage(err instanceof Error ? err.message : '加载失败');
      setLoadingState('error');
    }
  };

  // 初始化
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 设置主题
    document.documentElement.classList.toggle('dark', theme === 'dark');

    // 自动加载 interface
    loadInterface();
  }, []);

  // 主题变化时更新 DOM
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 监听窗口大小变化
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupListener = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();

        unlisten = await currentWindow.onResized(async () => {
          // 防抖处理，避免频繁保存
          if (resizeTimeout) {
            clearTimeout(resizeTimeout);
          }
          resizeTimeout = setTimeout(async () => {
            const size = await getWindowSize();
            if (size) {
              setWindowSizeStore(size);
            }
          }, 500);
        });
      } catch (err) {
        log.warn('监听窗口大小变化失败:', err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
    };
  }, [setWindowSizeStore]);

  // 禁用浏览器默认右键菜单（让自定义菜单生效）
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // 允许输入框和文本区域的默认右键菜单
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // 屏蔽浏览器默认快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // F5 - 刷新（仅生产环境屏蔽）
      if (e.key === 'F5' && import.meta.env.PROD) {
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd 组合键
      if (isCtrlOrMeta) {
        // Ctrl+R 刷新（仅生产环境屏蔽）
        if (e.key.toLowerCase() === 'r' && import.meta.env.PROD) {
          e.preventDefault();
          return;
        }

        const blockedKeys = [
          'f', // 搜索
          's', // 保存
          'u', // 查看源代码
          'p', // 打印
          'g', // 查找下一个
          'j', // 下载
          'h', // 历史记录
          'd', // 书签
          'n', // 新窗口
          't', // 新标签页
          'w', // 关闭标签页
        ];

        if (blockedKeys.includes(e.key.toLowerCase())) {
          e.preventDefault();
          return;
        }

        // Ctrl+Shift 组合键
        if (e.shiftKey) {
          const blockedShiftKeys = [
            'i', // 开发者工具
            't', // 恢复标签页
            'n', // 新隐私窗口
          ];
          if (blockedShiftKeys.includes(e.key.toLowerCase())) {
            e.preventDefault();
            return;
          }
        }
      }

      // F12 - 开发者工具（生产环境屏蔽）
      if (e.key === 'F12' && import.meta.env.PROD) {
        e.preventDefault();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 设置页面
  if (currentPage === 'settings') {
    return <SettingsPage />;
  }

  // 计算显示标题
  const getDisplayTitle = () => {
    if (!projectInterface) return { title: 'MXU', subtitle: 'MaaFramework 下一代通用 GUI' };
    
    const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
    const translations = interfaceTranslations[langKey];
    
    // 优先使用 title 字段，否则使用 label/name + version
    let title: string;
    if (projectInterface.title) {
      title = resolveI18nText(projectInterface.title, translations);
    } else {
      const name = resolveI18nText(projectInterface.label, translations) || projectInterface.name;
      const version = projectInterface.version;
      title = version ? `${name} v${version}` : name;
    }
    
    // 副标题：使用 description 或默认
    const subtitle = projectInterface.description 
      ? resolveI18nText(projectInterface.description, translations)
      : 'MaaFramework 下一代通用 GUI';
    
    return { title, subtitle };
  };

  // 加载中或错误状态
  if (loadingState !== 'success' || !projectInterface) {
    const { title: displayTitle, subtitle: displaySubtitle } = getDisplayTitle();
    
    return (
      <div className="h-full flex flex-col items-center justify-center bg-bg-primary p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          {/* Logo/标题 */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-text-primary">{displayTitle}</h1>
            <p className="text-text-secondary">{displaySubtitle}</p>
          </div>

          {/* 加载状态 */}
          {loadingState === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
              <p className="text-text-secondary">正在加载 interface.json...</p>
            </div>
          )}

          {/* 错误状态 */}
          {loadingState === 'error' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">加载失败</span>
              </div>
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
              <button
                onClick={loadInterface}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 处理下载
  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank');
    }
    setShowUpdateDialog(false);
  };

  // 主页面
  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* 欢迎弹窗 */}
      <WelcomeDialog />
      
      {/* 更新弹窗 */}
      {showUpdateDialog && updateInfo?.hasUpdate && (
        <UpdateDialog
          updateInfo={updateInfo}
          currentVersion={projectInterface?.version || ''}
          onClose={() => setShowUpdateDialog(false)}
          onDownload={handleDownload}
        />
      )}

      {/* 顶部标签栏 */}
      <TabBar />

      {/* 中控台视图 */}
      {dashboardView ? (
        <DashboardView />
      ) : (
        /* 主内容区 */
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧任务列表区 */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            {/* 任务列表 */}
            <TaskList />

            {/* 添加任务面板 */}
            {showAddPanel && <AddTaskPanel />}

            {/* 底部工具栏 */}
            <Toolbar
              showAddPanel={showAddPanel}
              onToggleAddPanel={() => setShowAddPanel(!showAddPanel)}
            />
          </div>

          {/* 右侧信息面板 */}
          <div className="w-80 flex flex-col gap-3 p-3 bg-bg-primary overflow-y-auto">
            {/* 连接设置和实时截图（可折叠） */}
            {sidePanelExpanded && (
              <>
                {/* 连接设置（设备/资源选择） */}
                <ConnectionPanel />

                {/* 实时截图 */}
                <ScreenshotPanel />
              </>
            )}

            {/* 运行日志 */}
            <LogsPanel />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
