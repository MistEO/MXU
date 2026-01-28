import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore, type DownloadProgress } from '@/stores/appStore';
import {
  TitleBar,
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
  InstallConfirmModal,
  VCRedistModal,
  OnboardingOverlay,
  BadPathModal,
} from '@/components';
import type { BadPathType } from '@/components';
import {
  autoLoadInterface,
  loadConfig,
  loadConfigFromStorage,
  resolveI18nText,
  checkAndPrepareDownload,
  maaService,
  shouldUseProxy,
} from '@/services';
import {
  downloadUpdate,
  getUpdateSavePath,
  consumeUpdateCompleteInfo,
  savePendingUpdateInfo,
  getPendingUpdateInfo,
  clearPendingUpdateInfo,
  isDebugVersion,
} from '@/services/updateService';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { loggers } from '@/utils/logger';
import { useMaaCallbackLogger, useMaaAgentLogger } from '@/utils/useMaaCallbackLogger';
import { getInterfaceLangKey } from '@/i18n';
import { applyTheme, resolveThemeMode } from '@/themes';

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

// 最小窗口尺寸
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 500;

// 左侧面板最小宽度（确保工具栏按钮文字不换行）
const MIN_LEFT_PANEL_WIDTH = 530;

/**
 * 验证窗口尺寸是否有效
 */
function isValidWindowSize(width: number, height: number): boolean {
  return width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT;
}

/**
 * 设置窗口大小
 */
