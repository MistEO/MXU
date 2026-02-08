// MaaFramework 类型定义

/** ADB 设备信息 */
export interface AdbDevice {
  name: string;
  adb_path: string;
  address: string;
  screencap_methods: string; // u64 作为字符串传递，避免 JS 精度丢失
  input_methods: string; // u64 作为字符串传递
  config: string;
}

/** Win32 窗口信息 */
export interface Win32Window {
  handle: number;
  class_name: string;
  window_name: string;
}

/** ADB 控制器配置 */
export interface AdbControllerConfig {
  type: 'Adb';
  adb_path: string;
  address: string;
  screencap_methods: string; // u64 作为字符串传递
  input_methods: string; // u64 作为字符串传递
  config: string;
}

/** Win32 控制器配置 */
export interface Win32ControllerConfig {
  type: 'Win32';
  handle: number;
  screencap_method: number;
  mouse_method: number;
  keyboard_method: number;
}

/** PlayCover 控制器配置 (macOS) */
export interface PlayCoverControllerConfig {
  type: 'PlayCover';
  address: string;
  uuid?: string;
}

/** Gamepad 控制器配置 */
export interface GamepadControllerConfig {
  type: 'Gamepad';
  handle: number;
}

/** 控制器配置 */
export type ControllerConfig =
  | AdbControllerConfig
  | Win32ControllerConfig
  | PlayCoverControllerConfig
  | GamepadControllerConfig;

/** 连接状态 */
export type ConnectionStatus = 'Disconnected' | 'Connecting' | 'Connected' | { Failed: string };

/** 任务状态 */
export type TaskStatus = 'Pending' | 'Running' | 'Succeeded' | 'Failed';

/** MaaFramework 初始化状态 */
export interface MaaInitState {
  initialized: boolean;
  version: string | null;
  error: string | null;
}

/** 实例运行时信息 */
export interface InstanceRuntimeInfo {
  connectionStatus: ConnectionStatus;
  resourceLoaded: boolean;
  isRunning: boolean;
  currentTaskId: number | null;
  /** 当前运行的任务 ID 列表 */
  taskIds: number[];
}

/** Win32 截图方法 */
export const Win32ScreencapMethod = {
  None: 0n,
  GDI: 1n,
  FramePool: 1n << 1n,
  DXGI_DesktopDup: 1n << 2n,
  DXGI_DesktopDup_Window: 1n << 3n,
  PrintWindow: 1n << 4n,
  ScreenDC: 1n << 5n,
} as const;

/** Win32 输入方法 */
export const Win32InputMethod = {
  None: 0n,
  Seize: 1n,
  SendMessage: 1n << 1n,
  PostMessage: 1n << 2n,
  LegacyEvent: 1n << 3n,
  PostThreadMessage: 1n << 4n,
  SendMessageWithCursorPos: 1n << 5n,
  PostMessageWithCursorPos: 1n << 6n,
} as const;

/** Win32 截图方法名称映射 */
export const Win32ScreencapMethodNames: Record<string, bigint> = {
  GDI: Win32ScreencapMethod.GDI,
  FramePool: Win32ScreencapMethod.FramePool,
  DXGI_DesktopDup: Win32ScreencapMethod.DXGI_DesktopDup,
  DXGI_DesktopDup_Window: Win32ScreencapMethod.DXGI_DesktopDup_Window,
  PrintWindow: Win32ScreencapMethod.PrintWindow,
  ScreenDC: Win32ScreencapMethod.ScreenDC,
};

/** Win32 输入方法名称映射 */
export const Win32InputMethodNames: Record<string, bigint> = {
  Seize: Win32InputMethod.Seize,
  SendMessage: Win32InputMethod.SendMessage,
  PostMessage: Win32InputMethod.PostMessage,
  LegacyEvent: Win32InputMethod.LegacyEvent,
  PostThreadMessage: Win32InputMethod.PostThreadMessage,
  SendMessageWithCursorPos: Win32InputMethod.SendMessageWithCursorPos,
  PostMessageWithCursorPos: Win32InputMethod.PostMessageWithCursorPos,
};

/** 解析 Win32 截图方法名称 */
export function parseWin32ScreencapMethod(name: string): number {
  const method = Win32ScreencapMethodNames[name];
  if (method !== undefined) {
    return Number(method);
  }
  // 默认使用 FramePool
  return Number(Win32ScreencapMethod.FramePool);
}

/** 解析 Win32 输入方法名称 */
export function parseWin32InputMethod(name: string): number {
  const method = Win32InputMethodNames[name];
  if (method !== undefined) {
    return Number(method);
  }
  // 默认使用 Seize
  return Number(Win32InputMethod.Seize);
}

/** Agent 配置（用于启动子进程） */
export interface AgentConfig {
  child_exec: string;
  child_args?: string[];
  identifier?: string;
  /** 连接超时时间（毫秒），-1 表示无限等待 */
  timeout?: number;
}

/** 任务配置 */
export interface TaskConfig {
  entry: string;
  pipeline_override: string;
}
