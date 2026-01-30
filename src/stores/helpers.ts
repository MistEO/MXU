import type { OptionValue, OptionDefinition } from '@/types/interface';
import { findSwitchCase } from '@/utils/optionHelpers';

/** 生成唯一 ID */
export const generateId = () => Math.random().toString(36).substring(2, 9);

/** 创建默认选项值 */
export const createDefaultOptionValue = (optionDef: OptionDefinition): OptionValue => {
  if (optionDef.type === 'input') {
    const values: Record<string, string> = {};
    optionDef.inputs.forEach((input) => {
      values[input.name] = input.default || '';
    });
    return { type: 'input', values };
  }

  if (optionDef.type === 'switch') {
    const defaultCase = optionDef.default_case || optionDef.cases[1]?.name || 'No';
    const isYes = ['Yes', 'yes', 'Y', 'y'].includes(defaultCase);
    return { type: 'switch', value: isYes };
  }

  // select type (default)
  const defaultCase = optionDef.default_case || optionDef.cases[0]?.name || '';
  return { type: 'select', caseName: defaultCase };
};

/**
 * 递归初始化所有选项（包括嵌套选项）的默认值
 * @param optionKeys 顶层选项键列表
 * @param allOptions 所有选项定义
 * @param result 结果对象（用于递归累积）
 */
export const initializeAllOptionValues = (
  optionKeys: string[],
  allOptions: Record<string, OptionDefinition>,
  result: Record<string, OptionValue> = {},
): Record<string, OptionValue> => {
  for (const optKey of optionKeys) {
    const optDef = allOptions[optKey];
    if (!optDef) continue;

    // 如果已经初始化过，跳过（避免循环引用）
    if (result[optKey]) continue;

    // 创建当前选项的默认值
    result[optKey] = createDefaultOptionValue(optDef);

    // 处理嵌套选项：根据当前默认值找到对应的 case，递归初始化其子选项
    if (optDef.type === 'switch' || optDef.type === 'select' || !optDef.type) {
      const currentValue = result[optKey];
      let selectedCase;

      if (optDef.type === 'switch' && 'cases' in optDef) {
        const isChecked = currentValue.type === 'switch' && currentValue.value;
        selectedCase = findSwitchCase(optDef.cases, isChecked);
      } else if ('cases' in optDef) {
        const caseName =
          currentValue.type === 'select' ? currentValue.caseName : optDef.cases?.[0]?.name;
        selectedCase = optDef.cases?.find((c) => c.name === caseName);
      }

      // 递归初始化嵌套选项
      if (selectedCase?.option && selectedCase.option.length > 0) {
        initializeAllOptionValues(selectedCase.option, allOptions, result);
      }
    }
  }

  return result;
};
