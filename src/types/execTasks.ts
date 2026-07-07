// ============================================================================
// PI V2 v2.7.0 exec_task（外部程序任务）支持
// ----------------------------------------------------------------------------
// 将项目在 interface.json 中声明的 exec_task 映射为“伪任务”，复用现有任务的
// 勾选/拖动/选项渲染机制，运行时通过 MXU_EXEC_TASK_ACTION 自定义动作启动外部程序。
// ============================================================================

import type {
  ProjectInterface,
  ExecTaskItem,
  TaskItem,
  OptionValue,
  OptionDefinition,
} from './interface';
import { normalizeExecTaskConfigs } from './interface';
import { findSwitchCase } from '@/utils/optionHelpers';
import { createDefaultOptionValue, sanitizeOptionValue } from '@/stores/helpers';

/** exec_task 伪任务在 MaaFramework 中的入口节点名 */
export const EXEC_TASK_ENTRY = 'MXU_EXEC_TASK';

/** exec_task 对应的自定义动作名（需与 Rust 端一致） */
export const EXEC_TASK_ACTION = 'MXU_EXEC_TASK_ACTION';

/** exec_task 伪任务名前缀 */
export const EXEC_TASK_NAME_PREFIX = '__MXU_EXEC_TASK__';

/** 这类非视觉任务固定 target，避免在窗口消失后被空识别框拦截 */
const EXEC_TASK_TARGET: [number, number, number, number] = [0, 0, 1, 1];

/** exec_task 条目的稳定标识（缺省 name 时回退到 exec） */
export function execTaskItemId(item: ExecTaskItem): string {
  return item.name || item.exec;
}

/** 由 exec_task 条目生成唯一的伪任务名 */
export function execTaskName(item: ExecTaskItem): string {
  return EXEC_TASK_NAME_PREFIX + execTaskItemId(item);
}

/** 判断某任务名是否为 exec_task 伪任务 */
export function isExecTaskName(taskName: string): boolean {
  return taskName.startsWith(EXEC_TASK_NAME_PREFIX);
}

/** 获取当前项目声明的全部 exec_task 条目 */
export function getExecTaskItems(pi: ProjectInterface | null | undefined): ExecTaskItem[] {
  if (!pi) return [];
  return normalizeExecTaskConfigs(pi.exec_task) || [];
}

/** 通过伪任务名反查 exec_task 条目定义 */
export function getExecTaskItem(
  pi: ProjectInterface | null | undefined,
  taskName: string,
): ExecTaskItem | undefined {
  if (!isExecTaskName(taskName)) return undefined;
  return getExecTaskItems(pi).find((item) => execTaskName(item) === taskName);
}

/**
 * 由 exec_task 条目构造一个供 UI/运行流程复用的虚拟 TaskItem。
 * option 直接引用顶层 pi.option，因此可复用标准的选项渲染与初始化。
 */
export function buildExecTaskDef(item: ExecTaskItem): TaskItem {
  return {
    name: execTaskName(item),
    // 缺省 label 时回退到 name / exec，避免展示内部伪任务名
    label: item.label || item.name || item.exec,
    entry: EXEC_TASK_ENTRY,
    description: item.description,
    icon: item.icon,
    option: item.option,
  };
}

/**
 * 按协议将 exec_task 的 option 当前取值序列化为 { [optionKey]: OptionValue } 对象。
 * - select / switch -> case.name 字符串
 * - checkbox -> case.name 字符串数组
 * - input -> { 输入名: 值 }
 * 递归包含因选择而激活的嵌套 option；跳过不满足 controller/resource 限制的 option。
 */
function collectExecTaskOptionValues(
  optionKey: string,
  optionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
  result: Record<string, unknown>,
  controllerName?: string,
  resourceName?: string,
): void {
  const optionDef = allOptions[optionKey];
  if (!optionDef) return;

  // 过滤不满足当前 controller / resource 的 option
  if (optionDef.controller && optionDef.controller.length > 0) {
    if (!controllerName || !optionDef.controller.includes(controllerName)) return;
  }
  if (optionDef.resource && optionDef.resource.length > 0) {
    if (!resourceName || !optionDef.resource.includes(resourceName)) return;
  }

  if (result[optionKey] !== undefined) return;

  const savedValue = optionValues[optionKey];
  const sanitizedValue = savedValue
    ? sanitizeOptionValue(optionKey, savedValue, allOptions)
    : null;
  const optionValue = sanitizedValue || createDefaultOptionValue(optionDef);

  if (optionValue.type === 'checkbox') {
    result[optionKey] = [...optionValue.caseNames];
    return;
  }

  if (optionValue.type === 'input') {
    const values: Record<string, string> = {};
    if (optionDef.type === 'input') {
      for (const input of optionDef.inputs || []) {
        values[input.name] = optionValue.values[input.name] ?? input.default ?? '';
      }
    }
    result[optionKey] = values;
    return;
  }

  // select / switch
  let caseName: string;
  if (optionValue.type === 'switch') {
    const switchCase =
      'cases' in optionDef ? findSwitchCase(optionDef.cases, optionValue.value) : undefined;
    caseName = switchCase?.name || (optionValue.value ? 'Yes' : 'No');
  } else {
    caseName = optionValue.caseName;
  }
  result[optionKey] = caseName;

  // 递归处理激活 case 的嵌套 option
  if ('cases' in optionDef) {
    const caseDef = optionDef.cases?.find((c) => c.name === caseName);
    if (caseDef?.option) {
      for (const nestedKey of caseDef.option) {
        collectExecTaskOptionValues(
          nestedKey,
          optionValues,
          allOptions,
          result,
          controllerName,
          resourceName,
        );
      }
    }
  }
}

/**
 * 生成 exec_task option 取值的单行紧凑 JSON 字符串。
 * 若 item.option 未设置或为空则返回 undefined（不追加该参数）。
 */
export function serializeExecTaskOptions(
  item: ExecTaskItem,
  optionValues: Record<string, OptionValue>,
  pi: ProjectInterface | null | undefined,
  controllerName?: string,
  resourceName?: string,
): string | undefined {
  if (!item.option || item.option.length === 0) return undefined;
  const allOptions = pi?.option || {};
  const result: Record<string, unknown> = {};
  for (const optionKey of item.option) {
    collectExecTaskOptionValues(
      optionKey,
      optionValues,
      allOptions,
      result,
      controllerName,
      resourceName,
    );
  }
  return JSON.stringify(result);
}

/**
 * 构造 exec_task 伪任务的 pipeline_override JSON 字符串（数组格式）。
 * option 取值不进 pipeline_override，而是按协议追加为 args 的最后一个元素。
 */
export function buildExecTaskPipelineOverride(
  item: ExecTaskItem,
  optionValues: Record<string, OptionValue>,
  pi: ProjectInterface | null | undefined,
  controllerName?: string,
  resourceName?: string,
  cwd?: string,
): string {
  const args = [...(item.args || [])];
  const optionJson = serializeExecTaskOptions(item, optionValues, pi, controllerName, resourceName);
  if (optionJson !== undefined) {
    args.push(optionJson);
  }

  const customActionParam: Record<string, unknown> = {
    exec: item.exec,
    args,
  };
  if (cwd) {
    customActionParam.cwd = cwd;
  }

  const override = {
    [EXEC_TASK_ENTRY]: {
      action: 'Custom',
      custom_action: EXEC_TASK_ACTION,
      target: EXEC_TASK_TARGET,
      custom_action_param: customActionParam,
    },
  };

  return JSON.stringify([override]);
}
