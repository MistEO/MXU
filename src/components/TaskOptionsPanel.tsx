import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle, Loader2, FileText, Link } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore, type TaskRunStatus } from '@/stores/appStore';
import { useResolvedContent } from '@/services/contentResolver';
import { OptionEditor, SwitchGrid, switchHasNestedOptions } from './OptionEditor';
import type { SelectedTask } from '@/types/interface';
import { isMxuSpecialTask, getMxuSpecialTask, findMxuOptionByKey } from '@/types/specialTasks';
import { getInterfaceLangKey } from '@/i18n';
import { Tooltip } from './ui/Tooltip';

/** 描述内容组件：显示从文件/URL/直接文本解析的内容 */
function DescriptionContent({
  html,
  loading,
  type,
  loaded,
  error,
}: {
  html: string;
  loading: boolean;
  type: 'url' | 'file' | 'text';
  loaded: boolean;
  error?: string;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{t('taskItem.loadingDescription')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {loaded && type !== 'text' && (
        <div className="flex items-center gap-1 text-[10px] text-text-muted">
          {type === 'file' ? <FileText className="w-3 h-3" /> : <Link className="w-3 h-3" />}
          <span>{t(type === 'file' ? 'taskItem.loadedFromFile' : 'taskItem.loadedFromUrl')}</span>
        </div>
      )}
      {error && type !== 'text' && (
        <div className="flex items-center gap-1 text-[10px] text-warning">
          <AlertCircle className="w-3 h-3" />
          <span>
            {t('taskItem.loadDescriptionFailed')}: {error}
          </span>
        </div>
      )}
      {html && (
        <div
          className="text-xs text-text-secondary [&_p]:my-0.5 [&_a]:text-accent [&_a]:hover:underline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

/** 选项分组项类型 */
type OptionGroup =
  | { type: 'single'; optionKey: string }
  | { type: 'switchGrid'; optionKeys: string[] };

function isOptionControllerIncompatible(
  optionDef: import('@/types/interface').OptionDefinition | null | undefined,
  currentControllerName: string | undefined,
): boolean {
  if (!optionDef?.controller || optionDef.controller.length === 0) return false;
  if (!currentControllerName) return false;
  return !optionDef.controller.includes(currentControllerName);
}

function isOptionResourceIncompatible(
  optionDef: import('@/types/interface').OptionDefinition | null | undefined,
  currentResourceName: string | undefined,
): boolean {
  if (!optionDef?.resource || optionDef.resource.length === 0) return false;
  if (!currentResourceName) return false;
  return !optionDef.resource.includes(currentResourceName);
}

function OptionListRenderer({
  instanceId,
  taskId,
  optionKeys,
  optionValues,
  disabled,
  currentControllerName,
  currentResourceName,
}: {
  instanceId: string;
  taskId: string;
  optionKeys: string[];
  optionValues: Record<string, import('@/types/interface').OptionValue>;
  disabled: boolean;
  currentControllerName: string | undefined;
  currentResourceName: string | undefined;
}) {
  const { projectInterface, resolveI18nText, language } = useAppStore();
  const { t } = useTranslation();
  const langKey = getInterfaceLangKey(language);

  const getOptionDef = (optionKey: string) => {
    const isMxuOption = optionKey.startsWith('__MXU_');
    return isMxuOption ? findMxuOptionByKey(optionKey) : projectInterface?.option?.[optionKey];
  };

  const groups = useMemo(() => {
    const result: OptionGroup[] = [];
    let currentSwitchGroup: string[] = [];

    const flushSwitchGroup = () => {
      if (currentSwitchGroup.length > 4) {
        result.push({ type: 'switchGrid', optionKeys: [...currentSwitchGroup] });
      } else {
        for (const key of currentSwitchGroup) {
          result.push({ type: 'single', optionKey: key });
        }
      }
      currentSwitchGroup = [];
    };

    for (const optionKey of optionKeys) {
      const optionDef = getOptionDef(optionKey);
      const isSimpleSwitch = optionDef?.type === 'switch' && !switchHasNestedOptions(optionDef);

      if (isSimpleSwitch) {
        currentSwitchGroup.push(optionKey);
      } else {
        flushSwitchGroup();
        result.push({ type: 'single', optionKey });
      }
    }
    flushSwitchGroup();
    return result;
  }, [optionKeys, projectInterface?.option]);

  const buildSwitchGridItems = (keys: string[]) => {
    return keys.map((optionKey) => {
      const optionDef = getOptionDef(optionKey);
      const value = optionValues[optionKey];
      const isChecked = value?.type === 'switch' ? value.value : false;
      const isMxuOption = optionKey.startsWith('__MXU_');

      const label = isMxuOption
        ? t(optionDef?.label || optionKey)
        : resolveI18nText(optionDef?.label, langKey) || optionKey;
      const description = isMxuOption
        ? optionDef?.description
          ? t(optionDef.description)
          : undefined
        : resolveI18nText(optionDef?.description, langKey);

      const controllerIncompatible = isOptionControllerIncompatible(optionDef, currentControllerName);
      const resourceIncompatible = isOptionResourceIncompatible(optionDef, currentResourceName);

      return {
        optionKey,
        label,
        description,
        isChecked,
        controllerIncompatible: controllerIncompatible || resourceIncompatible,
      };
    });
  };

  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        if (group.type === 'switchGrid') {
          return (
            <SwitchGrid
              key={`grid-${index}`}
              instanceId={instanceId}
              taskId={taskId}
              items={buildSwitchGridItems(group.optionKeys)}
              disabled={disabled}
            />
          );
        }
        const optionDef = getOptionDef(group.optionKey);
        const optionControllerIncompatible = isOptionControllerIncompatible(
          optionDef,
          currentControllerName,
        );
        const optionResourceIncompatible = isOptionResourceIncompatible(optionDef, currentResourceName);
        const optionIncompatible = optionControllerIncompatible || optionResourceIncompatible;
        const parentIncompatibilityReason = optionControllerIncompatible
          ? 'controller'
          : optionResourceIncompatible
            ? 'resource'
            : undefined;
        return (
          <OptionEditor
            key={group.optionKey}
            instanceId={instanceId}
            taskId={taskId}
            optionKey={group.optionKey}
            value={optionValues[group.optionKey]}
            disabled={disabled || optionIncompatible}
            controllerIncompatible={optionIncompatible}
            parentIncompatibilityReason={parentIncompatibilityReason}
          />
        );
      })}
    </div>
  );
}

export function TaskOptionsPanel({
  instanceId,
  task,
  onClose,
}: {
  instanceId: string;
  task: SelectedTask;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const {
    projectInterface,
    resolveI18nText,
    language,
    instances,
    basePath,
    interfaceTranslations,
    instanceTaskRunStatus,
  } = useAppStore();

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  const instance = instances.find((i) => i.id === instanceId);
  const isInstanceRunning = instance?.isRunning || false;
  const taskRunStatus: TaskRunStatus = instanceTaskRunStatus[instanceId]?.[task.id] || 'idle';

  const isMxuTask = isMxuSpecialTask(task.taskName);
  const mxuSpecialTask = isMxuTask ? getMxuSpecialTask(task.taskName) : null;
  const taskDef = isMxuTask
    ? mxuSpecialTask?.taskDef
    : projectInterface?.task.find((td) => td.name === task.taskName);
  if (!taskDef) return null;

  const currentControllerName = instance?.controllerName || projectInterface?.controller[0]?.name;
  const currentResourceName = instance?.resourceName || projectInterface?.resource[0]?.name;

  const canEditOptions =
    !isInstanceRunning || taskRunStatus === 'idle' || taskRunStatus === 'pending';

  const originalLabel = isMxuTask
    ? t(taskDef.label || taskDef.name)
    : resolveI18nText(taskDef.label, langKey) || taskDef.name;
  const displayName = task.customName || originalLabel;

  const resolvedDescription = useResolvedContent(
    taskDef?.description ? resolveI18nText(taskDef.description, langKey) : undefined,
    basePath,
    translations,
  );
  const hasDescription = !!resolvedDescription.html || resolvedDescription.loading;

  const hasOptions = taskDef.option && taskDef.option.length > 0;

  // 不兼容判断（沿用 TaskItem 的语义：与当前 controller/resource 不匹配时提示）
  const isControllerIncompatible = useMemo(() => {
    if (!taskDef?.controller || taskDef.controller.length === 0) return false;
    if (!currentControllerName) return false;
    return !taskDef.controller.includes(currentControllerName);
  }, [taskDef?.controller, currentControllerName]);

  const isResourceIncompatible = useMemo(() => {
    if (!taskDef?.resource || taskDef.resource.length === 0) return false;
    if (!currentResourceName) return false;
    return !taskDef.resource.includes(currentResourceName);
  }, [taskDef?.resource, currentResourceName]);

  const isIncompatible = isControllerIncompatible || isResourceIncompatible;

  const incompatibleReason = useMemo(() => {
    if (!isIncompatible) return '';
    const reasons: string[] = [];
    if (isControllerIncompatible) reasons.push(t('taskItem.incompatibleController'));
    if (isResourceIncompatible) reasons.push(t('taskItem.incompatibleResource'));
    return reasons.join(', ');
  }, [isIncompatible, isControllerIncompatible, isResourceIncompatible, t]);

  const supportedControllerHint = useMemo(() => {
    if (!isControllerIncompatible || !taskDef?.controller || taskDef.controller.length === 0) return '';
    const labels = taskDef.controller.map((name) => {
      const ctrl = projectInterface?.controller.find((c) => c.name === name);
      return ctrl ? resolveI18nText(ctrl.label, langKey) || ctrl.name : name;
    });
    return t('taskItem.supportedControllers', { controllers: labels.join(', ') });
  }, [isControllerIncompatible, taskDef?.controller, projectInterface?.controller, resolveI18nText, langKey, t]);

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary/60">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary truncate">{displayName}</div>
          {task.customName && (
            <div className="text-xs text-text-muted truncate">{originalLabel}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t('common.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-4">
          {hasDescription && (
            <div className="rounded-lg border border-border bg-bg-tertiary p-3">
              <DescriptionContent
                html={resolvedDescription.html}
                loading={resolvedDescription.loading}
                type={resolvedDescription.type}
                loaded={resolvedDescription.loaded}
                error={resolvedDescription.error}
              />
            </div>
          )}

          {isIncompatible && (
            <Tooltip content={supportedControllerHint || undefined}>
              <div
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-2 rounded-lg border',
                  'bg-warning/10 text-warning text-xs border-warning/20',
                )}
              >
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="min-w-0 truncate">{incompatibleReason}</span>
              </div>
            </Tooltip>
          )}

          {hasOptions && (
            <div className="rounded-lg border border-border bg-bg-tertiary p-3">
              <OptionListRenderer
                instanceId={instanceId}
                taskId={task.id}
                optionKeys={taskDef.option || []}
                optionValues={task.optionValues}
                disabled={!canEditOptions || isIncompatible}
                currentControllerName={currentControllerName}
                currentResourceName={currentResourceName}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

