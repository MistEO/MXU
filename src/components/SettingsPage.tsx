import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Globe,
  Palette,
  Mail,
  FileText,
  Loader2,
  Bug,
  RefreshCw,
  Maximize2,
  Download,
  Key,
  ExternalLink,
  Eye,
  EyeOff,
  ListChecks,
  AlertCircle,
  AlertTriangle,
  PackageCheck,
  FolderOpen,
  ScrollText,
  Trash2,
  Paintbrush,
  Info,
} from 'lucide-react';
import {
  checkAndPrepareDownload,
  openMirrorChyanWebsite,
  downloadUpdate,
  getUpdateSavePath,
  cancelDownload,
  MIRRORCHYAN_ERROR_CODES,
  isDebugVersion,
} from '@/services/updateService';
import { clearAllCache, getCacheStats } from '@/services/cacheService';
import type { DownloadProgress } from '@/stores/appStore';
import { defaultWindowSize } from '@/types/config';
import { useAppStore } from '@/stores/appStore';
import { setLanguage as setI18nLanguage, getInterfaceLangKey } from '@/i18n';
import { getAccentInfoList, type AccentColor } from '@/themes';
import {
  resolveContent,
  loadIconAsDataUrl,
  simpleMarkdownToHtml,
  resolveI18nText,
} from '@/services/contentResolver';
import { maaService } from '@/services/maaService';
import { ReleaseNotes, DownloadProgressBar } from './UpdateInfoCard';
import { loggers } from '@/utils/logger';
import { FrameRateSelector } from './FrameRateSelector';
import clsx from 'clsx';

// 检测是否在 Tauri 环境中
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

interface ResolvedContent {
  description: string;
  license: string;
  contact: string;
  iconPath: string | undefined;
}

