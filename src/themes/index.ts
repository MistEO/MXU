/**
 * 主题管理器
 * 负责加载、切换和应用主题
 */

import type {
  ModeTheme,
  AccentTheme,
  ThemeMode,
  AccentColor,
  AccentInfo,
  CustomAccent,
} from './types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Theme');

// 静态导入所有主题预设（Vite 需要静态导入才能正确打包）
import lightTheme from './presets/light.json';
import darkTheme from './presets/dark.json';
import emeraldAccent from './presets/accents/emerald.json';
import lavaAccent from './presets/accents/lava.json';
import titaniumAccent from './presets/accents/titanium.json';
import celadonAccent from './presets/accents/celadon.json';
import rosegoldAccent from './presets/accents/rosegold.json';
import danxiaAccent from './presets/accents/danxia.json';
import deepseaAccent from './presets/accents/deepsea.json';
import cambrianAccent from './presets/accents/cambrian.json';
import pearlAccent from './presets/accents/pearl.json';

/** 模式主题映射 */
const modeThemes: Record<ThemeMode, ModeTheme> = {
  light: lightTheme as ModeTheme,
  dark: darkTheme as ModeTheme,
};

/** 强调色主题映射（内置预设） */
const accentThemes: Record<AccentColor, AccentTheme> = {
  emerald: emeraldAccent as AccentTheme,
  lava: lavaAccent as AccentTheme,
  titanium: titaniumAccent as AccentTheme,
  celadon: celadonAccent as AccentTheme,
  rosegold: rosegoldAccent as AccentTheme,
  danxia: danxiaAccent as AccentTheme,
  deepsea: deepseaAccent as AccentTheme,
  cambrian: cambrianAccent as AccentTheme,
  pearl: pearlAccent as AccentTheme,
};

/** 运行时注册的自定义强调色主题
 *
 * 使用索引簽名避免要求預先包含所有內建鍵
 */
const customAccentThemes: { [key: string]: AccentTheme } = {};

/** 记录当前已注册的自定义强调色名称，便于清理 */
const registeredCustomAccentNames = new Set<AccentColor>();

/**
 * 语义色配置
 * - success: 跟随强调色（用于成功状态、开关等）
 * - warning/error: 固定颜色（保持语义一致性）
 * - info: 跟随强调色（用于信息提示）
 */
const fixedSemanticColors = {
  warning: '#f59e0b',
  error: '#ef4444',
};

/** 当前主题状态 */
let currentMode: ThemeMode = 'light';
let currentAccent: AccentColor = 'deepsea';

/**
 * 将主题配置应用到 CSS 变量
 */
function applyCSSVariables(mode: ModeTheme, accent: AccentTheme, isDark: boolean): void {
  const root = document.documentElement;

  // 背景色
  root.style.setProperty('--color-bg-primary', mode.bg.primary);
  root.style.setProperty('--color-bg-secondary', mode.bg.secondary);
  root.style.setProperty('--color-bg-tertiary', mode.bg.tertiary);
  root.style.setProperty('--color-bg-hover', mode.bg.hover);
  root.style.setProperty('--color-bg-active', mode.bg.active);

  // 文字色
  root.style.setProperty('--color-text-primary', mode.text.primary);
  root.style.setProperty('--color-text-secondary', mode.text.secondary);
  root.style.setProperty('--color-text-tertiary', mode.text.tertiary);
  root.style.setProperty('--color-text-muted', mode.text.muted);

  // 边框色
  root.style.setProperty('--color-border', mode.border.default);
  root.style.setProperty('--color-border-strong', mode.border.strong);

  // 阴影
  root.style.setProperty('--shadow-sm', mode.shadow.sm);
  root.style.setProperty('--shadow-md', mode.shadow.md);
  root.style.setProperty('--shadow-lg', mode.shadow.lg);

  // 强调色（根据模式选择浅色或深色背景）
  root.style.setProperty('--color-accent', accent.default);
  root.style.setProperty('--color-accent-hover', accent.hover);
  root.style.setProperty('--color-accent-light', isDark ? accent.lightDark : accent.light);

  // 语义色
  // success 和 info 使用强调色，让 UI 更统一
  root.style.setProperty('--color-success', accent.default);
  root.style.setProperty('--color-info', accent.default);
  root.style.setProperty('--color-warning', fixedSemanticColors.warning);
  root.style.setProperty('--color-error', fixedSemanticColors.error);
}

