/**
 * Pipeline Override 生成工具
 * 用于生成任务的 pipeline_override JSON
 * MaaFramework 支持数组格式的 pipeline_override，会按顺序依次合并
 */

import type {
  ProjectInterface,
  SelectedTask,
  OptionValue,
  OptionDefinition,
  InputOption,
} from '@/types/interface';
import { isMxuSpecialTask, getMxuSpecialTask } from '@/types/interface';
import { loggers } from './logger';
import { findSwitchCase } from './optionHelpers';
import { createDefaultOptionValue } from '@/stores/helpers';

/**
 * 递归处理选项的 pipeline_override，收集到数组中
 */
const collectOptionOverrides = (
  optionKey: string,
  optionValues: Record<string, OptionValue>,
  overrides: Record<string, unknown>[],
  allOptions: Record<string, OptionDefinition>,
) => {
  const optionDef = allOptions[optionKey];
  if (!optionDef) return;
  const optionValue = optionValues[optionKey] || createDefaultOptionValue(optionDef);

  if ((optionValue.type === 'select' || optionValue.type === 'switch') && 'cases' in optionDef) {
    // 找到当前选中的 case
    let caseName: string;
    if (optionValue.type === 'switch') {
      const isChecked = optionValue.value;
      const switchCase = findSwitchCase(optionDef.cases, isChecked);
      caseName = switchCase?.name || (isChecked ? 'Yes' : 'No');
    } else {
      caseName = optionValue.caseName;
    }

    const caseDef = optionDef.cases?.find((c) => c.name === caseName);

    if (caseDef?.pipeline_override) {
      overrides.push(caseDef.pipeline_override as Record<string, unknown>);
    }

    if (caseDef?.option) {
      for (const nestedKey of caseDef.option) {
        collectOptionOverrides(nestedKey, optionValues, overrides, allOptions);
      }
    }
  } else if (
    optionValue.type === 'input' &&
    'pipeline_override' in optionDef &&
    optionDef.pipeline_override
  ) {
    const inputDefs = optionDef.inputs || [];
    let overrideStr = JSON.stringify(optionDef.pipeline_override);

    for (const inputDef of inputDefs) {
      const inputName = inputDef.name;
      const inputVal = optionValue.values[inputName] ?? inputDef.default ?? '';
      const pipelineType = inputDef.pipeline_type || 'string';
      const placeholder = `{${inputName}}`;
      const placeholderRegex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

      if (pipelineType === 'int') {
        overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), inputVal || '0');
        overrideStr = overrideStr.replace(placeholderRegex, inputVal || '0');
      } else if (pipelineType === 'bool') {
        const boolVal = ['true', '1', 'yes', 'y'].includes((inputVal || '').toLowerCase())
          ? 'true'
          : 'false';
        overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), boolVal);
        overrideStr = overrideStr.replace(placeholderRegex, boolVal);
      } else {
        overrideStr = overrideStr.replace(placeholderRegex, inputVal || '');
      }
    }

    try {
      overrides.push(JSON.parse(overrideStr));
    } catch (e) {
      loggers.task.warn('解析选项覆盖失败:', e);
    }
  }
};

/**
 * 为单个任务生成 pipeline override JSON
 * 返回数组格式的 JSON 字符串，MaaFramework 会按顺序依次合并
 */
export const generateTaskPipelineOverride = (
  selectedTask: SelectedTask,
  projectInterface: ProjectInterface | null,
): string => {
  // 处理 MXU 内置特殊任务
  if (isMxuSpecialTask(selectedTask.taskName)) {
    return generateMxuSpecialTaskOverride(selectedTask);
  }

  if (!projectInterface) return '[]';

  const overrides: Record<string, unknown>[] = [];
  const taskDef = projectInterface.task.find((t) => t.name === selectedTask.taskName);
  if (!taskDef) return '[]';

  // 添加任务自身的 pipeline_override
  if (taskDef.pipeline_override) {
    overrides.push(taskDef.pipeline_override as Record<string, unknown>);
  }

  // 处理顶层选项及其嵌套选项
  if (taskDef.option && projectInterface.option) {
    for (const optionKey of taskDef.option) {
      collectOptionOverrides(
        optionKey,
        selectedTask.optionValues,
        overrides,
        projectInterface.option,
      );
    }
  }

  return JSON.stringify(overrides);
};

/**
 * 生成 MXU 内置特殊任务的 pipeline override
 * 通用化实现：从注册表获取任务定义，根据选项定义生成 override
 */
const generateMxuSpecialTaskOverride = (selectedTask: SelectedTask): string => {
  const specialTask = getMxuSpecialTask(selectedTask.taskName);
  if (!specialTask) {
    loggers.task.warn(`未找到特殊任务定义: ${selectedTask.taskName}`);
    return '[]';
  }

  const overrides: Record<string, unknown>[] = [];
  const { taskDef, optionDefs } = specialTask;

  // 添加任务自身的 pipeline_override（如果有）
  if (taskDef.pipeline_override) {
    overrides.push(taskDef.pipeline_override as Record<string, unknown>);
  }

  // 处理任务的选项
  if (taskDef.option) {
    for (const optionKey of taskDef.option) {
      const optionDef = optionDefs[optionKey];
      if (!optionDef) continue;

      const optionValue =
        selectedTask.optionValues[optionKey] || createDefaultOptionValue(optionDef);

      // 处理 input 类型选项的 pipeline_override
      if (
        optionValue.type === 'input' &&
        optionDef.type === 'input' &&
        optionDef.pipeline_override
      ) {
        const inputDef = optionDef as InputOption;
        let overrideStr = JSON.stringify(inputDef.pipeline_override);

        for (const input of inputDef.inputs || []) {
          const inputName = input.name;
          const inputVal = optionValue.values[inputName] ?? input.default ?? '';
          const pipelineType = input.pipeline_type || 'string';
          const placeholder = `{${inputName}}`;
          const placeholderRegex = new RegExp(
            placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'g',
          );

          if (pipelineType === 'int') {
            overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), inputVal || '0');
            overrideStr = overrideStr.replace(placeholderRegex, inputVal || '0');
          } else if (pipelineType === 'bool') {
            const boolVal = ['true', '1', 'yes', 'y'].includes((inputVal || '').toLowerCase())
              ? 'true'
              : 'false';
            overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), boolVal);
            overrideStr = overrideStr.replace(placeholderRegex, boolVal);
          } else {
            overrideStr = overrideStr.replace(placeholderRegex, inputVal || '');
          }
        }

        try {
          overrides.push(JSON.parse(overrideStr));
        } catch (e) {
          loggers.task.warn('解析特殊任务选项覆盖失败:', e);
        }
      }
    }
  }

  return JSON.stringify(overrides);
};
