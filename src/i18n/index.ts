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
export type LanguagePreference = SupportedLanguage | 'system';

/** 获取所有支持的语言列表 */
export const getSupportedLanguages = (): SupportedLanguage[] => {
  return Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];
};

/** 尝试从浏览器/系统语言推断一个支持的语言 */
export const detectSystemLanguage = (): SupportedLanguage => {
  const candidates: string[] = [];

  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
  }

  // 精确匹配
  for (const c of candidates) {
    if (c in SUPPORTED_LANGUAGES) return c as SupportedLanguage;
  }

  // 前缀匹配（如 zh -> zh-CN）
  for (const c of candidates) {
    const prefix = c.split('-')[0];
    const matched = getSupportedLanguages().find((lang) => lang.startsWith(prefix));
    if (matched) return matched;
  }

  return 'en-US';
};

/** 将语言偏好解析为实际使用的语言（i18n/label 等需要具体语言） */
export const resolveLanguagePreference = (pref: LanguagePreference): SupportedLanguage => {
  return pref === 'system' ? detectSystemLanguage() : pref;
};

/** 获取 interface.json 翻译键（用于 ProjectInterface 国际化） */
export const getInterfaceLangKey = (lang: LanguagePreference | string): string => {
  const resolved = resolveLanguagePreference(
    (lang === 'system' ? 'system' : (lang as SupportedLanguage)) as LanguagePreference,
  );
  const config = SUPPORTED_LANGUAGES[resolved];
  // 默认回退到英文
  return config?.interfaceKey ?? SUPPORTED_LANGUAGES['en-US'].interfaceKey;
};

/** 从 localStorage 读取语言偏好（可能为 system） */
export const getStoredLanguagePreference = (): LanguagePreference | null => {
  const stored = localStorage.getItem('mxu-language');
  if (!stored) return null;
  if (stored === 'system') return 'system';
  if (stored in SUPPORTED_LANGUAGES) return stored as SupportedLanguage;
  return null;
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
  const storedPref = getStoredLanguagePreference();
  if (storedPref) return resolveLanguagePreference(storedPref);
  return detectSystemLanguage();
};

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
});

export const setLanguage = (pref: LanguagePreference) => {
  const resolved = resolveLanguagePreference(pref);
  i18n.changeLanguage(resolved);
  localStorage.setItem('mxu-language', pref);
};

export const getCurrentLanguage = (): SupportedLanguage => i18n.language as SupportedLanguage;

export default i18n;
