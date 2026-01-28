/**
 * 选项相关的工具函数
 */

import type { CaseItem } from '@/types/interface';

const YES_CASE_NAMES = ['Yes', 'yes', 'Y', 'y'] as const;

const NO_CASE_NAMES = ['No', 'no', 'N', 'n'] as const;

/**
 * 根据 Switch 的选中状态查找对应的 case
 * @param cases case 列表
 * @param isChecked switch 是否选中
 * @returns 匹配的 case，如果没有找到返回 undefined
 */
export function findSwitchCase(
  cases: CaseItem[] | undefined,
  isChecked: boolean,
): CaseItem | undefined {
  if (!cases) return undefined;
  
  const targetNames: readonly string[] = isChecked ? YES_CASE_NAMES : NO_CASE_NAMES;
  return cases.find((c) => targetNames.includes(c.name));
}