/**
 * 应用主题
 * @param mode 主题模式 (light/dark)
 * @param accent 强调色名称
 */
export function applyTheme(mode: ThemeMode, accent: AccentColor): void {
  const modeTheme = modeThemes[mode];
  const accentTheme = customAccentThemes[accent] || accentThemes[accent];

  if (!modeTheme || !accentTheme) {
    logger.warn(`Theme not found: mode=${mode}, accent=${accent}`);
    return;
  }

  currentMode = mode;
  currentAccent = accent;

  // 切换 dark class
  document.documentElement.classList.toggle('dark', mode === 'dark');

  // 应用 CSS 变量
  applyCSSVariables(modeTheme, accentTheme, mode === 'dark');
}

/**
 * 获取当前主题模式
 */
export function getCurrentMode(): ThemeMode {
  return currentMode;
}

/**
 * 获取当前强调色
 */
export function getCurrentAccent(): AccentColor {
  return currentAccent;
}

/**
 * 获取所有可用的主题模式
 */
export function getAvailableModes(): ThemeMode[] {
  return Object.keys(modeThemes) as ThemeMode[];
}

/**
 * 获取所有可用的强调色
 */
export function getAvailableAccents(): AccentColor[] {
  return [
    ...(Object.keys(accentThemes) as AccentColor[]),
    ...(Object.keys(customAccentThemes) as AccentColor[]),
  ];
}

/**
 * 获取强调色信息列表（用于 UI 展示）
 * @param lang 语言代码
 */
export function getAccentInfoList(lang: string): AccentInfo[] {
  const langKey = lang as keyof AccentTheme['label'];
  return getAvailableAccents().map((name) => {
    const accent =
      customAccentThemes[name as string] || accentThemes[name as keyof typeof accentThemes];
    if (!accent) {
      // 理论上不会发生，仅做兜底保护
      return {
        name,
        label: String(name),
        color: '#ffffff',
        isCustom: false,
      };
    }

    const isCustom = !!customAccentThemes[name as string];

    return {
      name,
      label: accent.label[langKey] || accent.label['en-US'],
      color: accent.default,
      isCustom,
    };
  });
}

/**
 * 获取指定强调色的主题配置
 */
export function getAccentTheme(accent: AccentColor): AccentTheme | undefined {
  return customAccentThemes[accent] || accentThemes[accent];
}

/**
 * 获取指定模式的主题配置
 */
export function getModeTheme(mode: ThemeMode): ModeTheme | undefined {
  return modeThemes[mode];
}

/**
 * 解析主题模式，将 'system' 解析为 'light' 或 'dark'
 */
export function resolveThemeMode(theme: ThemeMode | 'system'): ThemeMode {
  return theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : theme;
}

// 默认导出便于使用
export default {
  applyTheme,
  getCurrentMode,
  getCurrentAccent,
  getAvailableModes,
  getAvailableAccents,
  getAccentInfoList,
  getAccentTheme,
  getModeTheme,
  resolveThemeMode,
};

// 重新导出类型
export type {
  ModeTheme,
  AccentTheme,
  ThemeMode,
  AccentColor,
  AccentInfo,
  CustomAccent,
} from './types';

/**
 * 注册自定义强调色
 * - 会在运行时将其加入主题映射中
 */
export function registerCustomAccent(accent: CustomAccent): void {
  const name = accent.name;

  customAccentThemes[name] = {
    name,
    label: accent.label,
    default: accent.colors.default,
    hover: accent.colors.hover,
    light: accent.colors.light,
    lightDark: accent.colors.lightDark,
  };

  registeredCustomAccentNames.add(name);

  // 如果当前正在使用这个强调色，则重新应用主题
  if (currentAccent === name) {
    applyTheme(currentMode, name);
  }
}

/**
 * 取消注册自定义强调色
 */
export function unregisterCustomAccent(name: AccentColor): void {
  delete customAccentThemes[name];
  registeredCustomAccentNames.delete(name);
}

/**
 * 清空所有自定义强调色
 */
export function clearCustomAccents(): void {
  for (const name of registeredCustomAccentNames) {
    delete customAccentThemes[name];
  }
  registeredCustomAccentNames.clear();
}
