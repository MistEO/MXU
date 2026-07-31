import { invoke } from '@tauri-apps/api/core';
import { getCurrentLogFileName } from './logger';

export type OnErrorCleanupScope = 'oldSessionOnly' | 'includeCurrentWhenIdle';

export interface ClearLogFilesArgs extends Record<string, unknown> {
  excludeFileName?: string | null;
  onErrorScope?: OnErrorCleanupScope;
}

export interface LogCleanupReport {
  logFilesDeleted: number;
  onErrorFilesDeleted: number;
  protectedFiles: number;
  failures: number;
  onErrorScopeApplied: 'oldSessionOnly' | 'allExisting';
}

export async function clearDiskLogFiles(
  onErrorScope?: OnErrorCleanupScope,
): Promise<LogCleanupReport> {
  const args: ClearLogFilesArgs = {
    excludeFileName: getCurrentLogFileName(),
    ...(onErrorScope === undefined ? {} : { onErrorScope }),
  };
  return invoke<LogCleanupReport>('clear_log_files', args);
}
