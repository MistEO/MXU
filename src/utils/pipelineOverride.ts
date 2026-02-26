/**
 * Pipeline Override 生成工具
 * 用于生成任务的 pipeline_override JSON
 * MaaFramework 支持数组格式的 pipeline_override，会按顺序依次覆盖（同名字段完整替换，非深合并）
 */

import type {
  ProjectInterface,
  SelectedTask,
  OptionValue,
  OptionDefinition,
} from '@/types/interface';
import { isMxuSpecialTask, getMxuSpecialTask } from '@/types/specialTasks';
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

  if (optionValue.type === 'checkbox' && optionDef.type === 'checkbox') {
    // v2.3.0: checkbox 多选类型，按 cases 定义顺序合并所有选中的 case
    const selectedNames = new Set(optionValue.caseNames);
    for (const caseDef of optionDef.cases) {
      if (selectedNames.has(caseDef.name) && caseDef.pipeline_override) {
        overrides.push(caseDef.pipeline_override as Record<string, unknown>);
      }
    }
  } else if ((optionValue.type === 'select' || optionValue.type === 'switch') && 'cases' in optionDef) {
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
 * 返回数组格式的 JSON 字符串，MaaFramework 会按顺序依次覆盖（同名字段完整替换）
 *
 * v2.3.0 覆盖顺序：global_option < resource.option < controller.option < task.option
 */
export const generateTaskPipelineOverride = (
  selectedTask: SelectedTask,
  projectInterface: ProjectInterface | null,
  controllerName?: string,
  resourceName?: string,
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

  if (projectInterface.option) {
    // v2.3.0 覆盖顺序：global_option → resource.option → controller.option → task.option
    // 1. 全局选项（优先级最低）
    if (projectInterface.global_option) {
      for (const optionKey of projectInterface.global_option) {
        collectOptionOverrides(optionKey, selectedTask.optionValues, overrides, projectInterface.option);
      }
    }

    // 2. 资源包级选项
    if (resourceName) {
      const resourceDef = projectInterface.resource.find((r) => r.name === resourceName);
      if (resourceDef?.option) {
        for (const optionKey of resourceDef.option) {
          collectOptionOverrides(optionKey, selectedTask.optionValues, overrides, projectInterface.option);
        }
      }
    }

    // 3. 控制器级选项
    if (controllerName) {
      const controllerDef = projectInterface.controller.find((c) => c.name === controllerName);
      if (controllerDef?.option) {
        for (const optionKey of controllerDef.option) {
          collectOptionOverrides(optionKey, selectedTask.optionValues, overrides, projectInterface.option);
        }
      }
    }

    // 4. 任务级选项（优先级最高）
    if (taskDef.option) {
      for (const optionKey of taskDef.option) {
        collectOptionOverrides(optionKey, selectedTask.optionValues, overrides, projectInterface.option);
      }
    }
  }

  return JSON.stringify(overrides);
};

/**
 * 深合并多个对象（递归合并嵌套对象，非对象值后者覆盖前者）
 * 用于在前端侧合并多个 pipeline_override，避免 MaaFramework 的浅替换导致字段丢失
 */
const deepMergeObjects = (...sources: Record<string, unknown>[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        result[key] !== null &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMergeObjects(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = value;
      }
    }
  }
  return result;
};

/**
 * 生成 MXU 内置特殊任务的 pipeline override
 * 复用通用的 collectOptionOverrides 处理所有选项类型（input/select/switch 及嵌套选项）
 *
 * 重要：MaaFramework 对同一节点的同名字段（如 custom_action_param）执行完整替换而非深合并。
 * 因此此处先在前端将所有 override 深合并为一个对象，再作为单元素数组发送给 MaaFramework，
 * 确保多个选项贡献的 custom_action_param 字段不会互相覆盖。
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

  // 复用通用选项处理函数，支持所有选项类型及嵌套选项
  if (taskDef.option) {
    for (const optionKey of taskDef.option) {
      collectOptionOverrides(optionKey, selectedTask.optionValues, overrides, optionDefs);
    }
  }

  if (overrides.length === 0) return '[]';

  // 前端深合并所有 override 为单个对象，避免 MaaFramework 浅替换丢失字段
  const merged = deepMergeObjects(...overrides);
  return JSON.stringify([merged]);
};
