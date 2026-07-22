// 匿名遥测（数据埋点）前端服务：负责判定构建期是否禁用、以及把 opt-in / DSN 传给 Rust。
//
// 设计要点：
// - DSN 仅来自 interface.json 的 telemetry.sentry.dsn；未声明则不初始化、不上报。
// - 调试 / 开发版本强制禁用，用户开关不可开启。
// - 埋点主体在 Rust（sentry Rust SDK），前端仅做接线，网络发送不阻塞主流程。
// - WebUI（非 Tauri）远程模式不初始化，仅本机 Tauri 进程上报。

import { isDebugVersion } from '@/services/updateService';
import type { ProjectInterface } from '@/types/interface';
import { loggers } from '@/utils/logger';
import { isTauri } from '@/utils/paths';

const log = loggers.telemetry;

/**
 * 构建 / 调试版本是否禁用遥测（用户开关也不可开启）。
 * - MXU 开发模式（vite dev）
 * - 资源项目为非正式版本（DEBUG_VERSION / <1.0.0 / 非 beta|rc 预发布）
 */
export function isTelemetryBlockedByBuild(pi?: ProjectInterface | null): boolean {
  return import.meta.env.DEV || isDebugVersion(pi?.version);
}

/** 传给 Rust 的 Sentry 初始化配置。 */
export interface TelemetryInitConfig {
  /** Sentry DSN（来自 interface.telemetry.sentry.dsn） */
  dsn: string;
  /** 是否启用（用户 opt-in 且非调试版；false 时不实际发送） */
  enabled: boolean;
  /** release：MXU@<mxuVersion>+<appName>@<appVersion> */
  release: string;
  /** 环境标签，如 stable/beta/production */
  environment: string;
  /** 是否启用性能 / 事务上报 */
  tracing: boolean;
  /** 事务采样率 0~1 */
  tracesSampleRate: number;
  /** 资源项目名（interface.name），用于 tag app.name */
  appName: string;
  /** 资源项目版本（interface.version），用于 tag app.version */
  appVersion: string;
  /** MXU 本体版本，用于 tag mxu.version */
  mxuVersion: string;
}

/**
 * 初始化遥测（在前端拿到 interface + config 后调用一次）。
 * 仅在 Tauri 环境执行；失败仅记录警告，不影响主流程。
 */
export async function initTelemetry(config: TelemetryInitConfig): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('telemetry_init', { config });
  } catch (err) {
    log.warn('telemetry_init 调用失败:', err);
  }
}

/**
 * 运行时切换遥测开关（用户在设置里打开 / 关闭时调用）。
 * 关闭时后端会停止发送；开启时若尚未初始化则由后端按已缓存配置重新初始化。
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('telemetry_set_enabled', { enabled });
  } catch (err) {
    log.warn('telemetry_set_enabled 调用失败:', err);
  }
}
