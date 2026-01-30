import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Mail, FileText, Loader2 } from 'lucide-react';
import clsx from 'clsx';

import { useAppStore } from '@/stores/appStore';
import { getInterfaceLangKey } from '@/i18n';
import {
  resolveContent,
  loadIconAsDataUrl,
  simpleMarkdownToHtml,
  resolveI18nText,
} from '@/services/contentResolver';

interface ResolvedContent {
  description: string;
  license: string;
  contact: string;
  iconPath: string | undefined;
}

export function AboutSection() {
  const { t } = useTranslation();
  const { projectInterface, interfaceTranslations, basePath, language } = useAppStore();

  const [resolvedContent, setResolvedContent] = useState<ResolvedContent>({
    description: '',
    license: '',
    contact: '',
    iconPath: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  const projectName =
    resolveI18nText(projectInterface?.label, translations) || projectInterface?.name || 'MXU';
  const version = projectInterface?.version || '0.1.0';

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
              <div className="mb-6 text-center">{renderMarkdown(resolvedContent.description)}</div>
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
  );
}
