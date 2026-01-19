// MXU 配置文件结构 (mxu.json)

import type { OptionValue } from './interface';

// 保存的任务配置
export interface SavedTask {
  id: string;
  taskName: string;           // 对应 interface 中的 task.name
  customName?: string;        // 用户自定义名称
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
}

// 窗口大小配置
export interface WindowSize {
  width: number;
  height: number;
}

// 最近关闭的实例记录
export interface RecentlyClosedInstance {
  id: string;               // 原实例 ID
  name: string;             // 实例名称
  closedAt: number;         // 关闭时间戳
  controllerId?: string;
  resourceId?: string;
  controllerName?: string;
  resourceName?: string;
  savedDevice?: SavedDeviceInfo;
  tasks: SavedTask[];       // 保存的任务配置
}

// MirrorChyan 更新频道
export type UpdateChannel = 'stable' | 'beta';

// MirrorChyan 设置
export interface MirrorChyanSettings {
  cdk: string;           // MirrorChyan CDK
  channel: UpdateChannel; // 更新频道：stable(正式版) / beta(公测版)
}

// 应用设置
export interface AppSettings {
  theme: 'light' | 'dark';
  language: 'zh-CN' | 'en-US';
  windowSize?: WindowSize;
  mirrorChyan?: MirrorChyanSettings;
}

// MXU 配置文件完整结构
export interface MxuConfig {
  version: string;
  instances: SavedInstance[];
  settings: AppSettings;
  recentlyClosed?: RecentlyClosedInstance[];  // 最近关闭的实例列表（最多30条）
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

// 默认配置
export const defaultConfig: MxuConfig = {
  version: '1.0',
  instances: [],
  settings: {
    theme: 'light',
    language: 'zh-CN',
    windowSize: defaultWindowSize,
    mirrorChyan: defaultMirrorChyanSettings,
  },
};