interface SettingsPageProps {
  onClose?: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    language,
    setLanguage,
    setCurrentPage,
    projectInterface,
    interfaceTranslations,
    basePath,
    mirrorChyanSettings,
    setMirrorChyanCdk,
    setMirrorChyanChannel,
    updateInfo,
    updateCheckLoading,
    setUpdateInfo,
    setUpdateCheckLoading,
    setShowUpdateDialog,
    showOptionPreview,
    setShowOptionPreview,
    devMode,
    setDevMode,
    saveDraw,
    setSaveDraw,
    downloadStatus,
    downloadProgress,
    setDownloadStatus,
    setDownloadProgress,
    setDownloadSavePath,
    resetDownloadState,
    installStatus,
    setInstallStatus,
    setShowInstallConfirmModal,
    setRightPanelWidth,
    setRightPanelCollapsed,
  } = useAppStore();

  // 获取强调色列表
  const accentColors = useMemo(() => getAccentInfoList(language), [language]);

  const [resolvedContent, setResolvedContent] = useState<ResolvedContent>({
    description: '',
    license: '',
    contact: '',
    iconPath: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [, setDebugLog] = useState<string[]>([]);
  const [mxuVersion, setMxuVersion] = useState<string | null>(null);
  const [maafwVersion, setMaafwVersion] = useState<string | null>(null);
  const [showCdk, setShowCdk] = useState(false);
  const [exeDir, setExeDir] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);

  // 调试：添加日志（提前定义以便在 handleCdkChange 中使用）
  const addDebugLog = useCallback((msg: string) => {
    setDebugLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // 开始下载（支持指定 updateInfo，用于切换下载源后重新下载）
  const startDownload = useCallback(
    async (targetUpdateInfo?: typeof updateInfo) => {
      const info = targetUpdateInfo || updateInfo;
      if (!info?.downloadUrl) return;

      setDownloadStatus('downloading');
      setDownloadProgress({
        downloadedSize: 0,
        totalSize: info.fileSize || 0,
        speed: 0,
        progress: 0,
      });

      try {
        const savePath = await getUpdateSavePath(basePath, info.filename);
        setDownloadSavePath(savePath);

        const success = await downloadUpdate({
          url: info.downloadUrl,
          savePath,
          totalSize: info.fileSize,
          onProgress: (progress: DownloadProgress) => {
            setDownloadProgress(progress);
          },
        });

        if (success) {
          setDownloadStatus('completed');
        } else {
          setDownloadStatus('failed');
        }
      } catch (error) {
        loggers.ui.error('下载失败:', error);
        setDownloadStatus('failed');
      }
    },
    [updateInfo, basePath, setDownloadStatus, setDownloadProgress, setDownloadSavePath],
  );

  // 处理 CDK 变化：如果正在使用 GitHub 下载或下载失败，尝试切换到 Mirror酱
  const handleCdkChange = useCallback(
    async (newCdk: string) => {
      const previousCdk = mirrorChyanSettings.cdk;
      setMirrorChyanCdk(newCdk);

      // 检测：从空 CDK 变为有效 CDK
      const isEnteringCdk = !previousCdk && newCdk.trim().length > 0;

      // 需要尝试切换到 Mirror酱 的场景：
      // 1. 正在使用 GitHub 下载
      // 2. 下载失败（可能是 GitHub 下载失败）
      // 3. 有更新但没有下载链接（可能是之前没有 CDK 导致无法获取 Mirror酱 链接）
      // 4. 有更新且使用 GitHub 但还在准备下载（可能是 GitHub 连接不上一直卡住）
      // 5. 还没有更新信息（可能是启动时检查更新请求还在进行或失败了）
      const isDownloadingFromGitHub =
        downloadStatus === 'downloading' && updateInfo?.downloadSource === 'github';
      const isDownloadFailed = downloadStatus === 'failed';
      const hasUpdateButNoUrl = updateInfo?.hasUpdate && !updateInfo?.downloadUrl;
      const isPendingGitHubDownload =
        downloadStatus === 'idle' &&
        updateInfo?.hasUpdate &&
        updateInfo?.downloadUrl &&
        updateInfo?.downloadSource === 'github';
      const noUpdateInfoYet = !updateInfo && downloadStatus === 'idle';

      const shouldTryMirrorChyan =
        isEnteringCdk &&
        projectInterface?.mirrorchyan_rid &&
        (isDownloadingFromGitHub ||
          isDownloadFailed ||
          hasUpdateButNoUrl ||
          isPendingGitHubDownload ||
          noUpdateInfoYet);

      if (shouldTryMirrorChyan) {
        if (isDownloadingFromGitHub) {
          addDebugLog('检测到填入 CDK，正在停止 GitHub 下载并切换到 Mirror酱...');
          // 取消当前下载并等待完成
          await cancelDownload();
        } else if (isDownloadFailed) {
          addDebugLog('检测到填入 CDK，下载之前失败，尝试使用 Mirror酱 重新下载...');
        } else if (isPendingGitHubDownload) {
          addDebugLog('检测到填入 CDK，GitHub 下载等待中，切换到 Mirror酱...');
        } else if (noUpdateInfoYet) {
          addDebugLog('检测到填入 CDK，尚未获取到更新信息，使用 Mirror酱 检查更新...');
        } else {
          addDebugLog('检测到填入 CDK，尝试获取 Mirror酱 下载链接...');
        }

        resetDownloadState();

        // 使用新 CDK 重新检查更新
        setUpdateCheckLoading(true);
        try {
          const result = await checkAndPrepareDownload({
            resourceId: projectInterface!.mirrorchyan_rid!,
            currentVersion: projectInterface!.version || '',
            cdk: newCdk,
            channel: mirrorChyanSettings.channel,
            userAgent: 'MXU',
            githubUrl: projectInterface!.github,
            basePath,
          });

          if (result) {
            setUpdateInfo(result);
            if (result.hasUpdate && result.downloadUrl && result.downloadSource === 'mirrorchyan') {
              addDebugLog(`已切换到 Mirror酱 下载: ${result.versionName}`);
              // 自动开始新的下载
              await startDownload(result);
            } else if (result.hasUpdate && result.downloadUrl) {
              addDebugLog(`CDK 无效或不匹配，继续使用 ${result.downloadSource} 下载`);
              await startDownload(result);
            } else {
              addDebugLog('无法获取 Mirror酱 下载链接，请检查 CDK');
            }
          }
        } catch (err) {
          addDebugLog(`切换下载源失败: ${err}`);
        } finally {
          setUpdateCheckLoading(false);
        }
      }
    },
    [
      mirrorChyanSettings.cdk,
      mirrorChyanSettings.channel,
      setMirrorChyanCdk,
      downloadStatus,
      updateInfo,
      projectInterface,
      basePath,
      resetDownloadState,
      setUpdateCheckLoading,
      setUpdateInfo,
      startDownload,
      addDebugLog,
    ],
  );

  // 打开模态框并自动开始安装
  const handleInstallNow = useCallback(() => {
    setShowInstallConfirmModal(true);
    setInstallStatus('installing');
  }, [setShowInstallConfirmModal, setInstallStatus]);

  // 获取错误码对应的翻译文本
  const errorText = useMemo(() => {
    if (!updateInfo?.errorCode) return null;
    const code = updateInfo.errorCode;

    if (code < 0) {
      return t('mirrorChyan.errors.negative');
    }

    const knownCodes = [1001, 7001, 7002, 7003, 7004, 7005, 8001, 8002, 8003, 8004, 1];
    if (knownCodes.includes(code)) {
      return t(`mirrorChyan.errors.${code}`);
    }

    return t('mirrorChyan.errors.unknown', {
      code,
      message: updateInfo.errorMessage || '',
    });
  }, [updateInfo?.errorCode, updateInfo?.errorMessage, t]);

  // 判断是否为 CDK 相关错误
  const isCdkError = useMemo(() => {
    if (!updateInfo?.errorCode) return false;
    const cdkErrorCodes: number[] = [
      MIRRORCHYAN_ERROR_CODES.KEY_EXPIRED,
      MIRRORCHYAN_ERROR_CODES.KEY_INVALID,
      MIRRORCHYAN_ERROR_CODES.RESOURCE_QUOTA_EXHAUSTED,
      MIRRORCHYAN_ERROR_CODES.KEY_MISMATCHED,
      MIRRORCHYAN_ERROR_CODES.KEY_BLOCKED,
    ];
    return cdkErrorCodes.includes(updateInfo.errorCode);
  }, [updateInfo?.errorCode]);

  // 判断是否为调试版本（DEBUG_VERSION 或 < v1.0.0），调试版本不进行自动更新
  const isDebugMode = useMemo(() => {
    return isDebugVersion(projectInterface?.version);
  }, [projectInterface?.version]);

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  // 版本信息（用于调试展示）
  useEffect(() => {
    const loadVersions = async () => {
      // mxu 版本
      if (isTauri()) {
        try {
          const { getVersion } = await import('@tauri-apps/api/app');
          setMxuVersion(await getVersion());
        } catch {
          setMxuVersion(__MXU_VERSION__ || null);
        }
      } else {
        setMxuVersion(__MXU_VERSION__ || null);
      }

      // maafw 版本（仅在 Tauri 环境有意义）
      if (isTauri()) {
        try {
          setMaafwVersion(await maaService.getVersion());
        } catch {
          setMaafwVersion(null);
        }
      } else {
        setMaafwVersion(null);
      }

      // 路径信息（仅在 Tauri 环境有意义）
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const [exeDirResult, cwdResult] = await Promise.all([
            invoke<string>('get_exe_dir'),
            invoke<string>('get_cwd'),
          ]);
          setExeDir(exeDirResult);
          setCwd(cwdResult);
        } catch {
          setExeDir(null);
          setCwd(null);
        }
      }
    };

    loadVersions();
  }, []);

  // 解析内容（支持文件路径、URL、国际化）
  useEffect(() => {
    if (!projectInterface) return;

    const loadContent = async () => {
      setIsLoading(true);

      const options = { translations, basePath };

      const [description, license, contact, iconPath] = await Promise.all([
        resolveContent(projectInterface.description, options),
        resolveContent(projectInterface.license, options),
        resolveContent(projectInterface.contact, options),
        loadIconAsDataUrl(projectInterface.icon, basePath, translations),
      ]);

      setResolvedContent({ description, license, contact, iconPath });
      setIsLoading(false);
    };

    loadContent();
  }, [projectInterface, langKey, basePath, translations]);

  const handleLanguageChange = (lang: 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR') => {
    setLanguage(lang);
    setI18nLanguage(lang);
  };

  // 检查更新
  const handleCheckUpdate = async () => {
    if (!projectInterface?.mirrorchyan_rid || !projectInterface?.version) {
      addDebugLog('未配置 mirrorchyan_rid 或 version，无法检查更新');
      return;
    }

    setUpdateCheckLoading(true);
    addDebugLog(`开始检查更新... (频道: ${mirrorChyanSettings.channel})`);

    try {
      const result = await checkAndPrepareDownload({
        resourceId: projectInterface.mirrorchyan_rid,
        currentVersion: projectInterface.version,
        cdk: mirrorChyanSettings.cdk || undefined,
        channel: mirrorChyanSettings.channel,
        userAgent: 'MXU',
        githubUrl: projectInterface.github,
        basePath,
      });

      if (result) {
        setUpdateInfo(result);
        if (result.hasUpdate) {
          addDebugLog(`发现新版本: ${result.versionName}`);
          if (result.downloadUrl) {
            addDebugLog(
              `下载来源: ${result.downloadSource === 'github' ? 'GitHub' : 'Mirror酱 CDN'}`,
            );
          } else {
            addDebugLog('无可用下载链接');
          }
          setShowUpdateDialog(true);
        } else {
          addDebugLog(`当前已是最新版本: ${result.versionName}`);
        }
      } else {
        addDebugLog('检查更新失败');
      }
    } catch (err) {
      addDebugLog(`检查更新出错: ${err}`);
    } finally {
      setUpdateCheckLoading(false);
    }
  };

  // 调试：重置窗口尺寸
  const handleResetWindowSize = async () => {
    if (!isTauri()) {
      addDebugLog('仅 Tauri 环境支持重置窗口尺寸');
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const currentWindow = getCurrentWindow();
      await currentWindow.setSize(
        new LogicalSize(defaultWindowSize.width, defaultWindowSize.height),
      );

      // 同时也重置右侧面板尺寸和状态
      setRightPanelWidth(320);
      setRightPanelCollapsed(false);

      addDebugLog(
        `窗口尺寸已重置为 ${defaultWindowSize.width}x${defaultWindowSize.height}，界面布局已重置`,
      );
    } catch (err) {
      addDebugLog(`重置窗口尺寸失败: ${err}`);
    }
  };

  // 调试：打开配置目录
  const handleOpenConfigDir = async () => {
    if (!isTauri() || !basePath) {
      loggers.ui.warn('仅 Tauri 环境支持打开目录, basePath:', basePath);
      return;
    }

    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const { join } = await import('@tauri-apps/api/path');
      const configPath = await join(basePath, 'config');
      loggers.ui.info('打开配置目录:', configPath);
      await openPath(configPath);
    } catch (err) {
      loggers.ui.error('打开配置目录失败:', err);
    }
  };

  // 调试：打开日志目录
  const handleOpenLogDir = async () => {
    if (!isTauri() || !basePath) {
      loggers.ui.warn('仅 Tauri 环境支持打开目录, basePath:', basePath);
      return;
    }

    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const { join } = await import('@tauri-apps/api/path');
      const logPath = await join(basePath, 'debug');
      loggers.ui.info('打开日志目录:', logPath);
      await openPath(logPath);
    } catch (err) {
      loggers.ui.error('打开日志目录失败:', err);
    }
  };

  // 缓存统计信息
  const [cacheEntryCount, setCacheEntryCount] = useState<number | null>(null);

  // 加载缓存统计
  useEffect(() => {
    if (isTauri() && basePath) {
      getCacheStats(basePath).then((stats) => {
        setCacheEntryCount(stats.entryCount);
      });
    }
  }, [basePath]);

  // 调试：清空缓存
  const handleClearCache = async () => {
    if (!isTauri() || !basePath) {
      addDebugLog('仅 Tauri 环境支持清空缓存');
      return;
    }

    try {
      await clearAllCache(basePath);
      setCacheEntryCount(0);
      addDebugLog('缓存已清空');
    } catch (err) {
      addDebugLog(`清空缓存失败: ${err}`);
    }
  };

  const projectName =
    resolveI18nText(projectInterface?.label, translations) || projectInterface?.name || 'MXU';
  const version = projectInterface?.version || '0.1.0';
  // 渲染 Markdown 内容
  const renderMarkdown = (content: string) => {
    if (!content) return null;
    return (
      <div
        className="text-sm text-text-secondary prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(content) }}
      />
    );
  };

  // 目录索引配置
  const tocItems = useMemo(() => {
    const items = [{ id: 'appearance', icon: Paintbrush, labelKey: 'settings.appearance' }];
    // 仅在配置了 mirrorchyan_rid 时显示软件更新
    if (projectInterface?.mirrorchyan_rid) {
      items.push({ id: 'update', icon: Download, labelKey: 'mirrorChyan.title' });
    }
    items.push(
      { id: 'debug', icon: Bug, labelKey: 'debug.title' },
      { id: 'about', icon: Info, labelKey: 'about.title' },
    );
    return items;
  }, [projectInterface?.mirrorchyan_rid]);

  // 当前高亮的 section
  const [activeSection, setActiveSection] = useState('appearance');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 滚动到指定 section
  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(`section-${sectionId}`);
    if (element && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const elementTop = element.offsetTop - container.offsetTop;
      container.scrollTo({
        top: elementTop - 16, // 留出一点顶部间距
        behavior: 'smooth',
      });
    }
  }, []);

  // 监听滚动，更新当前高亮的 section
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const sections = tocItems
        .map((item) => ({
          id: item.id,
          element: document.getElementById(`section-${item.id}`),
        }))
        .filter((s) => s.element);

      // 找到当前视口中的 section
      const scrollTop = container.scrollTop;

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section.element) {
          const sectionTop = section.element.offsetTop - container.offsetTop;
          if (scrollTop >= sectionTop - 100) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [tocItems]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg-primary">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button
          onClick={onClose ?? (() => setCurrentPage('main'))}
          className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="text-lg font-semibold text-text-primary">{t('settings.title')}</h1>
      </div>

      {/* 主体区域：左侧目录 + 右侧内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧固定目录索引 */}
        <nav className="w-40 flex-shrink-0 bg-bg-secondary border-r border-border p-4 space-y-1">
          {tocItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* 右侧设置内容 */}
        <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <div className="max-w-2xl mx-auto p-6 space-y-8">
            {/* 外观设置 */}
            <section id="section-appearance" className="space-y-4 scroll-mt-4">
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                <Paintbrush className="w-4 h-4" />
                {t('settings.appearance')}
              </h2>

              {/* 语言 */}
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center gap-3 mb-3">
                  <Globe className="w-5 h-5 text-accent" />
                  <span className="font-medium text-text-primary">{t('settings.language')}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleLanguageChange('zh-CN')}
                    className={clsx(
                      'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      language === 'zh-CN'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    简体中文
                  </button>
                  <button
                    onClick={() => handleLanguageChange('zh-TW')}
                    className={clsx(
                      'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      language === 'zh-TW'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    繁體中文
                  </button>
                  <button
                    onClick={() => handleLanguageChange('en-US')}
                    className={clsx(
                      'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      language === 'en-US'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    English
                  </button>
                  <button
                    onClick={() => handleLanguageChange('ja-JP')}
                    className={clsx(
                      'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      language === 'ja-JP'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    日本語
                  </button>
                  <button
                    onClick={() => handleLanguageChange('ko-KR')}
                    className={clsx(
                      'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      language === 'ko-KR'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    한국어
                  </button>
                </div>
              </div>

              {/* 主题 */}
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center gap-3 mb-3">
                  <Palette className="w-5 h-5 text-accent" />
                  <span className="font-medium text-text-primary">{t('settings.theme')}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTheme('system')}
                    className={clsx(
                      'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      theme === 'system'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    {t('settings.themeSystem')}
                  </button>
                  <button
                    onClick={() => setTheme('light')}
                    className={clsx(
                      'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      theme === 'light'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    {t('settings.themeLight')}
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={clsx(
                      'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      theme === 'dark'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                    )}
                  >
                    {t('settings.themeDark')}
                  </button>
                </div>
              </div>

              {/* 强调色 */}
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center gap-3 mb-3">
                  <Palette className="w-5 h-5 text-accent" />
                  <span className="font-medium text-text-primary">{t('settings.accentColor')}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {accentColors.map((accent) => (
                    <button
                      key={accent.name}
                      onClick={() => setAccentColor(accent.name as AccentColor)}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        accentColor === accent.name
                          ? 'ring-2 ring-offset-2 ring-offset-bg-secondary'
                          : 'hover:bg-bg-hover',
                        'bg-bg-tertiary',
                      )}
                      style={
                        // 选中时使用该颜色作为 ring 颜色
                        accentColor === accent.name
                          ? ({ '--tw-ring-color': accent.color } as React.CSSProperties)
                          : undefined
                      }
                    >
                      <span
                        className="w-4 h-4 rounded-full flex-shrink-0 border border-border-strong"
                        style={{ backgroundColor: accent.color }}
                      />
                      <span className="truncate text-text-secondary">{accent.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 选项预览 */}
              <div className="bg-bg-secondary rounded-xl p-4 border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ListChecks className="w-5 h-5 text-accent" />
                    <div>
                      <span className="font-medium text-text-primary">
                        {t('settings.showOptionPreview')}
                      </span>
                      <p className="text-xs text-text-muted mt-0.5">
                        {t('settings.showOptionPreviewHint')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowOptionPreview(!showOptionPreview)}
                    className={clsx(
                      'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                      showOptionPreview ? 'bg-accent' : 'bg-bg-active',
                    )}
                  >
                    <span
                      className={clsx(
                        'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                        showOptionPreview ? 'translate-x-5' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>
              </div>

              {/* 实时截图帧率 */}
              <FrameRateSelector />
            </section>

            {/* MirrorChyan 更新设置 */}
            {projectInterface?.mirrorchyan_rid && (
              <section id="section-update" className="space-y-4 scroll-mt-4">
                <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  {t('mirrorChyan.title')}
                </h2>

                <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-5">
                  {/* 调试模式提示 */}
                  {isDebugMode ? (
                    <div className="flex items-center gap-3 py-2 text-text-muted">
                      <Bug className="w-5 h-5 text-warning" />
                      <span className="text-sm">{t('mirrorChyan.debugModeNotice')}</span>
                    </div>
                  ) : (
                    <>
                      {/* 更新频道 */}
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <Download className="w-5 h-5 text-accent" />
                          <span className="font-medium text-text-primary">
                            {t('mirrorChyan.channel')}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setMirrorChyanChannel('stable')}
                            className={clsx(
                              'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                              mirrorChyanSettings.channel === 'stable'
                                ? 'bg-accent text-white'
                                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                            )}
                          >
                            {t('mirrorChyan.channelStable')}
                          </button>
                          <button
                            onClick={() => setMirrorChyanChannel('beta')}
                            className={clsx(
                              'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                              mirrorChyanSettings.channel === 'beta'
                                ? 'bg-accent text-white'
                                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                            )}
                          >
                            {t('mirrorChyan.channelBeta')}
                          </button>
                        </div>
                      </div>

                      {/* CDK 输入 */}
                      <div className="pt-4 border-t border-border">
                        <div className="flex items-center gap-3 mb-3">
                          <Key className="w-5 h-5 text-accent" />
                          <span className="font-medium text-text-primary">
                            {t('mirrorChyan.cdk')}
                          </span>
                          <button
                            onClick={() => openMirrorChyanWebsite('mxu_settings')}
                            className="ml-auto text-xs text-accent hover:underline flex items-center gap-1"
                          >
                            {t('mirrorChyan.getCdk')}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showCdk ? 'text' : 'password'}
                            value={mirrorChyanSettings.cdk}
                            onChange={(e) => handleCdkChange(e.target.value)}
                            placeholder={t('mirrorChyan.cdkPlaceholder')}
                            className="w-full px-3 py-2.5 pr-10 rounded-lg bg-bg-tertiary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                          />
                          <button
                            onClick={() => setShowCdk(!showCdk)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-secondary transition-colors"
                          >
                            {showCdk ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <div className="mt-3 text-xs text-text-muted leading-relaxed">
                          <p>
                            <button
                              onClick={() => openMirrorChyanWebsite('mxu_settings_hint')}
                              className="text-accent hover:underline"
                            >
                              {t('mirrorChyan.serviceName')}
                            </button>
                            {t('mirrorChyan.cdkHintAfterLink', { projectName })}
                          </p>
                        </div>
                      </div>

                      {/* 检查更新按钮 */}
                      <div className="pt-4 border-t border-border space-y-4">
                        {/* 正在下载时隐藏检查更新按钮 */}
                        {downloadStatus === 'downloading' ? (
                          <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-tertiary text-text-muted">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('mirrorChyan.downloading')}
                          </div>
                        ) : downloadStatus === 'completed' && installStatus === 'idle' ? (
                          /* 下载完成等待安装，显示立即安装按钮 */
                          <button
                            onClick={handleInstallNow}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
                          >
                            <PackageCheck className="w-4 h-4" />
                            {t('mirrorChyan.installNow')}
                          </button>
                        ) : (
                          /* 默认检查更新按钮 */
                          <button
                            onClick={handleCheckUpdate}
                            disabled={updateCheckLoading}
                            className={clsx(
                              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                              updateCheckLoading
                                ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                                : 'bg-accent text-white hover:bg-accent-hover',
                            )}
                          >
                            {updateCheckLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t('mirrorChyan.checking')}
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-4 h-4" />
                                {t('mirrorChyan.checkUpdate')}
                              </>
                            )}
                          </button>
                        )}

                        {/* 更新状态显示 */}
                        {updateInfo && !updateInfo.hasUpdate && !updateInfo.errorCode && (
                          <p className="text-xs text-center text-text-muted">
                            {t('mirrorChyan.upToDate', { version: updateInfo.versionName })}
                          </p>
                        )}

                        {/* 有更新时显示更新内容和下载进度 */}
                        {updateInfo?.hasUpdate && (
                          <div className="space-y-4 p-4 bg-bg-tertiary rounded-lg border border-border">
                            {/* 新版本标题 */}
                            <div className="flex items-center gap-2">
                              <Download className="w-4 h-4 text-accent" />
                              <span className="text-sm font-medium text-text-primary">
                                {t('mirrorChyan.newVersion')}
                              </span>
                              <span className="font-mono text-sm text-accent font-semibold">
                                {updateInfo.versionName}
                              </span>
                              {updateInfo.channel && updateInfo.channel !== 'stable' && (
                                <span className="px-1.5 py-0.5 bg-warning/20 text-warning text-xs rounded font-medium">
                                  {updateInfo.channel}
                                </span>
                              )}
                            </div>

                            {/* 更新日志 */}
                            {updateInfo.releaseNote && (
                              <ReleaseNotes
                                releaseNote={updateInfo.releaseNote}
                                collapsibleTitle
                                maxHeightClass="max-h-32"
                                bgClass="bg-bg-secondary"
                                textSizeClass="text-xs"
                              />
                            )}

                            {/* API 错误提示 */}
                            {updateInfo.errorCode && errorText && (
                              <div
                                className={clsx(
                                  'flex items-start gap-2 p-2 rounded-lg text-xs',
                                  isCdkError
                                    ? 'bg-warning/10 text-warning'
                                    : 'bg-error/10 text-error',
                                )}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <span>{errorText}</span>
                              </div>
                            )}

                            {/* 没有下载链接的提示 */}
                            {!updateInfo.downloadUrl && !updateInfo.errorCode && (
                              <div className="flex items-center gap-2 text-xs text-text-muted">
                                <AlertCircle className="w-3.5 h-3.5 text-warning" />
                                <span>{t('mirrorChyan.noDownloadUrl')}</span>
                              </div>
                            )}

                            {/* 下载进度 */}
                            {updateInfo.downloadUrl && downloadStatus !== 'idle' && (
                              <DownloadProgressBar
                                downloadStatus={downloadStatus}
                                downloadProgress={downloadProgress}
                                fileSize={updateInfo.fileSize}
                                downloadSource={updateInfo.downloadSource}
                                onInstallClick={handleInstallNow}
                                onRetryClick={() => {
                                  resetDownloadState();
                                  startDownload();
                                }}
                                progressBgClass="bg-bg-secondary"
                              />
                            )}

                            {/* 等待下载 */}
                            {updateInfo.downloadUrl && downloadStatus === 'idle' && (
                              <div className="flex items-center gap-2 text-xs text-text-muted">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>{t('mirrorChyan.preparingDownload')}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 只有错误没有更新时显示错误 */}
                        {updateInfo &&
                          !updateInfo.hasUpdate &&
                          updateInfo.errorCode &&
                          errorText && (
                            <div
                              className={clsx(
                                'flex items-start gap-2 p-3 rounded-lg text-sm',
                                isCdkError
                                  ? 'bg-warning/10 text-warning border border-warning/30'
                                  : 'bg-error/10 text-error border border-error/30',
                              )}
                            >
                              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                              <div className="space-y-1">
                                <p>{errorText}</p>
                                {isCdkError && (
                                  <p className="text-xs opacity-80">{t('mirrorChyan.cdkHint')}</p>
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* 调试 */}
            <section id="section-debug" className="space-y-4 scroll-mt-4">
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                <Bug className="w-4 h-4" />
                {t('debug.title')}
              </h2>

              <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-4">
                {/* 版本信息 */}
                <div className="text-sm text-text-secondary space-y-1">
                  <p className="font-medium text-text-primary">{t('debug.versions')}</p>
                  <p>
                    {t('debug.interfaceVersion', { name: projectInterface?.name || 'interface' })}:{' '}
                    <span className="font-mono text-text-primary">{version || '-'}</span>
                  </p>
                  <p>
                    {t('debug.maafwVersion')}:{' '}
                    <span className="font-mono text-text-primary">
                      {maafwVersion || t('maa.notInitialized')}
                    </span>
                  </p>
                  <p>
                    {t('debug.mxuVersion')}:{' '}
                    <span className="font-mono text-text-primary">{mxuVersion || '-'}</span>
                  </p>
                </div>

                {/* 环境信息 */}
                <div className="text-sm text-text-secondary space-y-1">
                  <p>
                    {t('debug.environment')}:{' '}
                    <span className="font-mono text-text-primary">
                      {isTauri() ? t('debug.envTauri') : t('debug.envBrowser')}
                    </span>
                  </p>
                </div>

                {/* 路径信息（仅 Tauri 环境显示） */}
                {isTauri() && (exeDir || cwd) && (
                  <div className="text-sm text-text-secondary space-y-1">
                    <p className="font-medium text-text-primary">{t('debug.pathInfo')}</p>
                    {cwd && (
                      <p className="break-all">
                        {t('debug.cwd')}:{' '}
                        <span className="font-mono text-text-primary text-xs">{cwd}</span>
                      </p>
                    )}
                    {exeDir && (
                      <p className="break-all">
                        {t('debug.exeDir')}:{' '}
                        <span className="font-mono text-text-primary text-xs">{exeDir}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleResetWindowSize}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                  >
                    <Maximize2 className="w-4 h-4" />
                    {t('debug.resetWindowSize')}
                  </button>
                  <button
                    onClick={handleOpenConfigDir}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    {t('debug.openConfigDir')}
                  </button>
                  <button
                    onClick={handleOpenLogDir}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                  >
                    <ScrollText className="w-4 h-4" />
                    {t('debug.openLogDir')}
                  </button>
                  <button
                    onClick={handleClearCache}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                    title={
                      cacheEntryCount !== null
                        ? t('debug.cacheStats', { count: cacheEntryCount })
                        : undefined
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('debug.clearCache')}
                    {cacheEntryCount !== null && cacheEntryCount > 0 && (
                      <span className="text-xs text-text-muted">({cacheEntryCount})</span>
                    )}
                  </button>
                </div>

                {/* 开发模式 */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-accent" />
                    <div>
                      <span className="font-medium text-text-primary">{t('debug.devMode')}</span>
                      <p className="text-xs text-text-muted mt-0.5">{t('debug.devModeHint')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDevMode(!devMode)}
                    className={clsx(
                      'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                      devMode ? 'bg-accent' : 'bg-bg-active',
                    )}
                  >
                    <span
                      className={clsx(
                        'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                        devMode ? 'translate-x-5' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>

                {/* 保存调试图像 */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-3">
                    <Bug className="w-5 h-5 text-accent" />
                    <div>
                      <span className="font-medium text-text-primary">{t('debug.saveDraw')}</span>
                      <p className="text-xs text-text-muted mt-0.5">{t('debug.saveDrawHint')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSaveDraw(!saveDraw)}
                    className={clsx(
                      'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                      saveDraw ? 'bg-accent' : 'bg-bg-active',
                    )}
                  >
                    <span
                      className={clsx(
                        'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                        saveDraw ? 'translate-x-5' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>
              </div>
            </section>

            {/* 关于 */}
            <section id="section-about" className="space-y-4 scroll-mt-4">
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4" />
                {t('about.title')}
              </h2>

              <div className="bg-bg-secondary rounded-xl p-6 border border-border">
                {/* Logo 和名称 */}
                <div className="text-center mb-6">
                  {resolvedContent.iconPath ? (
                    <img
                      src={resolvedContent.iconPath}
                      alt={projectName}
                      className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg object-contain"
                      onError={(e) => {
                        // 图标加载失败时显示默认图标
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div
                    className={clsx(
                      'w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-lg',
                      resolvedContent.iconPath && 'hidden',
                    )}
                  >
                    <span className="text-3xl font-bold text-white">
                      {projectName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-text-primary">{projectName}</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    {t('about.version')}: {version}
                  </p>
                </div>

                {/* 内容加载中 */}
                {isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-accent" />
                  </div>
                ) : (
                  <>
                    {/* 描述 */}
                    {resolvedContent.description && (
                      <div className="mb-6 text-center">
                        {renderMarkdown(resolvedContent.description)}
                      </div>
                    )}

                    {/* 信息列表 */}
                    <div className="space-y-2">
                      {/* 联系方式 */}
                      {resolvedContent.contact && (
                        <div className="px-4 py-3 rounded-lg bg-bg-tertiary">
                          <div className="flex items-center gap-3 mb-2">
                            <Mail className="w-5 h-5 text-text-muted flex-shrink-0" />
                            <span className="text-sm font-medium text-text-primary">
                              {t('about.contact')}
                            </span>
                          </div>
                          <div className="ml-8">{renderMarkdown(resolvedContent.contact)}</div>
                        </div>
                      )}

                      {/* 许可证 */}
                      {resolvedContent.license && (
                        <div className="px-4 py-3 rounded-lg bg-bg-tertiary">
                          <div className="flex items-center gap-3 mb-2">
                            <FileText className="w-5 h-5 text-text-muted flex-shrink-0" />
                            <span className="text-sm font-medium text-text-primary">
                              {t('about.license')}
                            </span>
                          </div>
                          <div className="ml-8">{renderMarkdown(resolvedContent.license)}</div>
                        </div>
                      )}

                      {/* GitHub */}
                      {/* {github && (
                      <a
                        href={github}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-tertiary hover:bg-bg-hover transition-colors"
                      >
                        <Github className="w-5 h-5 text-text-muted flex-shrink-0" />
                        <span className="text-sm text-accent truncate">{github}</span>
                      </a>
                    )} */}
                    </div>
                  </>
                )}

                {/* 底部信息 */}
                <div className="text-center pt-4 mt-4 border-t border-border">
                  <p className="text-xs text-text-muted">
                    Powered by{' '}
                    <a
                      href="https://maafw.xyz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      MaaFramework
                    </a>
                    {' & '}
                    <a
                      href="https://github.com/MistEO/MXU"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      MXU
                    </a>
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
