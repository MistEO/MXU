import { useState, useEffect, useRef } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/appStore';
import { resolveContent, simpleMarkdownToHtml } from '@/services/contentResolver';
import { getInterfaceLangKey } from '@/i18n';

/**
 * 计算字符串的简单 hash，用于判断内容是否变化
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function WelcomeDialog() {
  const { t } = useTranslation();
  const { projectInterface, interfaceTranslations, basePath, language, welcomeShownHash, setWelcomeShownHash } = useAppStore();
  
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // 保存当前内容的 hash，关闭时写入配置
  const contentHashRef = useRef<string>('');

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  useEffect(() => {
    if (!projectInterface?.welcome) {
      setIsOpen(false);
      return;
    }

    const loadAndCheckWelcome = async () => {
      setIsLoading(true);
      
      // 解析 welcome 内容
      const resolvedContent = await resolveContent(
        projectInterface.welcome,
        { translations, basePath }
      );
      
      if (!resolvedContent) {
        setIsOpen(false);
        return;
      }
      
      // 计算内容 hash
      const contentHash = simpleHash(resolvedContent);
      contentHashRef.current = contentHash;
      
      // 如果内容已经显示过（hash 相同），不再显示
      if (welcomeShownHash === contentHash) {
        setIsOpen(false);
        return;
      }
      
      setContent(resolvedContent);
      setIsLoading(false);
      setIsOpen(true);
    };

    loadAndCheckWelcome();
  }, [projectInterface?.welcome, langKey, basePath, translations, welcomeShownHash]);

  const handleClose = () => {
    // 记录已显示的内容 hash 到配置文件
    if (contentHashRef.current) {
      setWelcomeShownHash(contentHashRef.current);
    }
    setIsOpen(false);
  };

  if (!isOpen || isLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* 弹窗内容 */}
      <div className="relative bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">
              {projectInterface?.label 
                ? (translations?.[projectInterface.label.slice(1)] || projectInterface.label)
                : projectInterface?.name || 'Welcome'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
        
        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div 
            className="prose prose-sm max-w-none text-text-secondary"
            dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(content) }}
          />
        </div>
        
        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
          >
            {t('welcome.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
