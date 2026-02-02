/**
 * 统一日志服务
 * 基于 loglevel 实现，支持模块化日志、日志级别控制、文件日志
 */

import log from 'loglevel';

// 日志级别类型
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

// 根据环境设置默认日志级别
const isDev = import.meta.env.DEV;
const defaultLevel: LogLevel = isDev ? 'trace' : 'debug';

// 检测是否在 Tauri 环境中
const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window;

// 文件日志配置
let logsDir: string | null = null;

/**
 * 初始化文件日志（自动获取 exe 目录）
 */
async function initFileLogger(): Promise<void> {
  if (!isTauri() || logsDir) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const exeDir = await invoke<string>('get_exe_dir');
    logsDir = `${exeDir.replace(/\\/g, '/').replace(/\/$/, '')}/debug`;

    const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
    if (!(await exists(logsDir))) {
      await mkdir(logsDir, { recursive: true });
    }
    console.log('[Logger] File logger initialized, logs dir:', logsDir);
  } catch (err) {
    console.warn('[Logger] Failed to initialize file logger:', err);
    logsDir = null;
  }
}

// 模块加载时立即初始化文件日志
if (isTauri()) {
  initFileLogger();
}

/**
 * 格式化本地日期时间
 * @param date 日期对象
 * @param format 'date' 返回 YYYY-MM-DD，'datetime' 返回 YYYY-MM-DD HH:mm:ss
 */
function formatLocalDateTime(date: Date, format: 'date' | 'datetime' = 'datetime'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (format === 'date') return datePart;
  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 直接写入日志到文件
 */
async function writeLogToFile(line: string): Promise<void> {
  if (!logsDir) return;

  // 日志文件名：mxu-web-YYYY-MM-DD.log（使用本地日期）
  const logFile = `${logsDir}/mxu-web-${formatLocalDateTime(new Date(), 'date')}.log`;

  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(logFile, line + '\n', { append: true });
  } catch {
    // 写入失败时静默处理
  }
}

// 配置根日志器
log.setLevel(defaultLevel);

// 日志前缀格式化（带时间戳和模块名）+ 文件日志
const originalFactory = log.methodFactory;

log.methodFactory = function (methodName, logLevel, loggerName) {
  const rawMethod = originalFactory(methodName, logLevel, loggerName);

  return function (...args: unknown[]) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const prefix = loggerName ? `[${timestamp}][${String(loggerName)}]` : `[${timestamp}]`;
    rawMethod(prefix, ...args);

    // 写入文件日志
    if (logsDir) {
      const fullTimestamp = formatLocalDateTime(now);
      const level = methodName.toUpperCase().padEnd(5);
      const module = loggerName ? `[${String(loggerName)}]` : '';
      const message = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      writeLogToFile(`${fullTimestamp} ${level} ${module} ${message}`);
    }
  };
};

// 重新应用配置以激活自定义 factory
log.setLevel(log.getLevel());

/**
 * 创建模块专用日志器
 * @param moduleName 模块名称
 * @param level 可选的日志级别（默认继承根日志器级别）
 */
export function createLogger(moduleName: string, level?: LogLevel) {
  const logger = log.getLogger(moduleName);

  // 应用自定义格式 + 文件日志
  logger.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return function (...args: unknown[]) {
      const now = new Date();
      const timestamp = now.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const prefix = `[${timestamp}][${String(loggerName)}]`;
      rawMethod(prefix, ...args);

      // 写入文件日志
      if (logsDir) {
        const fullTimestamp = now.toISOString().replace('T', ' ').slice(0, 19);
        const level = methodName.toUpperCase().padEnd(5);
        const module = loggerName ? `[${String(loggerName)}]` : '';
        const message = args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
          .join(' ');
        writeLogToFile(`${fullTimestamp} ${level} ${module} ${message}`);
      }
    };
  };

  logger.setLevel(level ?? log.getLevel());
  return logger;
}

/**
 * 设置全局日志级别
 */
export function setLogLevel(level: LogLevel) {
  log.setLevel(level);
}

/**
 * 获取当前日志级别
 */
export function getLogLevel(): LogLevel {
  const levels: Record<number, LogLevel> = {
    0: 'trace',
    1: 'debug',
    2: 'info',
    3: 'warn',
    4: 'error',
    5: 'silent',
  };
  return levels[log.getLevel()] || 'warn';
}

// 预创建常用模块的日志器
export const loggers = {
  maa: createLogger('MAA'),
  config: createLogger('Config'),
  device: createLogger('Device'),
  task: createLogger('Task'),
  ui: createLogger('UI'),
  app: createLogger('App'),
};

// 默认导出根日志器
export default log;
