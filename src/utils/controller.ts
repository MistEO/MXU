import type { ControllerType } from '@/types/interface';

/** Whether the controller depends on the interactive Windows desktop. */
export function requiresUnlockedWorkstation(controllerType?: ControllerType): boolean {
  return controllerType === 'Win32' || controllerType === 'Gamepad';
}
