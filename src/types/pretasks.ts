// ============================================================================
// PI V2 v2.7.0 pretask（预任务）支持
// ----------------------------------------------------------------------------
// 将项目在 interface.json 中声明的 pretask 映射为“伪任务”，复用现有任务的
// 勾选/展开/选项渲染机制，作为卡片显示在任务列表顶部。
// 与 exec_task 的区别在于执行时机：pretask 在连接 Controller 之前执行，且不进入
// Tasker 执行队列，而是通过 run_pretask 直接启动外部程序。
// ============================================================================

import type { ProjectInterface, PretaskItem, TaskItem, OptionValue } from './interface';
import { normalizePretaskConfigs } from './interface';
import { serializeExecTaskOptions } from './execTasks';

/** pretask 伪任务在流程中的入口节点名（pretask 不进 Tasker，仅作占位） */
export const PRETASK_ENTRY = 'MXU_PRETASK';

/** pretask 伪任务名前缀 */
export const PRETASK_NAME_PREFIX = '__MXU_PRETASK__';

/** pretask 条目的稳定标识（缺省 name 时回退到 exec） */
export function pretaskItemId(item: PretaskItem): string {
  return item.name || item.exec;
}

/** 由 pretask 条目生成唯一的伪任务名 */
export function pretaskName(item: PretaskItem): string {
  return PRETASK_NAME_PREFIX + pretaskItemId(item);
}

/** 判断某任务名是否为 pretask 伪任务 */
export function isPretaskName(taskName: string): boolean {
  return taskName.startsWith(PRETASK_NAME_PREFIX);
}

/** 获取当前项目声明的全部 pretask 条目 */
export function getPretaskItems(pi: ProjectInterface | null | undefined): PretaskItem[] {
  if (!pi) return [];
  return normalizePretaskConfigs(pi.pretask) || [];
}

/** 通过伪任务名反查 pretask 条目定义 */
export function getPretaskItem(
  pi: ProjectInterface | null | undefined,
  taskName: string,
): PretaskItem | undefined {
  if (!isPretaskName(taskName)) return undefined;
  return getPretaskItems(pi).find((item) => pretaskName(item) === taskName);
}

/**
 * 由 pretask 条目构造一个供 UI 复用的虚拟 TaskItem。
 * option 直接引用顶层 pi.option，因此可复用标准的选项渲染与初始化。
 */
export function buildPretaskDef(item: PretaskItem): TaskItem {
  return {
    name: pretaskName(item),
    // 缺省 label 时回退到 name / exec，避免展示内部伪任务名
    label: item.label || item.name || item.exec,
    entry: PRETASK_ENTRY,
    description: item.description,
    icon: item.icon,
    option: item.option,
  };
}

/**
 * 构造传给外部程序的完整参数数组：固定 args 后追加序列化后的 option JSON（若有）。
 * pretask 与 exec_task 的 option 语义一致，因此直接复用 exec_task 的序列化实现。
 */
export function buildPretaskArgs(
  item: PretaskItem,
  optionValues: Record<string, OptionValue>,
  pi: ProjectInterface | null | undefined,
  controllerName?: string,
  resourceName?: string,
): string[] {
  const args = [...(item.args || [])];
  const optionJson = serializeExecTaskOptions(item, optionValues, pi, controllerName, resourceName);
  if (optionJson !== undefined) {
    args.push(optionJson);
  }
  return args;
}
