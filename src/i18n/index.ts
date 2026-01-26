import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN';
import zhTW from './locales/zh-TW';
import enUS from './locales/en-US';
import jaJP from './locales/ja-JP';
import koKR from './locales/ko-KR';

/**
 * 支持的语言配置
 * - key: MXU 使用的语言代码（BCP 47 格式）
 * - interfaceKey: interface.json 翻译文件中使用的语言键（ProjectInterface V2 协议规范）
 */
export const SUPPORTED_LANGUAGES = {
  'zh-CN': { interfaceKey: 'zh_cn' },
  'zh-TW': { interfaceKey: 'zh_tw' },
  'en-US': { interfaceKey: 'en_us' },
  'ja-JP': { interfaceKey: 'ja_jp' },
  'ko-KR': { interfaceKey: 'ko_kr' },
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

/** 获取 interface.json 翻译键（用于 ProjectInterface 国际化） */
export const getInterfaceLangKey = (lang: string): string => {
  const config = SUPPORTED_LANGUAGES[lang as SupportedLanguage];
  // 默认回退到英文
  return config?.interfaceKey ?? SUPPORTED_LANGUAGES['en-US'].interfaceKey;
};

/** 获取所有支持的语言列表 */
export const getSupportedLanguages = (): SupportedLanguage[] => {
  return Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];
};

const resources = {
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  'en-US': { translation: enUS },
  'ja-JP': { translation: jaJP },
  'ko-KR': { translation: koKR },
};

// 获取系统语言或存储的语言偏好
const getInitialLanguage = (): SupportedLanguage => {
  const stored = localStorage.getItem('mxu-language');
  if (stored && stored in SUPPORTED_LANGUAGES) {
    return stored as SupportedLanguage;
  }

  // 尝试匹配系统语言
  const systemLang = navigator.language;
  // 精确匹配
  if (systemLang in SUPPORTED_LANGUAGES) {
    return systemLang as SupportedLanguage;
  }
  // 前缀匹配（如 zh -> zh-CN）
  const prefix = systemLang.split('-')[0];
  const matched = getSupportedLanguages().find((lang) => lang.startsWith(prefix));
  return matched ?? 'en-US';
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
});

export const setLanguage = (lang: SupportedLanguage) => {
  i18n.changeLanguage(lang);
  localStorage.setItem('mxu-language', lang);
};

export const getCurrentLanguage = (): SupportedLanguage => i18n.language as SupportedLanguage;

export default i18n;