async function setWindowSize(width: number, height: number) {
  if (!isValidWindowSize(width, height)) {
    log.warn('窗口大小无效，跳过设置:', { width, height });
    return;
  }

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

// 页面过渡动画时长（ms）
const PAGE_TRANSITION_DURATION = 120;

function App() {
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [versionWarning, setVersionWarning] = useState<{ current: string; minimum: string } | null>(
    null,
  );
  const [showVCRedistModal, setShowVCRedistModal] = useState(false);
  const [showBadPathModal, setShowBadPathModal] = useState(false);
  const [badPathType, setBadPathType] = useState<BadPathType>('root');

  // 页面过渡状态
  const [isSettingsExiting, setIsSettingsExiting] = useState(false);
  const [isDashboardExiting, setIsDashboardExiting] = useState(false);

  const { t } = useTranslation();

  // 启用 MAA 回调日志监听
  useMaaCallbackLogger();
  useMaaAgentLogger();

  const {
    setProjectInterface,
    setInterfaceTranslations,
    setBasePath,
    basePath,
    importConfig,
    createInstance,
    theme,
    currentPage,
    setCurrentPage,
    projectInterface,
    interfaceTranslations,
    language,
    sidePanelExpanded,
    dashboardView,
    setDashboardView,
    setWindowSize: setWindowSizeStore,
    setUpdateInfo,
    restoreBackendStates,
    setDownloadStatus,
    setDownloadProgress,
    setDownloadSavePath,
    setJustUpdatedInfo,
    setShowInstallConfirmModal,
    updateInfo,
    downloadStatus,
    setShowUpdateDialog,
    showAddTaskPanel,
    setShowAddTaskPanel,
    rightPanelWidth,
    rightPanelCollapsed,
    setRightPanelWidth: _setRightPanelWidth,
    setRightPanelCollapsed: _setRightPanelCollapsed,
  } = useAppStore();

  // 带退出动画的设置页面关闭
  const closeSettingsWithAnimation = useCallback(() => {
    setIsSettingsExiting(true);
    setTimeout(() => {
      setCurrentPage('main');
      setIsSettingsExiting(false);
    }, PAGE_TRANSITION_DURATION);
  }, [setCurrentPage]);

  // 带退出动画的中控台关闭
  const closeDashboardWithAnimation = useCallback(() => {
    setIsDashboardExiting(true);
    setTimeout(() => {
      setDashboardView(false);
      setIsDashboardExiting(false);
    }, PAGE_TRANSITION_DURATION);
  }, [setDashboardView]);

  const isResizingRef = useRef(false);

  // 调整右侧面板宽度
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const newWidth = document.body.clientWidth - e.clientX;
      const store = useAppStore.getState();

      if (newWidth < 160) {
        // 如果宽度小于最小宽度的一半 (160px)，折叠
        store.setRightPanelCollapsed(true);
      } else {
        // 否则展开，并更新宽度（限制在 320-最大可用宽度 之间）
        // 最大宽度 = 窗口宽度 - 左侧最小宽度 - 分隔条宽度(约4px)
        const maxWidth = Math.min(800, document.body.clientWidth - MIN_LEFT_PANEL_WIDTH - 4);
        store.setRightPanelCollapsed(false);
        const clampedWidth = Math.max(320, Math.min(maxWidth, newWidth));
        store.setRightPanelWidth(clampedWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // 防止选中文本
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const initialized = useRef(false);
  const downloadStartedRef = useRef(false);

  // 自动下载函数
  const startAutoDownload = useCallback(
    async (
      updateResult: NonNullable<Awaited<ReturnType<typeof checkAndPrepareDownload>>>,
      downloadBasePath: string,
    ) => {
      if (!updateResult.downloadUrl || downloadStartedRef.current) return;

      downloadStartedRef.current = true;
      setDownloadStatus('downloading');
      setDownloadProgress({
        downloadedSize: 0,
        totalSize: updateResult.fileSize || 0,
        speed: 0,
        progress: 0,
      });

      try {
        const savePath = await getUpdateSavePath(downloadBasePath, updateResult.filename);
        setDownloadSavePath(savePath);

        const appState = useAppStore.getState();
        // 仅在 GitHub 下载时尝试使用代理（如果配置了的话）
        const useProxy =
          updateResult.downloadSource === 'github' &&
          shouldUseProxy(appState.proxySettings, appState.mirrorChyanSettings.cdk || '');

        const success = await downloadUpdate({
          url: updateResult.downloadUrl,
          savePath,
          totalSize: updateResult.fileSize,
          proxySettings: useProxy ? appState.proxySettings : undefined,
          onProgress: (progress: DownloadProgress) => {
            setDownloadProgress(progress);
          },
        });

        if (success) {
          setDownloadStatus('completed');
          log.info('更新下载完成');

          // 保存待安装更新信息，以便下次启动时自动安装
          savePendingUpdateInfo({
            versionName: updateResult.versionName,
            releaseNote: updateResult.releaseNote,
            channel: updateResult.channel,
            downloadSavePath: savePath,
            fileSize: updateResult.fileSize,
            updateType: updateResult.updateType,
            downloadSource: updateResult.downloadSource,
            timestamp: Date.now(),
          });
        } else {
          setDownloadStatus('failed');
          // 下载失败时重置标志，允许后续重新下载（如填入 CDK 后切换下载源）
          downloadStartedRef.current = false;
          log.warn('更新下载失败');
        }
      } catch (error) {
        log.error('更新下载出错:', error);
        setDownloadStatus('failed');
        // 下载出错时也重置标志
        downloadStartedRef.current = false;
      }
    },
    [setDownloadStatus, setDownloadProgress, setDownloadSavePath],
  );

  // 设置窗口标题（根据 ProjectInterface V2 协议）
  useEffect(() => {
    if (!projectInterface) return;

    const langKey = getInterfaceLangKey(language);
    const translations = interfaceTranslations[langKey];

    // 优先使用 title 字段（支持国际化），否则使用 name + version
    // 注意：协议规定 title 默认为 name + version，不是 label + version
    let title: string;
    if (projectInterface.title) {
      title = resolveI18nText(projectInterface.title, translations);
    } else {
      const version = projectInterface.version;
      title = version ? `${projectInterface.name} ${version}` : projectInterface.name;
    }

    setWindowTitle(title);
  }, [projectInterface, language, interfaceTranslations]);

  // 设置窗口图标（根据 ProjectInterface V2 协议）
  useEffect(() => {
    if (!projectInterface?.icon || !isTauri()) return;

    const langKey = getInterfaceLangKey(language);
    const translations = interfaceTranslations[langKey];

    // icon 字段支持国际化
    const iconPath = resolveI18nText(projectInterface.icon, translations);
    if (!iconPath) return;

    // 拼接完整路径（相对于 basePath）
    const fullIconPath = `${basePath}/${iconPath}`;

    const setIcon = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        await currentWindow.setIcon(fullIconPath);
        log.info('窗口图标已设置:', fullIconPath);
      } catch (err) {
        log.warn('设置窗口图标失败:', err);
      }
    };

    setIcon();
  }, [projectInterface, language, interfaceTranslations, basePath]);

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

      // 加载用户配置（mxu-{项目名}.json）
      const projectName = result.interface.name;
      let config = await loadConfig(result.basePath, projectName);

      // 浏览器环境下，如果没有从 public 目录加载到配置，尝试从 localStorage 加载
      if (config.instances.length === 0) {
        const storageConfig = loadConfigFromStorage(projectName);
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

      // 从后端恢复 MAA 运行时状态（连接状态、资源加载状态、设备缓存等）
      try {
        const backendStates = await maaService.getAllStates();
        if (backendStates) {
          restoreBackendStates(backendStates);
          log.info('已恢复后端状态:', Object.keys(backendStates.instances).length, '个实例');
        }
      } catch (err) {
        log.warn('恢复后端状态失败:', err);
      }

      // 检查 MaaFramework 版本兼容性
      // 注意：即使完整库加载失败（旧版本缺少某些函数），版本检查仍应工作
      try {
        // 尝试初始化，即使失败也会设置 lib_dir
        try {
          await maaService.init();
        } catch (initErr) {
          log.warn('MaaFramework 初始化失败（可能是版本过低）:', initErr);
        }

        // 版本检查使用独立的版本获取，不依赖完整库加载
        const versionCheck = await maaService.checkVersion();
        if (!versionCheck.is_compatible) {
          log.warn(
            'MaaFramework 版本过低:',
            versionCheck.current,
            '< 最低要求:',
            versionCheck.minimum,
          );
          setVersionWarning({
            current: versionCheck.current,
            minimum: versionCheck.minimum,
          });
        }
      } catch (err) {
        log.warn('版本检查失败:', err);
      }

      log.info('加载完成, 项目:', result.interface.name);
      setLoadingState('success');

      // 检查是否缺少 VC++ 运行库
      checkVCRedistMissing();

      // 如果没有实例，创建一个默认实例
      setTimeout(() => {
        const currentInstances = useAppStore.getState().instances;
        if (currentInstances.length === 0) {
          createInstance(t('instance.defaultName'));
        }
      }, 0);

      // 检查是否刚更新完成（重启后）
      const updateCompleteInfo = consumeUpdateCompleteInfo();
      if (updateCompleteInfo) {
        log.info('检测到刚更新完成:', updateCompleteInfo.newVersion);
        // 清除待安装更新信息（安装已完成）
        clearPendingUpdateInfo();
        setJustUpdatedInfo({
          previousVersion: updateCompleteInfo.previousVersion,
          newVersion: updateCompleteInfo.newVersion,
          releaseNote: updateCompleteInfo.releaseNote,
          channel: updateCompleteInfo.channel,
        });
        setShowInstallConfirmModal(true);
        // 更新完成后跳过自动检查更新
        return;
      }

      // 检查是否有待安装的更新（上次下载完成但未安装）
      // 调试版本跳过待安装更新检测
      if (!isDebugVersion(result.interface.version)) {
        const pendingUpdate = await getPendingUpdateInfo();
        if (pendingUpdate) {
          log.info('检测到待安装更新:', pendingUpdate.versionName);
          // 恢复更新状态
          setUpdateInfo({
            hasUpdate: true,
            versionName: pendingUpdate.versionName,
            releaseNote: pendingUpdate.releaseNote,
            channel: pendingUpdate.channel,
            fileSize: pendingUpdate.fileSize,
            updateType: pendingUpdate.updateType,
            downloadSource: pendingUpdate.downloadSource,
          });
          setDownloadSavePath(pendingUpdate.downloadSavePath);
          setDownloadStatus('completed');
          // 显示安装确认模态框并自动开始安装
          setShowInstallConfirmModal(true);
          useAppStore.getState().setInstallStatus('installing');
          return;
        }
      }

      // 自动检查更新并下载（调试版本跳过）
      if (result.interface.mirrorchyan_rid && result.interface.version) {
        if (isDebugVersion(result.interface.version)) {
          log.info(`调试版本 (${result.interface.version})，跳过自动更新检查`);
        } else {
          const appState = useAppStore.getState();
          const downloadBasePath = appState.basePath;
          checkAndPrepareDownload({
            resourceId: result.interface.mirrorchyan_rid,
            currentVersion: result.interface.version,
            cdk: appState.mirrorChyanSettings.cdk || undefined,
            channel: appState.mirrorChyanSettings.channel,
            userAgent: 'MXU',
            githubUrl: result.interface.github,
            basePath: downloadBasePath,
          })
            .then((updateResult) => {
              if (updateResult) {
                setUpdateInfo(updateResult);
                if (updateResult.hasUpdate) {
                  log.info(`发现新版本: ${updateResult.versionName}`);
                  // 强制弹出更新气泡
                  useAppStore.getState().setShowUpdateDialog(true);
                  // 有更新且有下载链接时自动开始下载
                  if (updateResult.downloadUrl) {
                    startAutoDownload(updateResult, downloadBasePath);
                  }
                }
              }
            })
            .catch((err) => {
              log.warn('自动检查更新失败:', err);
            });
        }
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

    // 应用默认主题（包括模式和强调色）
    const { theme: initialTheme, accentColor: initialAccent } = useAppStore.getState();
    const mode = resolveThemeMode(initialTheme);
    applyTheme(mode, initialAccent);

    // 先检查程序路径，有问题就弹窗不继续加载
    const initApp = async () => {
      if (isTauri()) {
        try {
          const pathIssue = await invoke<string | null>('check_exe_path');
          if (pathIssue) {
            log.warn('检测到程序路径问题:', pathIssue);
            setBadPathType(pathIssue as BadPathType);
            setShowBadPathModal(true);
            // 路径有问题就不继续加载了
            return;
          }
        } catch (err) {
          log.warn('检查程序路径失败:', err);
        }
      }

      // 路径没问题，继续加载 interface
      loadInterface();
    };

    initApp();
  }, []);

  // 检查 VC++ 运行库缺失（在加载完成后检查）
  const checkVCRedistMissing = useCallback(async () => {
    if (!isTauri()) return;

    try {
      const missing = await invoke<boolean>('check_vcredist_missing');
      if (missing) {
        log.warn('检测到 VC++ 运行库缺失');
        setShowVCRedistModal(true);
      }
    } catch (err) {
      log.warn('检查 VC++ 运行库缺失失败:', err);
    }
  }, []);

  // 主题变化时更新 DOM
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        const mode = e.matches ? 'dark' : 'light';
        const { accentColor } = useAppStore.getState();
        applyTheme(mode, accentColor);
      }
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, [theme]);

  // 回到主界面时，根据状态弹出相应的弹窗
  useEffect(() => {
    if (currentPage === 'main') {
      // 下载完成：弹出安装模态框
      if (downloadStatus === 'completed') {
        setShowInstallConfirmModal(true);
      }
      // 有更新或正在下载：弹出更新气泡
      else if (updateInfo?.hasUpdate || downloadStatus === 'downloading') {
        setShowUpdateDialog(true);
      }
    }
  }, [
    currentPage,
    updateInfo?.hasUpdate,
    downloadStatus,
    setShowUpdateDialog,
    setShowInstallConfirmModal,
  ]);

  // 下载完成时，强制弹出安装模态框
  useEffect(() => {
    if (downloadStatus === 'completed') {
      setShowInstallConfirmModal(true);
    }
  }, [downloadStatus, setShowInstallConfirmModal]);

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
            if (size && isValidWindowSize(size.width, size.height)) {
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // 屏蔽浏览器默认快捷键 & 应用内快捷键
  const devMode = useAppStore((state) => state.devMode);

  // 生成统一的快捷键组合字符串，例如：Ctrl+Shift+F10、Alt+Enter、F10
  function getKeyCombo(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let key = e.key;
    // 过滤纯修饰键
    if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
      return parts.join('+');
    }

    // 统一大小写：Function 键保持原样，其他转大写单字母
    if (/^f\d+$/i.test(key)) {
      key = key.toUpperCase();
    } else if (key.length === 1) {
      key = key.toUpperCase();
    }

    parts.push(key);
    return parts.join('+');
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // F5 - 刷新（生产环境下，开发模式关闭时屏蔽）
      if (e.key === 'F5' && import.meta.env.PROD && !devMode) {
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd 组合键
      if (isCtrlOrMeta) {
        // Ctrl+R 刷新（生产环境下，开发模式关闭时屏蔽）
        if (e.key.toLowerCase() === 'r' && import.meta.env.PROD && !devMode) {
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

      // 应用内快捷键：开始/结束任务（默认 F10/F11，可在设置中自定义，支持组合键）
      // 使用自定义事件通知 Toolbar 组件，以复用现有启动/停止逻辑
      const combo = getKeyCombo(e);
      if (!combo) {
        return;
      }

      const { hotkeys } = useAppStore.getState();
      const startKey = hotkeys?.startTasks || 'F10';
      const stopKey = hotkeys?.stopTasks || 'F11';

      if (combo === startKey) {
        e.preventDefault();
        document.dispatchEvent(new Event('mxu-start-tasks'));
        return;
      }

      if (combo === stopKey) {
        e.preventDefault();
        document.dispatchEvent(new Event('mxu-stop-tasks'));
        return;
      }

      // F12 - 开发者工具（生产环境屏蔽）
      if (e.key === 'F12' && import.meta.env.PROD) {
        e.preventDefault();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [devMode]);

  // 设置页面
  if (currentPage === 'settings') {
    return (
      <div className="h-full flex flex-col bg-bg-primary">
        <TitleBar />
        {/* 安装确认模态框 - 在设置页面也需要能弹出 */}
        <InstallConfirmModal />
        <div
          key="settings-page"
          className={`flex-1 min-h-0 flex flex-col ${isSettingsExiting ? 'page-slide-right-exit' : 'page-slide-right-enter'}`}
        >
          <SettingsPage onClose={closeSettingsWithAnimation} />
        </div>
      </div>
    );
  }

  // 计算显示标题（根据 ProjectInterface V2 协议）
  const getDisplayTitle = () => {
    if (!projectInterface) return { title: 'MXU', subtitle: 'MaaFramework 下一代通用 GUI' };

    const langKey = getInterfaceLangKey(language);
    const translations = interfaceTranslations[langKey];

    // 优先使用 title 字段（支持国际化），否则使用 name + version
    // 注意：协议规定 title 默认为 name + version，不是 label + version
    let title: string;
    if (projectInterface.title) {
      title = resolveI18nText(projectInterface.title, translations);
    } else {
      const version = projectInterface.version;
      title = version ? `${projectInterface.name} v${version}` : projectInterface.name;
    }

    // 副标题：使用 description（支持国际化）或默认
    const subtitle = projectInterface.description
      ? resolveI18nText(projectInterface.description, translations)
      : 'MaaFramework 下一代通用 GUI';

    return { title, subtitle };
  };

  // 加载中或错误状态
  if (loadingState !== 'success' || !projectInterface) {
    const { title: displayTitle, subtitle: displaySubtitle } = getDisplayTitle();

    return (
      <div className="h-full flex flex-col bg-bg-primary">
        <TitleBar />

        {/* 程序路径问题提示模态框 - 在加载阶段也需要能弹出 */}
        <BadPathModal show={showBadPathModal} type={badPathType} />

        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="max-w-md w-full space-y-6 text-center">
            {/* Logo/标题 */}
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-text-primary">{displayTitle}</h1>
              <p className="text-text-secondary">{displaySubtitle}</p>
            </div>

            {/* 加载状态 - 路径检查中或正常加载中 */}
            {loadingState === 'loading' && !showBadPathModal && (
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
      </div>
    );
  }

  // 主页面
  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* 自定义标题栏 */}
      <TitleBar />

      {/* 欢迎弹窗 */}
      <WelcomeDialog />

      {/* 新用户引导覆盖层 - 仅在右侧面板可见时显示 */}
      {!rightPanelCollapsed && !dashboardView && <OnboardingOverlay />}

      {/* 安装确认模态框 */}
      <InstallConfirmModal />

      {/* VC++ 运行库缺失提示模态框 */}
      <VCRedistModal show={showVCRedistModal} onClose={() => setShowVCRedistModal(false)} />

      {/* 程序路径问题提示模态框 */}
      <BadPathModal show={showBadPathModal} type={badPathType} />

      {/* MaaFramework 版本警告弹窗 */}
      {versionWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setVersionWarning(null)}
          />
          <div className="relative bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
              <AlertCircle className="w-6 h-6 text-amber-500" />
              <h2 className="text-lg font-semibold text-text-primary">
                {t('versionWarning.title')}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-text-secondary">
                {t('versionWarning.message', {
                  current: versionWarning.current,
                  minimum: versionWarning.minimum,
                })}
              </p>
              <p className="text-text-secondary text-sm">{t('versionWarning.suggestion')}</p>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-border">
              <button
                onClick={() => setVersionWarning(null)}
                className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
              >
                {t('versionWarning.understand')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部标签栏 */}
      <TabBar />

      {/* 中控台视图 */}
      {dashboardView ? (
        <div
          key="dashboard-view"
          className={`flex-1 min-h-0 ${isDashboardExiting ? 'page-slide-top-exit' : 'page-slide-top-enter'}`}
        >
          <DashboardView onClose={closeDashboardWithAnimation} />
        </div>
      ) : (
        /* 主内容区 */
        <div key="main-view" className="flex-1 flex overflow-hidden">
          {/* 左侧任务列表区 */}
          <div
            className="flex-1 flex flex-col border-r border-border"
            style={{ minWidth: MIN_LEFT_PANEL_WIDTH }}
          >
            {/* 任务列表 */}
            <TaskList />

            {/* 添加任务面板 - 使用 grid 动画实现平滑展开/折叠 */}
            <div
              className="grid transition-[grid-template-rows] duration-150 ease-out"
              style={{ gridTemplateRows: showAddTaskPanel ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden min-h-0">
                <AddTaskPanel />
              </div>
            </div>

            {/* 底部工具栏 */}
            <Toolbar
              showAddPanel={showAddTaskPanel}
              onToggleAddPanel={() => setShowAddTaskPanel(!showAddTaskPanel)}
            />
          </div>

          {/* 分隔条 Resizer */}
          <div
            className={`${rightPanelCollapsed ? 'w-4' : 'w-1'} hover:bg-accent/50 cursor-col-resize flex items-center justify-center group shrink-0 transition-all select-none bg-transparent`}
            onMouseDown={handleResizeStart}
            title={t('common.resizeOrCollapse', '拖动调整宽度，向右拖动到底可折叠')}
          >
            {/* 可视化把手 */}
            <div className="w-[2px] h-8 rounded-full transition-colors bg-border group-hover:bg-accent" />
          </div>

          {/* 右侧信息面板 */}
          {!rightPanelCollapsed && (
            <div
              className={`flex flex-col p-3 bg-bg-primary overflow-y-auto overflow-x-hidden border-l border-transparent ${sidePanelExpanded ? 'gap-3' : ''}`}
              style={{
                width: rightPanelWidth,
                minWidth: 240,
                // 允许收缩但保持最小宽度，确保窗口缩小时不被裁切
                flexShrink: 1,
              }}
            >
              {/* 连接设置和实时截图（可折叠）- 使用 grid 动画 */}
              <div
                className="grid transition-[grid-template-rows] duration-150 ease-out"
                style={{ gridTemplateRows: sidePanelExpanded ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden min-h-0 flex flex-col gap-3">
                  {/* 连接设置（设备/资源选择） */}
                  <ConnectionPanel />

                  {/* 实时截图 */}
                  <ScreenshotPanel />
                </div>
              </div>

              {/* 运行日志 */}
              <LogsPanel />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
