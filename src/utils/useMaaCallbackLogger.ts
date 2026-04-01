/**
 * MAA 回调日志监听 hook
 * 监听 maa-callback 事件并将相关信息添加到日志面板
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { maaService, type MaaCallbackDetails } from '@/services/maaService';
import { useAppStore, type LogType } from '@/stores/appStore';
import { loggers } from '@/utils/logger';
import i18n, { getInterfaceLangKey } from '@/i18n';
import { getMxuSpecialTask, MXU_SPECIAL_TASKS } from '@/types/specialTasks';
import {
  resolveI18nText,
  detectContentType,
  resolveContent,
  markdownToHtmlWithLocalImages,
} from '@/services/contentResolver';
import type { FocusTemplate, FocusDisplayChannel } from '@/types/interface';
import { isConsoleDefinitelyOff, consoleLog, getConsoleOutputMode, type ConsoleOutputMode } from '@/utils/consoleBridge';

const log = loggers.app;

// 每次会话只请求一次通知权限，避免多条 focus 消息重复弹权限弹窗
let focusNotificationPermissionRequested = false;

// task 控制台日志延迟回放缓存：instanceId -> taskId -> messages
const pendingTaskConsoleLogs = new Map<string, Map<number, string[]>>();
const pendingTaskConsoleReplayTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingTaskConsoleReplayRetries = new Map<string, number>();
const PENDING_TASK_CONSOLE_REPLAY_DELAY_MS = 200;
const PENDING_TASK_CONSOLE_MAX_RETRIES = 300;

function replayConsoleLog(message: string) {
  if (!message || isConsoleDefinitelyOff()) return;
  consoleLog(message);
}

function makePendingTaskKey(instanceId: string, taskId: number): string {
  return `${instanceId}:${taskId}`;
}

function enqueuePendingTaskConsoleLog(instanceId: string, taskId: number, message: string) {
  const byTask = pendingTaskConsoleLogs.get(instanceId) || new Map<number, string[]>();
  const queue = byTask.get(taskId) || [];
  queue.push(message);
  byTask.set(taskId, queue);
  pendingTaskConsoleLogs.set(instanceId, byTask);
}

function drainPendingTaskConsoleLogs(instanceId: string, taskId: number): string[] {
  const byTask = pendingTaskConsoleLogs.get(instanceId);
  if (!byTask) return [];
  const queue = byTask.get(taskId) || [];
  byTask.delete(taskId);
  if (byTask.size === 0) {
    pendingTaskConsoleLogs.delete(instanceId);
  }
  return queue;
}

function tryReplayPendingTaskConsoleLogs(instanceId: string, taskId: number): boolean {
  const taskConfigItemId = getTaskConfigItemId(instanceId, taskId);
  if (!taskConfigItemId) return false;

  const key = makePendingTaskKey(instanceId, taskId);
  const timer = pendingTaskConsoleReplayTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTaskConsoleReplayTimers.delete(key);
  }
  pendingTaskConsoleReplayRetries.delete(key);

  const queued = drainPendingTaskConsoleLogs(instanceId, taskId);
  queued.forEach((message) => {
    replayConsoleLog(withTaskConfigIdPrefix(message, taskConfigItemId));
  });
  return true;
}

function schedulePendingTaskConsoleReplay(instanceId: string, taskId: number) {
  const key = makePendingTaskKey(instanceId, taskId);
  if (pendingTaskConsoleReplayTimers.has(key)) return;

  const timer = setTimeout(() => {
    pendingTaskConsoleReplayTimers.delete(key);

    if (tryReplayPendingTaskConsoleLogs(instanceId, taskId)) {
      return;
    }

    const nextRetry = (pendingTaskConsoleReplayRetries.get(key) || 0) + 1;
    if (nextRetry >= PENDING_TASK_CONSOLE_MAX_RETRIES) {
      pendingTaskConsoleReplayRetries.delete(key);
      drainPendingTaskConsoleLogs(instanceId, taskId);
      return;
    }

    pendingTaskConsoleReplayRetries.set(key, nextRetry);
    schedulePendingTaskConsoleReplay(instanceId, taskId);
  }, PENDING_TASK_CONSOLE_REPLAY_DELAY_MS);

  pendingTaskConsoleReplayTimers.set(key, timer);
}

function getRawTaskNameForConsole(
  instanceId: string,
  taskId: number | undefined,
  details: MaaCallbackDetails & Record<string, unknown>,
): string {
  const state = useAppStore.getState();

  // 1. 优先通过 task_id -> selectedTaskId -> selectedTask.taskName
  if (taskId !== undefined) {
    const selectedTaskId = state.maaTaskIdMapping[instanceId]?.[taskId];
    if (selectedTaskId) {
      const instance = state.instances.find((i) => i.id === instanceId);
      const selectedTask = instance?.selectedTasks.find((t) => t.id === selectedTaskId);
      if (selectedTask?.taskName) return selectedTask.taskName;
    }
  }

  const entry = details.entry ? String(details.entry) : undefined;
  if (!entry) return '-';

  // 2. 通过 interface task 的 entry 反查原始 task name
  const interfaceTaskName = state.projectInterface?.task.find((t) => t.entry === entry)?.name;
  if (interfaceTaskName) return interfaceTaskName;

  // 3. 通过 MXU 特殊任务的 entry 反查原始 task name
  const specialTask = Object.values(MXU_SPECIAL_TASKS).find((t) => t.entry === entry);
  if (specialTask) return specialTask.taskName;

  // 4. 最后回退为 entry（避免丢信息）
  return entry;
}

function buildVerboseTaskRawMessage(
  instanceId: string,
  taskId: number | undefined,
  messageType: string,
  details: MaaCallbackDetails & Record<string, unknown>,
): string {
  const rawTaskName = getRawTaskNameForConsole(instanceId, taskId, details);
  switch (messageType) {
    case 'Tasker.Task.Starting':
      return `任务开始: ${rawTaskName}`;
    case 'Tasker.Task.Succeeded':
      return `任务完成: ${rawTaskName}`;
    case 'Tasker.Task.Failed':
      return `任务失败: ${rawTaskName}`;
    default:
      return `${messageType}: ${rawTaskName}`;
  }
}

function buildTaskConsoleMessage(
  instanceId: string,
  taskId: number | undefined,
  messageType: string,
  details: MaaCallbackDetails & Record<string, unknown>,
  consoleMode: ConsoleOutputMode,
): string | null | undefined {
  if (consoleMode !== 'verbose') {
    // ui 模式沿用 UI 已展示文本；off 模式由后端自行忽略
    return undefined;
  }

  const rawMessage = buildVerboseTaskRawMessage(instanceId, taskId, messageType, details);

  if (taskId === undefined) {
    return rawMessage;
  }

  const taskConfigItemId = getTaskConfigItemId(instanceId, taskId);
  if (!taskConfigItemId) {
    enqueuePendingTaskConsoleLog(instanceId, taskId, rawMessage);
    schedulePendingTaskConsoleReplay(instanceId, taskId);
    // 显式抑制本条终端输出，等待映射后回放
    return null;
  }

  // 映射就绪后，先回放此前缓存，再输出当前行
  tryReplayPendingTaskConsoleLogs(instanceId, taskId);
  return withTaskConfigIdPrefix(rawMessage, taskConfigItemId);
}

/** v2.3.0: toast/notification 渠道 - 使用系统通知 */
async function dispatchFocusNotification(message: string) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification('MXU', { body: message });
    } else if (Notification.permission !== 'denied' && !focusNotificationPermissionRequested) {
      focusNotificationPermissionRequested = true;
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification('MXU', { body: message });
      }
    }
  } catch (error) {
    log.warn('Notification not available', error);
  }
}

