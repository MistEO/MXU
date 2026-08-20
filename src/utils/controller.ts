import type { ControllerItem, ControllerType } from '@/types/interface';
import type { ControllerConfig } from '@/types/maa';
import {
  LinuxInputMethod,
  LinuxScreencapMethod,
  parseLinuxInputMethod,
  parseLinuxScreencapMethod,
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
  Linux: false,
  PlayCover: false,
  Gamepad: true,
};

/** Whether the controller depends on the interactive Windows desktop. */
export function requiresUnlockedWorkstation(controllerType: ControllerType): boolean {
  // Fail closed for unexpected runtime values loaded from interface.json.
  return WORKSTATION_UNLOCK_REQUIREMENT[controllerType] ?? true;
}

/** Linux 控制器发现需求描述。 */
export interface LinuxDiscoveryNeeds {
  /** 截图或输入使用 Wlr 时需要 wayland socket */
  needWlrSocket: boolean;
  /** 截图 PipeWire + Gamescope 源时需要 gamescope 节点 */
  needGamescopeNode: boolean;
  /** 输入 Libei 时需要 EIS socket */
  needEisSocket: boolean;
  /** 截图 PipeWire + Portal 源：无需前端发现，连接时后端打开门户 */
  isPortal: boolean;
}

/**
 * 计算 Linux 控制器在运行时需要发现哪些设备。
 */
export function getLinuxDiscoveryNeeds(
  controller: ControllerItem | undefined,
): LinuxDiscoveryNeeds {
  const linux = controller?.linux;
  const screencap = parseLinuxScreencapMethod(linux?.screencap);
  const input = parseLinuxInputMethod(linux?.input);
  const pipewireSource = linux?.pipewire_source ?? 'Gamescope';

  return {
    needWlrSocket: screencap === LinuxScreencapMethod.Wlr || input === LinuxInputMethod.Wlr,
    needGamescopeNode:
      screencap === LinuxScreencapMethod.PipeWire && pipewireSource === 'Gamescope',
    needEisSocket: input === LinuxInputMethod.Libei,
    isPortal: screencap === LinuxScreencapMethod.PipeWire && pipewireSource === 'Portal',
  };
}

/**
 * 构建 Linux 控制器运行时配置。
 *
 * portal 截图时无需传入 pw 节点信息：后端会在 connect 时打开 ScreenCast 门户并填充 FD/节点。
 */
export function buildLinuxControllerConfig(
  controller: ControllerItem | undefined,
  discovery: {
    wlrSocketPath?: string;
    pwNodeId?: number;
    eisSocketPath?: string;
    uinputScreenWidth?: number;
    uinputScreenHeight?: number;
  },
): ControllerConfig {
  const linux = controller?.linux;

  return {
    type: 'Linux',
    screencap_method: parseLinuxScreencapMethod(linux?.screencap),
    input_method: parseLinuxInputMethod(linux?.input),
    pipewire_source: linux?.pipewire_source ?? 'Gamescope',
    wlr_socket_path: discovery.wlrSocketPath,
    pw_node_id: discovery.pwNodeId,
    eis_socket_path: discovery.eisSocketPath,
    uinput_screen_width: discovery.uinputScreenWidth,
    uinput_screen_height: discovery.uinputScreenHeight,
    use_win32_vk_code: linux?.use_win32_vk_code ?? false,
    display_short_side: controller?.display_short_side,
  };
}
