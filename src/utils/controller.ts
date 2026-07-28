import type { ControllerType } from '@/types/interface';

const WORKSTATION_UNLOCK_REQUIREMENT: Record<ControllerType, boolean> = {
  Adb: false,
  Win32: true,
  WlRoots: false,
  PlayCover: false,
  Gamepad: true,
};

/** Whether the controller depends on the interactive Windows desktop. */
export function requiresUnlockedWorkstation(controllerType: ControllerType): boolean {
  // Fail closed for unexpected runtime values loaded from interface.json.
  return WORKSTATION_UNLOCK_REQUIREMENT[controllerType] ?? true;
}
