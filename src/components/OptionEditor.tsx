import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { loadIconAsDataUrl } from '@/services/contentResolver';
import type { OptionValue, CaseItem, InputItem } from '@/types/interface';
import clsx from 'clsx';
import { Info, AlertCircle } from 'lucide-react';

/** 异步加载图标组件 */
function AsyncIcon({ icon, basePath, className }: { icon?: string; basePath: string; className?: string }) {
  const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!icon) {
      setIconUrl(undefined);
      return;
    }
    loadIconAsDataUrl(icon, basePath).then(setIconUrl);
  }, [icon, basePath]);

  if (!iconUrl) return null;
  return <img src={iconUrl} alt="" className={className} />;
}

interface OptionEditorProps {
  instanceId: string;
  taskId: string;
  optionKey: string;
  value?: OptionValue;
  /** 嵌套层级，用于缩进显示 */
  depth?: number;
  /** 是否禁用编辑（只读模式） */
  disabled?: boolean;
}

/** 显示带图标和描述的标签 */
function OptionLabel({
  label,
  icon,
  description,
  basePath,
}: {
  label: string;
  icon?: string;
  description?: string;
  basePath: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <AsyncIcon icon={icon} basePath={basePath} className="w-4 h-4 object-contain flex-shrink-0" />
      <span className="text-sm text-text-secondary">{label}</span>
      {description && (
        <div className="relative">
          <Info
            className="w-3.5 h-3.5 text-text-muted cursor-help flex-shrink-0"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          />
          {showTooltip && (
            <div className="absolute left-0 bottom-full mb-1 z-50 px-2 py-1 text-xs bg-bg-primary border border-border rounded shadow-lg w-max max-w-[200px] whitespace-pre-wrap">
              {description}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 输入字段组件，支持验证 */
function InputField({
  input,
  value,
  onChange,
  langKey,
  resolveI18nText,
  basePath,
  disabled,
}: {
  input: InputItem;
  value: string;
  onChange: (val: string) => void;
  langKey: string;
  resolveI18nText: (text: string | undefined, lang: string) => string;
  basePath: string;
  disabled?: boolean;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const inputLabel = resolveI18nText(input.label, langKey) || input.name;
  const inputDescription = resolveI18nText(input.description, langKey);
  const patternMsg = resolveI18nText(input.pattern_msg, langKey);

  // 验证输入
  const validationError = useMemo(() => {
    if (!input.verify || !value) return null;
    try {
      const regex = new RegExp(input.verify);
      if (!regex.test(value)) {
        return patternMsg || `输入不符合格式要求`;
      }
    } catch {
      // 正则无效，跳过验证
    }
    return null;
  }, [input.verify, value, patternMsg]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 min-w-[80px]">
          <AsyncIcon icon={input.icon} basePath={basePath} className="w-4 h-4 object-contain flex-shrink-0" />
          <span className="text-sm text-text-tertiary">{inputLabel}</span>
          {inputDescription && (
            <div className="relative">
              <Info
                className="w-3.5 h-3.5 text-text-muted cursor-help flex-shrink-0"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              />
              {showTooltip && (
                <div className="absolute left-0 bottom-full mb-1 z-50 px-2 py-1 text-xs bg-bg-primary border border-border rounded shadow-lg w-max max-w-[200px] whitespace-pre-wrap">
                  {inputDescription}
                </div>
              )}
            </div>
          )}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.default}
          disabled={disabled}
          className={clsx(
            'flex-1 px-3 py-1.5 text-sm rounded-md border',
            'bg-bg-secondary text-text-primary',
            'focus:outline-none focus:ring-1',
            disabled && 'opacity-60 cursor-not-allowed',
            validationError
              ? 'border-error focus:border-error focus:ring-error/20'
              : 'border-border focus:border-accent focus:ring-accent/20'
          )}
        />
      </div>
      {validationError && (
        <div className="flex items-center gap-1 text-xs text-error ml-[92px]">
          <AlertCircle className="w-3 h-3" />
          <span>{validationError}</span>
        </div>
      )}
    </div>
  );
}

export function OptionEditor({ instanceId, taskId, optionKey, value, depth = 0, disabled = false }: OptionEditorProps) {
  const { projectInterface, setTaskOptionValue, resolveI18nText, language, basePath } = useAppStore();

  const optionDef = projectInterface?.option?.[optionKey];
  if (!optionDef) return null;

  const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
  const optionLabel = resolveI18nText(optionDef.label, langKey) || optionKey;
  const optionDescription = resolveI18nText(optionDef.description, langKey);

  // 获取当前选中的 case（用于渲染嵌套选项）
  const getSelectedCase = (): CaseItem | undefined => {
    if (optionDef.type === 'switch') {
      const isChecked = value?.type === 'switch' ? value.value : false;
      // switch 类型需要匹配 Yes/yes/Y/y 或 No/no/N/n
      return optionDef.cases?.find((c) => {
        if (isChecked) {
          return ['Yes', 'yes', 'Y', 'y'].includes(c.name);
        }
        return ['No', 'no', 'N', 'n'].includes(c.name);
      });
    }
    if (optionDef.type === 'select' || !optionDef.type) {
      const caseName = value?.type === 'select' ? value.caseName : optionDef.default_case || optionDef.cases?.[0]?.name;
      return optionDef.cases?.find((c) => c.name === caseName);
    }
    return undefined;
  };

  const selectedCase = getSelectedCase();
  const nestedOptionKeys = selectedCase?.option || [];

  // Switch 类型
  if (optionDef.type === 'switch') {
    const isChecked = value?.type === 'switch' ? value.value : false;

    return (
      <div className={clsx('space-y-2', depth > 0 && 'ml-4 pl-3 border-l-2 border-border')}>
        <div className="flex items-center justify-between">
          <OptionLabel
            label={optionLabel}
            icon={optionDef.icon}
            description={optionDescription}
            basePath={basePath}
          />
          <button
            onClick={() => {
              if (disabled) return;
              setTaskOptionValue(instanceId, taskId, optionKey, {
                type: 'switch',
                value: !isChecked,
              });
            }}
            disabled={disabled}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
              isChecked ? 'bg-accent' : 'bg-bg-active',
              disabled && 'opacity-60 cursor-not-allowed'
            )}
          >
            <span
              className={clsx(
                'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                isChecked ? 'translate-x-5' : 'translate-x-0'
              )}
            />
          </button>
        </div>
        {/* 渲染嵌套选项 */}
        {nestedOptionKeys.length > 0 && (
          <div className="space-y-2">
            {nestedOptionKeys.map((nestedKey) => (
              <OptionEditor
                key={nestedKey}
                instanceId={instanceId}
                taskId={taskId}
                optionKey={nestedKey}
                value={useAppStore.getState().instances
                  .find(i => i.id === instanceId)
                  ?.selectedTasks.find(t => t.id === taskId)
                  ?.optionValues[nestedKey]}
                depth={depth + 1}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Input 类型
  if (optionDef.type === 'input') {
    const inputValues = value?.type === 'input' ? value.values : {};

    return (
      <div className={clsx('space-y-2', depth > 0 && 'ml-4 pl-3 border-l-2 border-border')}>
        <OptionLabel
          label={optionLabel}
          icon={optionDef.icon}
          description={optionDescription}
          basePath={basePath}
        />
        {optionDef.inputs.map((input) => {
          const inputValue = inputValues[input.name] ?? input.default ?? '';

          return (
            <InputField
              key={input.name}
              input={input}
              value={inputValue}
              onChange={(newVal) => {
                if (disabled) return;
                setTaskOptionValue(instanceId, taskId, optionKey, {
                  type: 'input',
                  values: { ...inputValues, [input.name]: newVal },
                });
              }}
              langKey={langKey}
              resolveI18nText={resolveI18nText}
              basePath={basePath}
              disabled={disabled}
            />
          );
        })}
      </div>
    );
  }

  // Select 类型 (默认)
  const selectedCaseName = value?.type === 'select' ? value.caseName : optionDef.default_case || optionDef.cases[0]?.name;

  return (
    <div className={clsx('space-y-2', depth > 0 && 'ml-4 pl-3 border-l-2 border-border')}>
      <div className="flex items-center gap-3">
        <OptionLabel
          label={optionLabel}
          icon={optionDef.icon}
          description={optionDescription}
          basePath={basePath}
        />
        <select
          value={selectedCaseName}
          onChange={(e) => {
            if (disabled) return;
            setTaskOptionValue(instanceId, taskId, optionKey, {
              type: 'select',
              caseName: e.target.value,
            });
          }}
          disabled={disabled}
          className={clsx(
            'flex-1 px-3 py-1.5 text-sm rounded-md border border-border',
            'bg-bg-secondary text-text-primary',
            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          )}
        >
          {optionDef.cases.map((caseItem) => {
            const caseLabel = resolveI18nText(caseItem.label, langKey) || caseItem.name;
            return (
              <option key={caseItem.name} value={caseItem.name}>
                {caseLabel}
              </option>
            );
          })}
        </select>
      </div>
      {/* 渲染嵌套选项 */}
      {nestedOptionKeys.length > 0 && (
        <div className="space-y-2">
          {nestedOptionKeys.map((nestedKey) => (
            <OptionEditor
              key={nestedKey}
              instanceId={instanceId}
              taskId={taskId}
              optionKey={nestedKey}
              value={useAppStore.getState().instances
                .find(i => i.id === instanceId)
                ?.selectedTasks.find(t => t.id === taskId)
                ?.optionValues[nestedKey]}
              depth={depth + 1}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
