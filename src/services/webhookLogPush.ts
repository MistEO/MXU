/**
 * WebHook 日志推送服务
 *
 * 为 MXU_WEBHOOK_LOG 特殊任务提供运行时日志推送：
 * - 前端在收到 Tasker.Task.Starting / Succeeded / Failed 回调时调用 `pushTaskEvent`
 * - title 自动取「APP 名 + 通知」（如 MaaEnd 调用则为 "MaaEnd通知"）
 * - content 自动取「任务名 + 状态」
 * - body 模板中的 {title} / {content} / {time} 在此处替换并做 JSON 转义
 * - 复用 tauri-plugin-http（Tauri 环境）或 fetch（浏览器环境）发送
 */

import { useAppStore } from '@/stores/appStore';
import { MXU_WEBHOOK_LOG_TASK_NAME } from '@/types/specialTasks';
import type { OptionValue } from '@/types/interface';
import { isTauri } from '@/utils/paths';
import { loggers } from '@/utils/logger';

const log = loggers.app;

/** 实例中查找启用的 WebHook 日志推送任务配置；返回 null 表示未配置 */
function findActiveWebhookLogConfig(instanceId: string): {
  url: string;
  method: string;
  headers: string;
  body: string;
} | null {
  const state = useAppStore.getState();
  const instance = state.instances.find((i) => i.id === instanceId);
  if (!instance) return null;

  // 找到启用状态下的 WebHook 日志推送任务
  const logTask = instance.selectedTasks.find(
    (t) => t.taskName === MXU_WEBHOOK_LOG_TASK_NAME && t.enabled,
  );
  if (!logTask) return null;

  // 读取各选项值
  const readInput = (optionKey: string, field: string): string => {
    const v: OptionValue | undefined = logTask.optionValues[optionKey];
    if (v && v.type === 'input') return v.values[field] ?? '';
    return '';
  };
  const readSelect = (optionKey: string): string => {
    const v: OptionValue | undefined = logTask.optionValues[optionKey];
    if (v && v.type === 'select') return v.caseName;
    return '';
  };

  const url = readInput('__MXU_WEBHOOK_LOG_OPTION__', 'url');
  if (!url) return null;
  const method = readSelect('__MXU_WEBHOOK_METHOD_OPTION__') || 'POST';
  const headers = readInput('__MXU_WEBHOOK_LOG_OPTION__', 'headers');
  const body = readInput('__MXU_WEBHOOK_LOG_OPTION__', 'body');

  return { url, method, headers, body };
}

/** 转义嵌入 JSON 字符串字面量的特殊字符（与 Rust 端 escape_json_string 一致） */
function escapeJsonString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

/** 解析自定义 Headers（每行一条，格式：名称: 值） */
function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx > 0) {
      const name = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (name && value) headers[name] = value;
    }
  }
  return headers;
}

/** 组装请求体：替换 {title}/{content}/{time} 占位符并做 JSON 转义 */
function buildBody(bodyTemplate: string, title: string, content: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return bodyTemplate
    .replace(/{title}/g, escapeJsonString(title))
    .replace(/{content}/g, escapeJsonString(content))
    .replace(/{time}/g, time);
}

/**
 * 推送一条任务事件日志。
 * @param instanceId 实例 ID（用于查找 WebHook 日志推送任务配置）
 * @param taskName 任务显示名（如 "每日日常"）
 * @param status 状态：'starting' | 'succeeded' | 'failed'
 */
export async function pushTaskEvent(
  instanceId: string,
  taskName: string,
  status: 'starting' | 'succeeded' | 'failed',
): Promise<void> {
  try {
    const config = findActiveWebhookLogConfig(instanceId);
    if (!config) return;

    // 自动填充 title/content
    const state = useAppStore.getState();
    const appName = state.projectInterface?.name || 'MXU';
    const title = `${appName}通知`;
    const statusText =
      status === 'starting'
        ? '任务开始'
        : status === 'succeeded'
          ? '任务成功'
          : '任务失败';
    const content = `${taskName}：${statusText}`;

    const method = config.method.toUpperCase();
    const body = buildBody(config.body, title, content);
    const headers = parseHeaders(config.headers);
    // POST 且未显式指定 Content-Type 时，默认使用 application/json（与 Rust 端行为一致）
    if (method === 'POST' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    if (isTauri()) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      response = await tauriFetch(config.url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
      });
    } else {
      response = await fetch(config.url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
      });
    }

    if (response.ok) {
      log.info(
        `[WebHook日志推送] ${content} 推送成功 (${response.status}) url=${config.url} body=${body}`,
      );
    } else {
      // 失败时打印完整 url/body，便于排查平台返回 4xx 的原因
      let respBody = '';
      try {
        respBody = await response.text();
      } catch {
        // 忽略读取响应体失败
      }
      log.warn(
        `[WebHook日志推送] ${content} 推送失败 (${response.status} ${response.statusText}) url=${config.url} body=${body} resp=${respBody.slice(0, 500)}`,
      );
    }
  } catch (err) {
    log.warn('[WebHook日志推送] 推送异常:', err);
  }
}
