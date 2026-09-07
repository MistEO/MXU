import { createDefaultOptionValue, sanitizeOptionValue } from '@/stores/helpers';
import type {
  CheckboxOption,
  OptionDefinition,
  OptionValue,
  ProjectInterface,
  SelectedTask,
} from '@/types/interface';
import { getPretaskItem, isPretaskName } from '@/types/pretasks';
import { getMxuSpecialTask, isMxuSpecialTask } from '@/types/specialTasks';
import type { TFunction } from 'i18next';
import { findSwitchCase } from './optionHelpers';

export interface CheckboxCountViolation {
  optionKey: string;
  selectedCount: number;
  minCount: number;
  maxCount?: number;
  kind: 'min' | 'max';
  taskId?: string;
  taskName?: string;
}

export function getCheckboxMinCount(optionDef: CheckboxOption): number {
  return optionDef.min_count ?? 0;
}

export function getCheckboxMaxCount(optionDef: CheckboxOption): number | undefined {
  return optionDef.max_count;
}

function resolveInterfaceLabel(
  label: string | undefined,
  fallback: string,
  translations?: Record<string, string>,
): string {
  if (!label) return fallback;
  if (!label.startsWith('$')) return label;
  return translations?.[label.slice(1)] ?? label.slice(1);
}

export function formatCheckboxCountViolation(
  violation: CheckboxCountViolation,
  tasks: SelectedTask[],
  projectInterface: ProjectInterface | null,
  translations: Record<string, string> | undefined,
  t: TFunction,
): string {
  const selectedTask = violation.taskId
    ? tasks.find((task) => task.id === violation.taskId)
    : undefined;
  const specialTask = selectedTask ? getMxuSpecialTask(selectedTask.taskName) : undefined;
  const pretask =
    selectedTask && isPretaskName(selectedTask.taskName)
      ? getPretaskItem(projectInterface, selectedTask.taskName)
      : undefined;
  const taskDef = selectedTask
    ? specialTask?.taskDef ||
      (pretask
        ? {
            label: pretask.label || pretask.name || pretask.exec,
            name: pretask.name || pretask.exec,
          }
        : projectInterface?.task.find((item) => item.name === selectedTask.taskName))
    : undefined;
  const taskLabel =
    selectedTask?.customName ||
    (specialTask
      ? t(taskDef?.label || taskDef?.name || selectedTask?.taskName || violation.taskName || '')
      : resolveInterfaceLabel(
          taskDef?.label,
          taskDef?.name || selectedTask?.taskName || '',
          translations,
        ));
  const optionDef =
    specialTask?.optionDefs[violation.optionKey] || projectInterface?.option?.[violation.optionKey];
  const optionLabel = specialTask
    ? t(optionDef?.label || violation.optionKey)
    : resolveInterfaceLabel(optionDef?.label, violation.optionKey, translations);
  const scope = selectedTask
    ? t('taskList.checkboxTaskScope', { task: taskLabel })
    : t('taskList.checkboxGlobalScope');

  return violation.kind === 'min'
    ? t('taskList.checkboxMinimumNotMet', {
        scope,
        option: optionLabel,
        min: violation.minCount,
        count: violation.selectedCount,
      })
    : t('taskList.checkboxMaximumExceeded', {
        scope,
        option: optionLabel,
        max: violation.maxCount,
        count: violation.selectedCount,
      });
}

function isOptionIncompatible(
  optionDef: OptionDefinition,
  controllerName?: string,
  resourceName?: string,
): boolean {
  if (
    optionDef.controller &&
    optionDef.controller.length > 0 &&
    (!controllerName || !optionDef.controller.includes(controllerName))
  ) {
    return true;
  }
  return Boolean(
    optionDef.resource &&
    optionDef.resource.length > 0 &&
    (!resourceName || !optionDef.resource.includes(resourceName)),
  );
}

