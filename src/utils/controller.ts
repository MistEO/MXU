import type { ControllerItem, ControllerType, SavedDeviceInfo } from '@/types/interface';
import type { AdbDevice, ControllerConfig } from '@/types/maa';
import {
  parseMacOSInputMethod,
  parseMacOSScreencapMethod,
  parseWin32InputMethod,
  parseWin32ScreencapMethod,
} from '@/types/maa';

export type DesktopWindowControllerType = Extract<ControllerType, 'Win32' | 'MacOS' | 'Gamepad'>;

/** 使用 MaaToolkit 桌面窗口发现流程的控制器类型。 */
export function isDesktopWindowControllerType(
  type: ControllerType | undefined,
): type is DesktopWindowControllerType {
  return type === 'Win32' || type === 'MacOS' || type === 'Gamepad';
}

/**
 * 返回 MaaToolkit 窗口发现所需的筛选条件。
 * PI V2 的 macOS 控制器只有 title_regex，不支持 Win32 的 class_regex。
 */
export function getDesktopWindowFilters(controller: ControllerItem | undefined): {
  classRegex?: string;
  titleRegex?: string;
} {
  if (controller?.type === 'MacOS') {
    return {
      classRegex: undefined,
      titleRegex: controller.macos?.title_regex,
    };
  }

  if (controller?.type === 'Win32') {
    return {
      classRegex: controller.win32?.class_regex,
      titleRegex: controller.win32?.window_regex,
    };
  }

  if (controller?.type === 'Gamepad') {
    return {
      classRegex: controller.gamepad?.class_regex,
      titleRegex: controller.gamepad?.window_regex,
    };
  }

  return {};
}

/** ADB 地址优先，兼容旧配置按名称匹配。 */
export function findMatchingAdbDevice(
  devices: readonly AdbDevice[],
  savedDevice: Pick<SavedDeviceInfo, 'adbDeviceAddress' | 'adbDeviceName'> | undefined,
  requireUnique = false,
): AdbDevice | undefined {
  const address = savedDevice?.adbDeviceAddress;
  // 名称保持原有的大小写和空白匹配语义，避免旧配置行为变化。
  const name = savedDevice?.adbDeviceName;
  const selectMatch = (matches: AdbDevice[]) =>
    matches.length > 0 && (!requireUnique || matches.length === 1) ? matches[0] : undefined;
  const addressMatches = address ? devices.filter((device) => device.address === address) : [];
  const addressMatch = selectMatch(addressMatches);
  if (addressMatch) return addressMatch;
  if (addressMatches.length > 1) {
    const namedMatches = name ? addressMatches.filter((device) => device.name === name) : [];
    return selectMatch(namedMatches) || (requireUnique ? undefined : addressMatches[0]);
  }

  const nameMatches = name ? devices.filter((device) => device.name === name) : [];
  return selectMatch(nameMatches);
}

/** 构建共享桌面窗口选择流程对应的运行时控制器配置。 */
export function buildDesktopWindowControllerConfig(
  controller: ControllerItem | undefined,
  handle: number,
): ControllerConfig | null {
  if (controller?.type === 'Win32') {
    return {
      type: 'Win32',
      handle,
      screencap_method: parseWin32ScreencapMethod(controller.win32?.screencap || ''),
      mouse_method: parseWin32InputMethod(controller.win32?.mouse || ''),
      keyboard_method: parseWin32InputMethod(controller.win32?.keyboard || ''),
      display_short_side: controller.display_short_side,
    };
  }

  if (controller?.type === 'MacOS') {
    return {
      type: 'MacOS',
      handle,
      screencap_method: parseMacOSScreencapMethod(controller.macos?.screencap || ''),
      input_method: parseMacOSInputMethod(controller.macos?.input || ''),
      display_short_side: controller.display_short_side,
    };
  }

  if (controller?.type === 'Gamepad') {
    return {
      type: 'Gamepad',
      handle,
      display_short_side: controller.display_short_side,
    };
  }

  return null;
}

const WORKSTATION_UNLOCK_REQUIREMENT: Record<ControllerType, boolean> = {
  Adb: false,
  Win32: true,
  MacOS: false,
  WlRoots: false,
  PlayCover: false,
  Gamepad: true,
};

/** Whether the controller depends on the interactive Windows desktop. */
export function requiresUnlockedWorkstation(controllerType: ControllerType): boolean {
  // Fail closed for unexpected runtime values loaded from interface.json.
  return WORKSTATION_UNLOCK_REQUIREMENT[controllerType] ?? true;
}
