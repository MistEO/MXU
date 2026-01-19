/**
 * Pipeline Override 生成工具
 * 用于生成任务的 pipeline_override JSON
 */

import type { ProjectInterface, SelectedTask, OptionValue, OptionDefinition } from '@/types/interface';

/**
 * 深度合并对象（源对象的属性会覆盖目标对象的同名属性）
 */
export const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>) => {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      target[key] = source[key];
    }
  }
};

/**
 * 递归处理选项的 pipeline_override
 */
export const processOptionOverride = (
  optionKey: string,
  optionValues: Record<string, OptionValue>,
  overrides: Record<string, unknown>,
  allOptions: Record<string, OptionDefinition>
) => {
  const optionDef = allOptions[optionKey];
  const optionValue = optionValues[optionKey];
  if (!optionDef || !optionValue) return;

  if ((optionValue.type === 'select' || optionValue.type === 'switch') && 'cases' in optionDef) {
    // 找到当前选中的 case
    let caseName: string;
    if (optionValue.type === 'switch') {
      const isChecked = optionValue.value;
      const yesCase = optionDef.cases?.find(c => ['Yes', 'yes', 'Y', 'y'].includes(c.name));
      const noCase = optionDef.cases?.find(c => ['No', 'no', 'N', 'n'].includes(c.name));
      caseName = isChecked ? (yesCase?.name || 'Yes') : (noCase?.name || 'No');
    } else {
      caseName = optionValue.caseName;
    }
    
    const caseDef = optionDef.cases?.find((c) => c.name === caseName);
    
    if (caseDef?.pipeline_override) {
      deepMerge(overrides, caseDef.pipeline_override);
    }
    
    if (caseDef?.option) {
      for (const nestedKey of caseDef.option) {
        processOptionOverride(nestedKey, optionValues, overrides, allOptions);
      }
    }
  } else if (optionValue.type === 'input' && 'pipeline_override' in optionDef && optionDef.pipeline_override) {
    const inputDefs = optionDef.inputs || [];
    let overrideStr = JSON.stringify(optionDef.pipeline_override);
    
    for (const [inputName, inputVal] of Object.entries(optionValue.values)) {
      const inputDef = inputDefs.find(i => i.name === inputName);
      const pipelineType = inputDef?.pipeline_type || 'string';
      const placeholder = `{${inputName}}`;
      const placeholderRegex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      
      if (pipelineType === 'int') {
        overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), inputVal || '0');
        overrideStr = overrideStr.replace(placeholderRegex, inputVal || '0');
      } else if (pipelineType === 'bool') {
        const boolVal = ['true', '1', 'yes', 'y'].includes((inputVal || '').toLowerCase()) ? 'true' : 'false';
        overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), boolVal);
        overrideStr = overrideStr.replace(placeholderRegex, boolVal);
      } else {
        overrideStr = overrideStr.replace(placeholderRegex, inputVal || '');
      }
    }
    
    try {
      deepMerge(overrides, JSON.parse(overrideStr));
    } catch (e) {
      console.warn('解析选项覆盖失败:', e);
    }
  }
};

/**
 * 为单个任务生成 pipeline override JSON
 */
export const generateTaskPipelineOverride = (
  selectedTask: SelectedTask,
  projectInterface: ProjectInterface | null
): string => {
  if (!projectInterface) return '{}';

  const overrides: Record<string, unknown> = {};
  const taskDef = projectInterface.task.find(t => t.name === selectedTask.taskName);
  if (!taskDef) return '{}';

  // 添加任务自身的 pipeline_override
  if (taskDef.pipeline_override) {
    deepMerge(overrides, taskDef.pipeline_override as Record<string, unknown>);
  }

  // 处理顶层选项及其嵌套选项
  if (taskDef.option && projectInterface.option) {
    for (const optionKey of taskDef.option) {
      processOptionOverride(optionKey, selectedTask.optionValues, overrides, projectInterface.option);
    }
  }

  return JSON.stringify(overrides);
};
