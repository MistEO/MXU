/**
 * MAA 回调日志监听 hook
 * 监听 maa-callback 事件并将相关信息添加到日志面板
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { maaService, type MaaCallbackDetails } from '@/services/maaService';
import { useAppStore, type LogType } from '@/stores/appStore';
import { loggers } from '@/utils/logger';
import { getInterfaceLangKey } from '@/i18n';
import {
  resolveI18nText,
  detectContentType,
  resolveContent,
  markdownToHtmlWithLocalImages,
} from '@/services/contentResolver';

const log = loggers.app;

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

  // 2. 处理 {image} 占位符 - 获取控制器缓存的截图
  if (withPlaceholders.includes('{image}')) {
    try {
      const imageDataUrl = await maaService.getCachedImage(instanceId);
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

  // 5. 如果是直接文本，检查是否包含 Markdown 格式
  if (contentType === 'text') {
    // 检测是否包含 Markdown 特征（链接、加粗、代码、图片等）
    const hasMarkdown = /[*_`#\[\]!]/.test(resolved) || resolved.includes('\n');
    if (hasMarkdown) {
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
  const controllerName = state.selectedController[instanceId];

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

export function useMaaCallbackLogger() {
  const { t } = useTranslation();
  const { addLog } = useAppStore();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 设置回调监听
    const setupListener = async () => {
      try {
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

async function handleCallback(
  instanceId: string,
  message: string,
  details: MaaCallbackDetails & Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
  addLog: (instanceId: string, log: { type: LogType; message: string; html?: string }) => void,
) {
  // 获取 ID 名称映射函数
  const { getCtrlName, getCtrlType, getResName, getTaskName, getTaskNameByEntry } =
    useAppStore.getState();

  // 首先检查是否有 focus 字段，有则优先处理 focus 消息
  const focus = details.focus as Record<string, string> | undefined;
  if (focus && focus[message]) {
    const focusTemplate = focus[message];
    // 异步解析 focus 内容（支持国际化、URL、文件、Markdown、{image} 截图）
    const resolved = await resolveFocusContent(focusTemplate, details, instanceId);
    addLog(instanceId, { type: 'focus', message: resolved.message, html: resolved.html });
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
      const resourceName = details.res_id !== undefined ? getResName(details.res_id) : undefined;
      addLog(instanceId, {
        type: 'info',
        message: t('logs.messages.loadingResource', {
          name: resourceName || details.path || '',
        }),
      });
      break;
    }

    case 'Resource.Loading.Succeeded': {
      const resourceName = details.res_id !== undefined ? getResName(details.res_id) : undefined;
      addLog(instanceId, {
        type: 'success',
        message: t('logs.messages.resourceLoaded', { name: resourceName || details.path || '' }),
      });
      break;
    }

    case 'Resource.Loading.Failed': {
      const resourceName = details.res_id !== undefined ? getResName(details.res_id) : undefined;
      addLog(instanceId, {
        type: 'error',
        message: t('logs.messages.resourceFailed', { name: resourceName || details.path || '' }),
      });
      break;
    }

    // ==================== 任务消息 ====================
    case 'Tasker.Task.Starting': {
      // 特殊处理内部停止任务
      if (details.entry === 'MaaTaskerPostStop') {
        addLog(instanceId, {
          type: 'info',
          message: t('logs.messages.taskStarting', { name: t('logs.messages.stopTask') }),
        });
        break;
      }
      // 优先用 task_id 查找，如果没有则用 entry 查找（解决时序问题）
      let taskName = details.task_id !== undefined ? getTaskName(details.task_id) : undefined;
      if (!taskName && details.entry) {
        taskName = getTaskNameByEntry(details.entry);
      }
      addLog(instanceId, {
        type: 'info',
        message: t('logs.messages.taskStarting', {
          name: taskName || details.entry || '',
        }),
      });
      break;
    }

    case 'Tasker.Task.Succeeded': {
      // 特殊处理内部停止任务
      if (details.entry === 'MaaTaskerPostStop') {
        addLog(instanceId, {
          type: 'success',
          message: t('logs.messages.taskSucceeded', { name: t('logs.messages.stopTask') }),
        });
        break;
      }
      let taskName = details.task_id !== undefined ? getTaskName(details.task_id) : undefined;
      if (!taskName && details.entry) {
        taskName = getTaskNameByEntry(details.entry);
      }
      addLog(instanceId, {
        type: 'success',
        message: t('logs.messages.taskSucceeded', {
          name: taskName || details.entry || '',
        }),
      });
      break;
    }

    case 'Tasker.Task.Failed': {
      // 特殊处理内部停止任务
      if (details.entry === 'MaaTaskerPostStop') {
        addLog(instanceId, {
          type: 'error',
          message: t('logs.messages.taskFailed', { name: t('logs.messages.stopTask') }),
        });
        break;
      }
      let taskName = details.task_id !== undefined ? getTaskName(details.task_id) : undefined;
      if (!taskName && details.entry) {
        taskName = getTaskNameByEntry(details.entry);
      }
      addLog(instanceId, {
        type: 'error',
        message: t('logs.messages.taskFailed', {
          name: taskName || details.entry || '',
        }),
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
            // 使用 agent 类型显示输出
            addLog(instance_id, {
              type: 'agent',
              message: line,
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