function validateOptionKeys(
  optionKeys: string[],
  optionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
  controllerName: string | undefined,
  resourceName: string | undefined,
  context: Pick<CheckboxCountViolation, 'taskId' | 'taskName'>,
): CheckboxCountViolation[] {
  const violations: CheckboxCountViolation[] = [];
  const visited = new Set<string>();

  const visit = (optionKey: string) => {
    if (visited.has(optionKey)) return;
    visited.add(optionKey);

    const optionDef = allOptions[optionKey];
    if (!optionDef || isOptionIncompatible(optionDef, controllerName, resourceName)) return;

    const savedValue = optionValues[optionKey];
    const optionValue =
      (savedValue && sanitizeOptionValue(optionKey, savedValue, allOptions)) ||
      createDefaultOptionValue(optionDef);

    if (optionDef.type === 'checkbox' && optionValue.type === 'checkbox') {
      const selectedCount = new Set(optionValue.caseNames).size;
      const minCount = getCheckboxMinCount(optionDef);
      const maxCount = getCheckboxMaxCount(optionDef);

      if (selectedCount < minCount) {
        violations.push({
          optionKey,
          selectedCount,
          minCount,
          maxCount,
          kind: 'min',
          ...context,
        });
      } else if (maxCount !== undefined && selectedCount > maxCount) {
        violations.push({
          optionKey,
          selectedCount,
          minCount,
          maxCount,
          kind: 'max',
          ...context,
        });
      }

      return;
    }

    if (optionDef.type === 'switch' && optionValue.type === 'switch') {
      findSwitchCase(optionDef.cases, optionValue.value)?.option?.forEach(visit);
      return;
    }

    if ((!optionDef.type || optionDef.type === 'select') && optionValue.type === 'select') {
      optionDef.cases
        .find((caseDef) => caseDef.name === optionValue.caseName)
        ?.option?.forEach(visit);
    }
  };

  optionKeys.forEach(visit);
  return violations;
}

/**
 * 校验一次启动中实际会使用到的 checkbox 选项。
 * 调用方应先过滤掉与当前控制器/资源不兼容的任务。
 */
export function validateInstanceCheckboxCounts(
  tasks: SelectedTask[],
  projectInterface: ProjectInterface | null,
  controllerName?: string,
  resourceName?: string,
  globalOptionValues: Record<string, OptionValue> = {},
): CheckboxCountViolation[] {
  if (!projectInterface) return [];

  const violations: CheckboxCountViolation[] = [];
  const ordinaryTasks = tasks.filter(
    (task) => !isMxuSpecialTask(task.taskName) && !isPretaskName(task.taskName),
  );

  if (
    ordinaryTasks.length > 0 &&
    projectInterface.option &&
    projectInterface.global_option?.length
  ) {
    violations.push(
      ...validateOptionKeys(
        projectInterface.global_option,
        globalOptionValues,
        projectInterface.option,
        controllerName,
        resourceName,
        {},
      ),
    );
  }

  for (const task of tasks) {
    const specialTask = getMxuSpecialTask(task.taskName);
    if (specialTask) {
      violations.push(
        ...validateOptionKeys(
          specialTask.taskDef.option ?? [],
          task.optionValues,
          specialTask.optionDefs,
          controllerName,
          resourceName,
          { taskId: task.id, taskName: task.taskName },
        ),
      );
      continue;
    }

    if (isPretaskName(task.taskName)) {
      const pretask = getPretaskItem(projectInterface, task.taskName);
      if (pretask?.option && projectInterface.option) {
        violations.push(
          ...validateOptionKeys(
            pretask.option,
            task.optionValues,
            projectInterface.option,
            controllerName,
            resourceName,
            { taskId: task.id, taskName: task.taskName },
          ),
        );
      }
      continue;
    }

    const taskDef = projectInterface.task.find((item) => item.name === task.taskName);
    if (!taskDef || !projectInterface.option) continue;

    const resourceOptionKeys =
      projectInterface.resource.find((item) => item.name === resourceName)?.option ?? [];
    const controllerOptionKeys =
      projectInterface.controller.find((item) => item.name === controllerName)?.option ?? [];
    const optionKeys = [
      ...new Set([...resourceOptionKeys, ...controllerOptionKeys, ...(taskDef.option ?? [])]),
    ];

    violations.push(
      ...validateOptionKeys(
        optionKeys,
        task.optionValues,
        projectInterface.option,
        controllerName,
        resourceName,
        { taskId: task.id, taskName: task.taskName },
      ),
    );
  }

  return violations;
}
