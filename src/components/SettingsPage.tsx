import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ArrowLeft, 
  Globe, 
  Palette, 
  Github,
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
} from 'lucide-react';
import type { UpdateChannel } from '@/types/config';
import { checkUpdate, openMirrorChyanWebsite } from '@/services/updateService';
import { defaultWindowSize } from '@/types/config';
import { useAppStore } from '@/stores/appStore';
import { setLanguage as setI18nLanguage } from '@/i18n';
import { resolveContent, resolveIconPath, simpleMarkdownToHtml, resolveI18nText } from '@/services/contentResolver';
import { maaService } from '@/services/maaService';
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

export function SettingsPage() {
  const { t } = useTranslation();
  const { 
    theme, 
    setTheme, 
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
  } = useAppStore();

  const [resolvedContent, setResolvedContent] = useState<ResolvedContent>({
    description: '',
    license: '',
    contact: '',
    iconPath: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [mxuVersion, setMxuVersion] = useState<string | null>(null);
  const [maafwVersion, setMaafwVersion] = useState<string | null>(null);
  const [showCdk, setShowCdk] = useState(false);

  const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
  const translations = interfaceTranslations[langKey];
  const isDebugMode = basePath === '/test';

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
    };

    loadVersions();
  }, []);

  // 解析内容（支持文件路径、URL、国际化）
  useEffect(() => {
    if (!projectInterface) return;

    const loadContent = async () => {
      setIsLoading(true);
      
      const options = { translations, basePath };
      
      const [description, license, contact] = await Promise.all([
        resolveContent(projectInterface.description, options),
        resolveContent(projectInterface.license, options),
        resolveContent(projectInterface.contact, options),
      ]);
      
      const iconPath = resolveIconPath(projectInterface.icon, basePath, translations);
      
      setResolvedContent({ description, license, contact, iconPath });
      setIsLoading(false);
    };

    loadContent();
  }, [projectInterface, langKey, basePath, translations]);

  const handleLanguageChange = (lang: 'zh-CN' | 'en-US') => {
    setLanguage(lang);
    setI18nLanguage(lang);
  };

  // 调试：添加日志
  const addDebugLog = (msg: string) => {
    setDebugLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // 调试：刷新 UI
  const handleRefreshUI = () => {
    addDebugLog('刷新 UI...');
    window.location.reload();
  };

  // 调试：清空日志
  const handleClearLog = () => {
    setDebugLog([]);
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
      const result = await checkUpdate({
        resourceId: projectInterface.mirrorchyan_rid,
        currentVersion: projectInterface.version,
        cdk: mirrorChyanSettings.cdk || undefined,
        channel: mirrorChyanSettings.channel,
        userAgent: 'MXU',
      });
      
      if (result) {
        setUpdateInfo(result);
        if (result.hasUpdate) {
          addDebugLog(`发现新版本: ${result.versionName}`);
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
      await currentWindow.setSize(new LogicalSize(defaultWindowSize.width, defaultWindowSize.height));
      addDebugLog(`窗口尺寸已重置为 ${defaultWindowSize.width}x${defaultWindowSize.height}`);
    } catch (err) {
      addDebugLog(`重置窗口尺寸失败: ${err}`);
    }
  };

  const projectName =
    resolveI18nText(projectInterface?.label, translations) ||
    projectInterface?.name ||
    'MXU';
  const version = projectInterface?.version || '0.1.0';
  const github = projectInterface?.github;

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

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button
          onClick={() => setCurrentPage('main')}
          className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="text-lg font-semibold text-text-primary">
          {t('settings.title')}
        </h1>
      </div>

      {/* 设置内容 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-8">
          {/* 外观设置 */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
              {t('settings.appearance')}
            </h2>
            
            {/* 语言 */}
            <div className="bg-bg-secondary rounded-xl p-4 border border-border">
              <div className="flex items-center gap-3 mb-3">
                <Globe className="w-5 h-5 text-accent" />
                <span className="font-medium text-text-primary">{t('settings.language')}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleLanguageChange('zh-CN')}
                  className={clsx(
                    'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    language === 'zh-CN'
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  中文
                </button>
                <button
                  onClick={() => handleLanguageChange('en-US')}
                  className={clsx(
                    'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    language === 'en-US'
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  English
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
                  onClick={() => setTheme('light')}
                  className={clsx(
                    'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    theme === 'light'
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
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
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  {t('settings.themeDark')}
                </button>
              </div>
            </div>
          </section>

          {/* MirrorChyan 更新设置 */}
          {projectInterface?.mirrorchyan_rid && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
                <Download className="w-4 h-4" />
                {t('mirrorChyan.title')}
              </h2>
              
              <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-5">
                {/* 更新频道 */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Download className="w-5 h-5 text-accent" />
                    <span className="font-medium text-text-primary">{t('mirrorChyan.channel')}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMirrorChyanChannel('stable')}
                      className={clsx(
                        'flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                        mirrorChyanSettings.channel === 'stable'
                          ? 'bg-accent text-white'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
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
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
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
                    <span className="font-medium text-text-primary">{t('mirrorChyan.cdk')}</span>
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
                      onChange={(e) => setMirrorChyanCdk(e.target.value)}
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
                  <p className="mt-2 text-xs text-text-muted">
                    {t('mirrorChyan.cdkHint')}
                  </p>
                </div>

                {/* 检查更新按钮 */}
                <div className="pt-4 border-t border-border">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={updateCheckLoading}
                    className={clsx(
                      'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      updateCheckLoading
                        ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                        : 'bg-accent text-white hover:bg-accent-hover'
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
                  {updateInfo && !updateInfo.hasUpdate && (
                    <p className="mt-2 text-xs text-center text-text-muted">
                      {t('mirrorChyan.upToDate', { version: updateInfo.versionName })}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 调试 */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
              <Bug className="w-4 h-4" />
              {t('debug.title')}
            </h2>
            
            <div className="bg-bg-secondary rounded-xl p-4 border border-border space-y-4">
              {/* 放在设置页调试模块里，避免主界面占位；并且只有加载了 test/interface.json 才显示 */}
              {isDebugMode && (
                <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-2 flex items-center justify-center gap-2 text-amber-700 dark:text-amber-300 text-sm">
                  <Bug className="w-4 h-4" />
                  <span>调试模式：正在使用 test/interface.json</span>
                </div>
              )}

              {/* 版本信息 */}
              <div className="text-sm text-text-secondary space-y-1">
                <p className="font-medium text-text-primary">{t('debug.versions')}</p>
                <p>{t('debug.interfaceVersion')}: <span className="font-mono text-text-primary">{version || '-'}</span></p>
                <p>{t('debug.maafwVersion')}: <span className="font-mono text-text-primary">{maafwVersion || t('maa.notInitialized')}</span></p>
                <p>{t('debug.mxuVersion')}: <span className="font-mono text-text-primary">{mxuVersion || '-'}</span></p>
              </div>

              {/* 环境信息 */}
              <div className="text-sm text-text-secondary space-y-1">
                <p>环境: <span className="font-mono text-text-primary">{isTauri() ? 'Tauri 桌面应用' : '浏览器'}</span></p>
              </div>
              
              {/* 操作按钮 */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRefreshUI}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  刷新 UI
                </button>
                <button
                  onClick={handleResetWindowSize}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                >
                  <Maximize2 className="w-4 h-4" />
                  重置窗口尺寸
                </button>
                <button
                  onClick={handleClearLog}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors"
                >
                  清空日志
                </button>
              </div>
              
              {/* 调试日志 */}
              {debugLog.length > 0 && (
                <div className="bg-bg-tertiary rounded-lg p-3 max-h-40 overflow-y-auto">
                  <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">
                    {debugLog.join('\n')}
                  </pre>
                </div>
              )}
            </div>
          </section>

          {/* 关于 */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
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
                <div className={clsx(
                  "w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-lg",
                  resolvedContent.iconPath && "hidden"
                )}>
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
                    {/* 许可证 */}
                    {resolvedContent.license && (
                      <div className="px-4 py-3 rounded-lg bg-bg-tertiary">
                        <div className="flex items-center gap-3 mb-2">
                          <FileText className="w-5 h-5 text-text-muted flex-shrink-0" />
                          <span className="text-sm font-medium text-text-primary">
                            {t('about.license')}
                          </span>
                        </div>
                        <div className="ml-8">
                          {renderMarkdown(resolvedContent.license)}
                        </div>
                      </div>
                    )}

                    {/* 联系方式 */}
                    {resolvedContent.contact && (
                      <div className="px-4 py-3 rounded-lg bg-bg-tertiary">
                        <div className="flex items-center gap-3 mb-2">
                          <Mail className="w-5 h-5 text-text-muted flex-shrink-0" />
                          <span className="text-sm font-medium text-text-primary">
                            {t('about.contact')}
                          </span>
                        </div>
                        <div className="ml-8">
                          {renderMarkdown(resolvedContent.contact)}
                        </div>
                      </div>
                    )}

                    {/* GitHub */}
                    {github && (
                      <a
                        href={github}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-tertiary hover:bg-bg-hover transition-colors"
                      >
                        <Github className="w-5 h-5 text-text-muted flex-shrink-0" />
                        <span className="text-sm text-accent truncate">{github}</span>
                      </a>
                    )}
                  </div>
                </>
              )}

              {/* 底部信息 */}
              <div className="text-center pt-4 mt-4 border-t border-border">
                <p className="text-xs text-text-muted">
                  Powered by MaaFramework & Tauri
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
