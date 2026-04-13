import type { LogEntry } from '@/stores/types';

const RUNTIME_LOG_STORAGE_KEY = 'mxu.runtime-logs.v1';
const STORAGE_VERSION = 1;
const DEFAULT_MAX_LOGS_PER_INSTANCE = 2000;

interface PersistedLogEntry {
  id: string;
  timestamp: string;
  type: LogEntry['type'];
  message: string;
  html?: string;
}

interface PersistedRuntimeLogs {
  version: number;
  savedAt: string;
  logs: Record<string, PersistedLogEntry[]>;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_MAX_LOGS_PER_INSTANCE;
  return Math.min(10000, Math.max(100, Math.floor(limit)));
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function sanitizeLogEntries(
  entries: readonly (LogEntry | PersistedLogEntry)[],
  limit: number,
  now: Date,
): LogEntry[] {
  const deduped = new Map<string, LogEntry>();

  for (const entry of entries) {
    const timestamp = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
    if (Number.isNaN(timestamp.getTime()) || !isSameLocalDay(timestamp, now)) continue;

    deduped.set(entry.id, {
      id: entry.id,
      timestamp,
      type: entry.type,
      message: entry.message,
      html: entry.html,
    });
  }

  return [...deduped.values()]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-limit);
}

function sanitizeRuntimeLogs(
  logs: Record<string, readonly (LogEntry | PersistedLogEntry)[]>,
  maxLogsPerInstance: number,
  now: Date = new Date(),
): Record<string, LogEntry[]> {
  const limit = normalizeLimit(maxLogsPerInstance);
  return Object.fromEntries(
    Object.entries(logs)
      .map(
        ([instanceId, entries]) => [instanceId, sanitizeLogEntries(entries, limit, now)] as const,
      )
      .filter(([, entries]) => entries.length > 0),
  );
}

export function loadPersistedRuntimeLogs(maxLogsPerInstance: number): Record<string, LogEntry[]> {
  if (!canUseLocalStorage()) return {};

  try {
    const raw = window.localStorage.getItem(RUNTIME_LOG_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as PersistedRuntimeLogs;
    if (parsed.version !== STORAGE_VERSION || !parsed.logs || typeof parsed.logs !== 'object') {
      clearPersistedRuntimeLogs();
      return {};
    }

    const sanitized = sanitizeRuntimeLogs(parsed.logs, maxLogsPerInstance);
    if (Object.keys(sanitized).length === 0) {
      clearPersistedRuntimeLogs();
      return {};
    }

    return sanitized;
  } catch {
    clearPersistedRuntimeLogs();
    return {};
  }
}

export function persistRuntimeLogs(
  logs: Record<string, readonly LogEntry[]>,
  maxLogsPerInstance: number,
): void {
  if (!canUseLocalStorage()) return;

  const sanitized = sanitizeRuntimeLogs(logs, maxLogsPerInstance);
  if (Object.keys(sanitized).length === 0) {
    clearPersistedRuntimeLogs();
    return;
  }

  const payload: PersistedRuntimeLogs = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    logs: Object.fromEntries(
      Object.entries(sanitized).map(([instanceId, entries]) => [
        instanceId,
        entries.map((entry) => ({
          id: entry.id,
          timestamp: entry.timestamp.toISOString(),
          type: entry.type,
          message: entry.message,
          html: entry.html,
        })),
      ]),
    ),
  };

  window.localStorage.setItem(RUNTIME_LOG_STORAGE_KEY, JSON.stringify(payload));
}

export function clearPersistedRuntimeLogs(
  instanceId?: string,
  maxLogsPerInstance: number = DEFAULT_MAX_LOGS_PER_INSTANCE,
): void {
  if (!canUseLocalStorage()) return;

  if (!instanceId) {
    window.localStorage.removeItem(RUNTIME_LOG_STORAGE_KEY);
    return;
  }

  const existing = loadPersistedRuntimeLogs(maxLogsPerInstance);
  if (!(instanceId in existing)) return;

  const { [instanceId]: _, ...rest } = existing;
  if (Object.keys(rest).length === 0) {
    window.localStorage.removeItem(RUNTIME_LOG_STORAGE_KEY);
    return;
  }

  persistRuntimeLogs(rest, maxLogsPerInstance);
}

export function mergeRuntimeLogs(
  maxLogsPerInstance: number,
  ...sources: Array<Record<string, readonly LogEntry[]>>
): Record<string, LogEntry[]> {
  const merged = new Map<string, LogEntry[]>();

  for (const source of sources) {
    for (const [instanceId, entries] of Object.entries(source)) {
      const current = merged.get(instanceId) ?? [];
      merged.set(instanceId, [...current, ...entries]);
    }
  }

  return sanitizeRuntimeLogs(Object.fromEntries(merged.entries()), maxLogsPerInstance);
}
