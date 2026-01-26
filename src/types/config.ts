// MXU 配置文件结构 (mxu.json)

import type { OptionValue } from './interface';
import type { AccentColor } from '@/themes/types';

// 定时执行策略
export interface SchedulePolicy {
  id: string;
  name: string; // 策略名称
  enabled: boolean; // 是否启用
  weekdays: number[]; // 重复日期 (0-6, 0=周日)
  hours: number[]; // 开始时间 (0-23)
}

// 保存的任务配置
export interface SavedTask {
  id: string;
  taskName: string; // 对应 interface 中的 task.name
  customName?: string; // 用户自定义名称
  enabled: boolean;
  optionValues: Record<string, OptionValue>;
}

// 保存的设备信息
export interface SavedDeviceInfo {
  // ADB 设备：保存设备名称
  adbDeviceName?: string;
  // Win32/Gamepad：保存窗口名称
  windowName?: string;
  // PlayCover：保存地址
  playcoverAddress?: string;
}

// 保存的实例配置
export interface SavedInstance {
  id: string;
  name: string;
  controllerId?: string;
  resourceId?: string;
  // 保存的控制器和资源名称
  controllerName?: string;
  resourceName?: string;
  // 保存的设备信息，用于自动重连
  savedDevice?: SavedDeviceInfo;
  tasks: SavedTask[];
  // 定时执行策略列表
  schedulePolicies?: SchedulePolicy[];
}

// 窗口大小配置
export interface WindowSize {
  width: number;
  height: number;
}

// 最近关闭的实例记录
export interface RecentlyClosedInstance {
  id: string; // 原实例 ID
  name: string; // 实例名称
  closedAt: number; // 关闭时间戳
  controllerId?: string;
  resourceId?: string;
  controllerName?: string;
  resourceName?: string;
  savedDevice?: SavedDeviceInfo;
  tasks: SavedTask[]; // 保存的任务配置
  schedulePolicies?: SchedulePolicy[]; // 定时执行策略
}

// MirrorChyan 更新频道
export type UpdateChannel = 'stable' | 'beta';

// 截图帧率类型
export type ScreenshotFrameRate = 'unlimited' | '5' | '1' | '0.2' | '0.033';

// MirrorChyan 设置
export interface MirrorChyanSettings {
  cdk: string; // MirrorChyan CDK
  channel: UpdateChannel; // 更新频道：stable(正式版) / beta(公测版)
}

// 应用设置
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  accentColor?: AccentColor; // 强调色
  language: 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR';
  windowSize?: WindowSize;
  mirrorChyan?: MirrorChyanSettings;
  showOptionPreview?: boolean; // 是否在任务列表显示选项预览
  sidePanelExpanded?: boolean; // 右侧面板是否展开（连接+截图）
  connectionPanelExpanded?: boolean; // 连接设置卡片是否展开
  screenshotPanelExpanded?: boolean; // 实时截图卡片是否展开
  screenshotFrameRate?: ScreenshotFrameRate; // 实时截图帧率
  welcomeShownHash?: string; // 已显示过的 welcome 内容 hash，用于判断内容变化时重新弹窗
  rightPanelWidth?: number; // 右侧面板宽度
  rightPanelCollapsed?: boolean; // 右侧面板是否折叠
  devMode?: boolean; // 开发模式，启用后允许 F5 刷新 UI
  onboardingCompleted?: boolean; // 新用户引导是否已完成
}

// MXU 配置文件完整结构
export interface MxuConfig {
  version: string;
  instances: SavedInstance[];
  settings: AppSettings;
  recentlyClosed?: RecentlyClosedInstance[]; // 最近关闭的实例列表（最多30条）
  interfaceTaskSnapshot?: string[]; // 保存时 interface.json 中的任务名列表快照，用于检测新增任务
  newTaskNames?: string[]; // 用户尚未查看的新增任务名称列表
}

// 默认窗口大小
export const defaultWindowSize: WindowSize = {
  width: 1000,
  height: 618,
};

// 默认 MirrorChyan 设置
export const defaultMirrorChyanSettings: MirrorChyanSettings = {
  cdk: '',
  channel: 'stable',
};

// 默认截图帧率
export const defaultScreenshotFrameRate: ScreenshotFrameRate = '5';

// 默认强调色
export const defaultAccentColor: AccentColor = 'emerald';

// 默认配置
export const defaultConfig: MxuConfig = {
  version: '1.0',
  instances: [],
  settings: {
    theme: 'system',
    accentColor: defaultAccentColor,
    language: 'zh-CN',
    windowSize: defaultWindowSize,
    mirrorChyan: defaultMirrorChyanSettings,
  },
};