// Focus 消息的占位符替换（不包含 {image}，由专门函数处理）
function replaceFocusPlaceholders(
  template: string,
  details: MaaCallbackDetails & Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    // {image} 由专门的函数处理，这里跳过
    if (key === 'image') return match;
    const value = details[key];
    if (value !== undefined && value !== null) {
      return String(value);
    }
    return match;
  });
}

/**
 * 解析 focus 消息内容
 * 支持国际化（$开头）、URL、文件路径、Markdown 格式、{image} 截图占位符
 * @param template 模板字符串
 * @param details 回调详情（用于占位符替换）
 * @param instanceId 实例 ID（用于获取截图）
 */
async function resolveFocusContent(
  template: string,
  details: MaaCallbackDetails & Record<string, unknown>,
  instanceId: string,
): Promise<{ message: string; html?: string }> {
  const state = useAppStore.getState();
  const langKey = getInterfaceLangKey(state.language);
  const translations = state.interfaceTranslations[langKey];
  const basePath = state.basePath;

  // 1. 替换普通占位符（不包含 {image}）
  let withPlaceholders = replaceFocusPlaceholders(template, details);

  // 2. 处理 {image} 占位符 - 获取控制器缓存的截图（带超时保护）
  if (withPlaceholders.includes('{image}')) {
    try {
      // 添加超时保护，避免长时间阻塞
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('获取截图超时')), 5000);
      });
      const imagePromise = maaService.getCachedImage(instanceId);

      const imageDataUrl = await Promise.race([imagePromise, timeoutPromise]);
      if (imageDataUrl) {
        // 直接替换为 data URL，用户可自行组装到 Markdown/HTML 中
        withPlaceholders = withPlaceholders.replace(/\{image\}/g, imageDataUrl);
      } else {
        withPlaceholders = withPlaceholders.replace(/\{image\}/g, '');
      }
    } catch (err) {
      log.warn('获取截图失败:', err);
      withPlaceholders = withPlaceholders.replace(/\{image\}/g, '');
    }
  }

  // 3. 处理国际化
  const resolved = resolveI18nText(withPlaceholders, translations);

  // 4. 检测内容类型
  const contentType = detectContentType(resolved);

  // 5. 如果是直接文本，检查是否包含富文本特征
  if (contentType === 'text') {
    // 检测是否包含 Markdown 语法、HTML 标签或 URL
    const hasRichContent =
      /[*_`#\[\]!]/.test(resolved) || // Markdown 语法
      resolved.includes('\n') || // 多行内容
      /<[a-z][\s\S]*?>/i.test(resolved) || // HTML 标签
      /https?:\/\/\S+/.test(resolved); // URL
    if (hasRichContent) {
      const html = await markdownToHtmlWithLocalImages(resolved, basePath);
      return { message: resolved, html };
    }
    return { message: resolved };
  }

  // 6. 加载外部内容（URL 或文件）
  try {
    const loadedContent = await resolveContent(resolved, { translations, basePath });
    // 将加载的内容转换为 HTML（支持 Markdown）
    const html = await markdownToHtmlWithLocalImages(loadedContent, basePath);
    return { message: loadedContent, html };
  } catch (err) {
    log.warn(`加载 focus 内容失败 [${resolved}]:`, err);
    // 加载失败时返回原始文本
    return { message: resolved };
  }
}

// 检查是否是连接动作
function isConnectAction(details: MaaCallbackDetails): boolean {
  return details.action === 'Connect' || details.action === 'connect';
}

// 从当前实例配置推断控制器类型和名称（用于解决回调时序问题）
function inferCtrlInfoFromInstance(instanceId: string): {
  type: 'device' | 'window' | undefined;
  name: string | undefined;
} {
  const state = useAppStore.getState();
  const instance = state.instances.find((i) => i.id === instanceId);
  const savedDevice = instance?.savedDevice;
  // 获取控制器名称：优先使用已选中的，否则使用第一个作为默认值（与 Toolbar.tsx 保持一致）
  const controllerName =
    state.selectedController[instanceId] || state.projectInterface?.controller?.[0]?.name;

  if (!controllerName) return { type: undefined, name: undefined };

  const controller = state.projectInterface?.controller?.find((c) => c.name === controllerName);
  if (!controller) return { type: undefined, name: undefined };

  // 根据控制器类型确定类型和名称
  if (controller.type === 'Win32' || controller.type === 'Gamepad') {
    return { type: 'window', name: savedDevice?.windowName };
  } else if (controller.type === 'Adb') {
    return { type: 'device', name: savedDevice?.adbDeviceName };
  } else if (controller.type === 'PlayCover') {
    return { type: 'device', name: savedDevice?.playcoverAddress };
  }
  return { type: 'device', name: undefined };
}

// 从当前实例配置推断资源显示名称（用于解决回调时序问题，类似 inferCtrlInfoFromInstance）
function inferResInfoFromInstance(instanceId: string): string | undefined {
  const state = useAppStore.getState();
  const resourceName =
    state.selectedResource[instanceId] || state.projectInterface?.resource?.[0]?.name;
  if (!resourceName) return undefined;

  const resource = state.projectInterface?.resource?.find((r) => r.name === resourceName);
  if (!resource) return undefined;

  const langKey = getInterfaceLangKey(state.language);
  const translations = state.interfaceTranslations[langKey];
  return resolveI18nText(resource.label, translations) || resource.name;
}

export function useMaaCallbackLogger() {
  const { t } = useTranslation();
  const { addLog } = useAppStore();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 设置回调监听
    const setupListener = async () => {
      try {
        const consoleMode = await getConsoleOutputMode();
        const unlisten = await maaService.onCallback((message, details) => {
          // 组件已卸载则忽略
          if (cancelled) return;

          // 获取当前活动实例 ID
          const currentActiveId = useAppStore.getState().activeInstanceId;
          if (!currentActiveId) return;

          // 根据消息类型处理
          handleCallback(
            currentActiveId,
            message,
            details as MaaCallbackDetails & Record<string, unknown>,
            consoleMode,
            t,
            addLog,
          );
        });

        // 如果在等待期间组件已卸载，立即取消监听
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      } catch (err) {
        log.error('Failed to setup maa callback listener:', err);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [t, addLog]);
}

/**
 * 根据 task_id 获取任务显示名
 * 优先使用 maaTaskIdMapping 查找 selectedTaskId，然后从实例任务列表获取显示名
 * 这样可以避免 entry 覆盖问题和竞态条件
 */
function getTaskDisplayName(
  instanceId: string,
  taskId: number | undefined,
  entry: string | undefined,
): string | undefined {
  const state = useAppStore.getState();

  // 1. 优先通过 task_id 查找
  if (taskId !== undefined) {
    // 先尝试 taskIdToName（快速路径）
    const directName = state.taskIdToName[taskId];
    if (directName) return directName;

    // 通过 maaTaskIdMapping 查找 selectedTaskId，然后从实例任务列表获取
    const selectedTaskId = state.maaTaskIdMapping[instanceId]?.[taskId];
    if (selectedTaskId) {
      const instance = state.instances.find((i) => i.id === instanceId);
      const selectedTask = instance?.selectedTasks.find((t) => t.id === selectedTaskId);
      if (selectedTask) {
        if (selectedTask.customName) return selectedTask.customName;

        // 检查是否为 MXU 特殊任务（使用 i18n.t 翻译 label）
        const specialTask = getMxuSpecialTask(selectedTask.taskName);
        if (specialTask?.taskDef.label) {
          return i18n.t(specialTask.taskDef.label);
        }

        // 普通任务：使用项目接口翻译
        const taskDef = state.projectInterface?.task.find((t) => t.name === selectedTask.taskName);
        const langKey = getInterfaceLangKey(state.language);
        const translations = state.interfaceTranslations[langKey];
        return resolveI18nText(taskDef?.label, translations) || selectedTask.taskName;
      }
    }
  }

  // 2. 尝试通过 entry 查找（兼容旧逻辑，但优先级降低）
  if (entry) {
    return state.entryToTaskName[entry];
  }

  return undefined;
}

function getTaskConfigItemId(instanceId: string, taskId: number | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  const state = useAppStore.getState();
  return state.maaTaskIdMapping[instanceId]?.[taskId];
}

function withTaskConfigIdPrefix(message: string, taskConfigItemId: string): string {
  return `[${taskConfigItemId}] ${message}`;
}

function handleCallback(
  instanceId: string,
  message: string,
  details: MaaCallbackDetails & Record<string, unknown>,
  consoleMode: ConsoleOutputMode,
  t: (key: string, options?: Record<string, unknown>) => string,
  addLog: (
    instanceId: string,
    log: { type: LogType; message: string; html?: string; consoleMessage?: string | null },
  ) => void,
) {
  // 获取 ID 名称映射函数
  const { getCtrlName, getCtrlType, getResName, getResBatchInfo } = useAppStore.getState();

  // 首先检查是否有 focus 字段，有则优先处理 focus 消息
  const focus = details.focus as Record<string, FocusTemplate> | undefined;
  if (focus && focus[message]) {
    const focusEntry = focus[message];

    // v2.3.0: 解析 focus 模板（支持字符串简写和对象完整写法）
    let focusTemplate: string;
    let displayChannels: FocusDisplayChannel[];
    if (typeof focusEntry === 'string') {
      focusTemplate = focusEntry;
      displayChannels = ['log'];
    } else {
      focusTemplate = focusEntry.content;
      const d = focusEntry.display;
      displayChannels = d ? (Array.isArray(d) ? d : [d]) : ['log'];
    }

    // 如果包含 {image} 占位符，先快速显示不含图片的版本，避免阻塞
    const hasImagePlaceholder = focusTemplate.includes('{image}');
    if (hasImagePlaceholder && displayChannels.includes('log')) {
      const tempMessage = replaceFocusPlaceholders(focusTemplate, details).replace(
        /\{image\}/g,
        '[图片加载中...]',
      );
      addLog(instanceId, { type: 'focus', message: tempMessage });
    }

    resolveFocusContent(focusTemplate, details, instanceId)
      .then((resolved) => {
        // 根据 display 渠道分发消息
        for (const channel of displayChannels) {
          switch (channel) {
            case 'log':
              if (!hasImagePlaceholder) {
                addLog(instanceId, {
                  type: 'focus',
                  message: resolved.message,
                  html: resolved.html,
                });
              }
              break;
            case 'toast':
            case 'notification':
              dispatchFocusNotification(resolved.message);
              break;
            case 'dialog':
            case 'modal':
              // dialog 和 modal 当前都作为 log 处理，将来可扩展为弹窗
              addLog(instanceId, { type: 'focus', message: resolved.message, html: resolved.html });
              break;
          }
        }
      })
      .catch((err) => {
        log.warn('Failed to resolve focus content:', err);
        if (!hasImagePlaceholder && displayChannels.includes('log')) {
          addLog(instanceId, { type: 'focus', message: focusTemplate });
        }
      });

    return;
  }

  // 处理各种消息类型
  switch (message) {
    // ==================== 控制器连接消息 ====================
    case 'Controller.Action.Starting':
      if (isConnectAction(details)) {
        // 优先从注册信息获取，未注册时从实例配置推断（解决回调时序问题）
        const registeredName =
          details.ctrl_id !== undefined ? getCtrlName(details.ctrl_id) : undefined;
        const registeredType =
          details.ctrl_id !== undefined ? getCtrlType(details.ctrl_id) : undefined;
        const inferred = inferCtrlInfoFromInstance(instanceId);
        const deviceName = registeredName || inferred.name || '';
        const ctrlType = registeredType || inferred.type;
        const targetText =
          ctrlType === 'window' ? t('logs.messages.targetWindow') : t('logs.messages.targetDevice');
        addLog(instanceId, {
          type: 'info',
          message: `${t('logs.messages.connecting', { target: targetText })} ${deviceName}`,
        });
      }
      break;

    case 'Controller.Action.Succeeded':
      if (isConnectAction(details)) {
        const registeredName =
          details.ctrl_id !== undefined ? getCtrlName(details.ctrl_id) : undefined;
        const registeredType =
          details.ctrl_id !== undefined ? getCtrlType(details.ctrl_id) : undefined;
        const inferred = inferCtrlInfoFromInstance(instanceId);
        const deviceName = registeredName || inferred.name || '';
        const ctrlType = registeredType || inferred.type;
        const targetText =
          ctrlType === 'window' ? t('logs.messages.targetWindow') : t('logs.messages.targetDevice');
        addLog(instanceId, {
          type: 'success',
          message: `${t('logs.messages.connected', { target: targetText })} ${deviceName}`,
        });
      }
      break;

    case 'Controller.Action.Failed':
      if (isConnectAction(details)) {
        const registeredName =
          details.ctrl_id !== undefined ? getCtrlName(details.ctrl_id) : undefined;
        const registeredType =
          details.ctrl_id !== undefined ? getCtrlType(details.ctrl_id) : undefined;
        const inferred = inferCtrlInfoFromInstance(instanceId);
        const deviceName = registeredName || inferred.name || '';
        const ctrlType = registeredType || inferred.type;
        const targetText =
          ctrlType === 'window' ? t('logs.messages.targetWindow') : t('logs.messages.targetDevice');
        addLog(instanceId, {
          type: 'error',
          message: `${t('logs.messages.connectFailed', { target: targetText })} ${deviceName}`,
        });
      }
      break;

    // ==================== 资源加载消息 ====================
    case 'Resource.Loading.Starting': {
      const batchInfo = details.res_id !== undefined ? getResBatchInfo(details.res_id) : undefined;
      // 批量加载时只显示第一个 path 的"开始加载"
      if (batchInfo && !batchInfo.isFirst) break;
      const registeredName = details.res_id !== undefined ? getResName(details.res_id) : undefined;
      const inferredName = inferResInfoFromInstance(instanceId);
      const resourceName = registeredName || inferredName;
      addLog(instanceId, {
        type: 'info',
        message: t('logs.messages.loadingResource', {
          name: resourceName || details.path || '',
        }),
      });
      break;
    }

    case 'Resource.Loading.Succeeded': {
      const batchInfo = details.res_id !== undefined ? getResBatchInfo(details.res_id) : undefined;
      // 批量加载时只显示最后一个 path 的"加载成功"
      if (batchInfo && !batchInfo.isLast) break;
      const registeredName = details.res_id !== undefined ? getResName(details.res_id) : undefined;
      const inferredName = inferResInfoFromInstance(instanceId);
      const resourceName = registeredName || inferredName;
      addLog(instanceId, {
        type: 'success',
        message: t('logs.messages.resourceLoaded', { name: resourceName || details.path || '' }),
      });
      break;
    }

    case 'Resource.Loading.Failed': {
      const registeredName = details.res_id !== undefined ? getResName(details.res_id) : undefined;
      const inferredName = inferResInfoFromInstance(instanceId);
      const resourceName = registeredName || inferredName;
      addLog(instanceId, {
        type: 'error',
        message: t('logs.messages.resourceFailed', {
          name: `${resourceName} ${details.path}` || '',
        }),
      });
      break;
    }

    // ==================== 任务消息 ====================
    case 'Tasker.Task.Starting': {
      // 特殊处理内部停止任务
      if (details.entry === 'MaaTaskerPostStop') {
        const uiMessage = t('logs.messages.taskStarting', { name: t('logs.messages.stopTask') });
        addLog(instanceId, {
          type: 'info',
          message: uiMessage,
          consoleMessage: buildTaskConsoleMessage(
            instanceId,
            details.task_id,
            message,
            details,
            consoleMode,
          ),
        });
        break;
      }
      // 使用改进的任务名查找逻辑，避免 entry 覆盖和竞态问题
      const taskName = getTaskDisplayName(instanceId, details.task_id, details.entry);
      const uiMessage = t('logs.messages.taskStarting', {
        name: taskName || details.entry || '',
      });
      addLog(instanceId, {
        type: 'info',
        message: uiMessage,
        consoleMessage: buildTaskConsoleMessage(
          instanceId,
          details.task_id,
          message,
          details,
          consoleMode,
        ),
      });
      break;
    }

    case 'Tasker.Task.Succeeded': {
      // 特殊处理内部停止任务
      if (details.entry === 'MaaTaskerPostStop') {
        const uiMessage = t('logs.messages.taskSucceeded', { name: t('logs.messages.stopTask') });
        addLog(instanceId, {
          type: 'success',
          message: uiMessage,
          consoleMessage: buildTaskConsoleMessage(
            instanceId,
            details.task_id,
            message,
            details,
            consoleMode,
          ),
        });
        break;
      }
      const taskName = getTaskDisplayName(instanceId, details.task_id, details.entry);
      const uiMessage = t('logs.messages.taskSucceeded', {
        name: taskName || details.entry || '',
      });
      addLog(instanceId, {
        type: 'success',
        message: uiMessage,
        consoleMessage: buildTaskConsoleMessage(
          instanceId,
          details.task_id,
          message,
          details,
          consoleMode,
        ),
      });
      break;
    }

    case 'Tasker.Task.Failed': {
      // 特殊处理内部停止任务
      if (details.entry === 'MaaTaskerPostStop') {
        const uiMessage = t('logs.messages.taskFailed', { name: t('logs.messages.stopTask') });
        addLog(instanceId, {
          type: 'error',
          message: uiMessage,
          consoleMessage: buildTaskConsoleMessage(
            instanceId,
            details.task_id,
            message,
            details,
            consoleMode,
          ),
        });
        break;
      }
      const taskName = getTaskDisplayName(instanceId, details.task_id, details.entry);
      const uiMessage = t('logs.messages.taskFailed', {
        name: taskName || details.entry || '',
      });
      addLog(instanceId, {
        type: 'error',
        message: uiMessage,
        consoleMessage: buildTaskConsoleMessage(
          instanceId,
          details.task_id,
          message,
          details,
          consoleMode,
        ),
      });
      break;
    }

    // ==================== 节点消息（仅在有 focus 时显示，否则忽略）====================
    // 这些消息只有在 focus 配置时才显示，上面已经处理过了
    case 'Node.Recognition.Starting':
    case 'Node.Recognition.Succeeded':
    case 'Node.Recognition.Failed':
    case 'Node.Action.Starting':
    case 'Node.Action.Succeeded':
    case 'Node.Action.Failed':
    case 'Node.PipelineNode.Starting':
    case 'Node.PipelineNode.Succeeded':
    case 'Node.PipelineNode.Failed':
    case 'Node.NextList.Starting':
    case 'Node.NextList.Succeeded':
    case 'Node.NextList.Failed':
      // 没有 focus 配置时不显示这些消息
      break;

    default:
      // 未知消息类型，可以选择记录到控制台
      // log.debug('Unknown maa callback:', message, details);
      break;
  }
}

/**
 * 监听 Agent 输出事件
 */
export function useMaaAgentLogger() {
  const { addLog } = useAppStore();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const setupListener = async () => {
      try {
        // 监听 agent 输出事件
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen<{ instance_id: string; stream: string; line: string }>(
          'maa-agent-output',
          (event) => {
            // 组件已卸载则忽略
            if (cancelled) return;

            const { instance_id, line } = event.payload;

            // 复用 resolveFocusContent 解析内容，支持国际化、URL、文件、Markdown、{image} 等
            resolveFocusContent(
              line,
              {} as MaaCallbackDetails & Record<string, unknown>,
              instance_id,
            )
              .then((resolved) => {
                if (cancelled) return;
                addLog(instance_id, {
                  type: 'agent',
                  message: resolved.message,
                  html: resolved.html,
                });
              })
              .catch((err) => {
                log.warn('Failed to resolve agent content:', err);
                if (cancelled) return;
                // 降级：直接显示原始内容
                addLog(instance_id, {
                  type: 'agent',
                  message: line,
                });
              });
          },
        );

        // 如果在等待期间组件已卸载，立即取消监听
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      } catch (err) {
        log.warn('Failed to setup agent output listener:', err);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [addLog]);
}
