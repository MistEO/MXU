import { useState, useMemo, useEffect, useRef, useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/appStore';
import { loadIconAsDataUrl, useResolvedContent } from '@/services/contentResolver';
import type { OptionValue, CaseItem, InputItem, OptionDefinition } from '@/types/interface';
import { findMxuOptionByKey } from '@/types/specialTasks';
import clsx from 'clsx';
import { Info, AlertCircle, Loader2, FileText, Link, ChevronDown, Check } from 'lucide-react';
import { getInterfaceLangKey } from '@/i18n';
import { findSwitchCase } from '@/utils/optionHelpers';
import { SwitchButton, TextInput, FileInput, TimeInput } from './FormControls';
import { Tooltip } from './ui/Tooltip';

/** 判断 switch 类型的选项是否有子选项 */
export function switchHasNestedOptions(optionDef: OptionDefinition): boolean {
  if (optionDef.type !== 'switch') return false;
  // SwitchOption 的 cases 是 [CaseItem, CaseItem]，始终有两个元素
  return optionDef.cases.some((c: CaseItem) => c.option && c.option.length > 0);
}

/** 异步加载图标组件 */
function AsyncIcon({
  icon,
  basePath,
  className,
}: {
  icon?: string;
  basePath: string;
  className?: string;
}) {
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
  /** 是否因控制器不兼容而禁用 */
  controllerIncompatible?: boolean;
}

/** 显示带图标的标签（仅标签本身） */
function OptionLabel({
  label,
  icon,
  basePath,
}: {
  label: string;
  icon?: string;
  basePath: string;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      {icon && (
        <AsyncIcon
          icon={icon}
          basePath={basePath}
          className="w-4 h-4 object-contain flex-shrink-0"
        />
      )}
      <span className="text-sm text-text-secondary">{label}</span>
    </div>
  );
}

/** 显示带图标的标签 + 控制器不兼容警告提示 */
function OptionLabelWithIncompatible({
  label,
  icon,
  basePath,
  controllerIncompatible,
}: {
  label: string;
  icon?: string;
  basePath: string;
  controllerIncompatible?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <OptionLabel label={label} icon={icon} basePath={basePath} />
      {controllerIncompatible && (
        <Tooltip content={t('optionEditor.incompatibleController')}>
          <AlertCircle className="w-3.5 h-3.5 text-warning flex-shrink-0" />
        </Tooltip>
      )}
    </div>
  );
}

/** 显示选项描述文本（支持文件/URL/直接文本，以及 Markdown/HTML 和本地图片） */
function OptionDescription({
  description,
  basePath,
  translations,
}: {
  description?: string;
  basePath: string;
  translations?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const resolved = useResolvedContent(description, basePath, translations);

  if (!description && !resolved.loading) return null;

  if (resolved.loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{t('optionEditor.loadingDescription')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* 来源提示 */}
      {resolved.loaded && resolved.type !== 'text' && (
        <div className="flex items-center gap-1 text-[10px] text-text-muted">
          {resolved.type === 'file' ? (
            <FileText className="w-3 h-3" />
          ) : (
            <Link className="w-3 h-3" />
          )}
          <span>
            {t(
              resolved.type === 'file'
                ? 'optionEditor.loadedFromFile'
                : 'optionEditor.loadedFromUrl',
            )}
          </span>
        </div>
      )}
      {/* 加载错误提示 */}
      {resolved.error && resolved.type !== 'text' && (
        <div className="flex items-center gap-1 text-[10px] text-warning">
          <AlertCircle className="w-3 h-3" />
          <span>
            {t('optionEditor.loadDescriptionFailed')}: {resolved.error}
          </span>
        </div>
      )}
      {/* 内容 */}
      {resolved.html && (
        <div
          className="text-xs text-text-secondary [&_p]:my-0.5 [&_a]:text-accent [&_a]:hover:underline"
          dangerouslySetInnerHTML={{ __html: resolved.html }}
        />
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
  isMxuOption = false,
  t,
}: {
  input: InputItem;
  value: string;
  onChange: (val: string) => void;
  langKey: string;
  resolveI18nText: (text: string | undefined, lang: string) => string;
  basePath: string;
  disabled?: boolean;
  isMxuOption?: boolean;
  t?: (key: string) => string;
}) {
  // 对于 MXU 内置选项，使用 t() 翻译
  const inputLabel =
    isMxuOption && t
      ? t(input.label || input.name)
      : resolveI18nText(input.label, langKey) || input.name;
  const inputDescription =
    isMxuOption && t
      ? input.description
        ? t(input.description)
        : undefined
      : resolveI18nText(input.description, langKey);
  const patternMsg =
    isMxuOption && t
      ? input.pattern_msg
        ? t(input.pattern_msg)
        : undefined
      : resolveI18nText(input.pattern_msg, langKey);
  const inputPlaceholder =
    isMxuOption && t
      ? input.placeholder
        ? t(input.placeholder)
        : input.default || undefined
      : resolveI18nText(input.placeholder, langKey) || input.default || undefined;

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
          {input.icon && (
            <AsyncIcon
              icon={input.icon}
              basePath={basePath}
              className="w-4 h-4 object-contain flex-shrink-0"
            />
          )}
          <span className="text-sm text-text-tertiary">{inputLabel}</span>
          {inputDescription && (
            <Tooltip content={inputDescription} side="top" align="start" maxWidth="max-w-[200px]">
              <Info className="w-3.5 h-3.5 text-text-muted cursor-help flex-shrink-0" />
            </Tooltip>
          )}
        </div>
        {input.input_type === 'file' ? (
          <FileInput
            value={value}
            onChange={onChange}
            placeholder={inputPlaceholder}
            disabled={disabled}
            className="flex-1"
          />
        ) : input.input_type === 'time' ? (
          <TimeInput value={value} onChange={onChange} disabled={disabled} className="flex-1" />
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            placeholder={inputPlaceholder}
            disabled={disabled}
            hasError={!!validationError}
            className="flex-1"
            type={input.pipeline_type === 'int' ? 'number' : 'text'}
            inputMode={input.pipeline_type === 'int' ? 'numeric' : undefined}
            step={input.pipeline_type === 'int' ? 1 : undefined}
            integerOnly={input.pipeline_type === 'int'}
          />
        )}
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

export function OptionEditor({
  instanceId,
  taskId,
  optionKey,
  value,
  depth = 0,
  disabled = false,
  controllerIncompatible = false,
}: OptionEditorProps) {
  const { t } = useTranslation();
  const {
    projectInterface,
    setTaskOptionValue,
    resolveI18nText,
    language,
    basePath,
    interfaceTranslations,
    instances,
  } = useAppStore();

  // 支持 MXU 内置选项定义（检查 optionKey 是否以 __MXU_ 开头）
  const isMxuOption = optionKey.startsWith('__MXU_');
  // 通过 optionKey 从所有注册的特殊任务中反查选项定义
  const mxuOptionDef = isMxuOption ? findMxuOptionByKey(optionKey) : null;
  const optionDef = isMxuOption ? mxuOptionDef : projectInterface?.option?.[optionKey];
  if (!optionDef) return null;

  const langKey = getInterfaceLangKey(language);
  // 对于 MXU 内置选项，使用 t() 翻译
  const optionLabel = isMxuOption
    ? t(optionDef.label || optionKey)
    : resolveI18nText(optionDef.label, langKey) || optionKey;
  const optionDescription = isMxuOption
    ? optionDef.description
      ? t(optionDef.description)
      : undefined
    : resolveI18nText(optionDef.description, langKey);
  const translations = interfaceTranslations[langKey];

  // 获取当前任务的所有选项值（用于嵌套选项）
  const allOptionValues = useMemo(() => {
    const instance = instances.find((i) => i.id === instanceId);
    const task = instance?.selectedTasks.find((t) => t.id === taskId);
    return task?.optionValues || {};
  }, [instances, instanceId, taskId]);

  // 获取当前选中的 case（用于渲染嵌套选项）
  const getSelectedCase = (): CaseItem | undefined => {
    if (optionDef.type === 'switch') {
      const isChecked = value?.type === 'switch' ? value.value : false;
      return findSwitchCase(optionDef.cases, isChecked);
    }
    if (optionDef.type === 'select' || !optionDef.type) {
      const caseName =
        value?.type === 'select'
          ? value.caseName
          : optionDef.default_case || optionDef.cases?.[0]?.name;
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
        <div
          className={clsx(
            'flex items-center justify-between',
            controllerIncompatible && 'opacity-60',
          )}
        >
          <OptionLabelWithIncompatible
            label={optionLabel}
            icon={optionDef.icon}
            basePath={basePath}
            controllerIncompatible={controllerIncompatible}
          />
          <SwitchButton
            value={isChecked}
            onChange={(checked) => {
              setTaskOptionValue(instanceId, taskId, optionKey, {
                type: 'switch',
                value: checked,
              });
            }}
            disabled={disabled}
          />
        </div>
        <OptionDescription
          description={optionDescription}
          basePath={basePath}
          translations={translations}
        />
        {/* 渲染嵌套选项 */}
        {nestedOptionKeys.length > 0 && (
          <div className="space-y-2">
            {nestedOptionKeys.map((nestedKey) => (
              <OptionEditor
                key={nestedKey}
                instanceId={instanceId}
                taskId={taskId}
                optionKey={nestedKey}
                value={allOptionValues[nestedKey]}
                depth={depth + 1}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Checkbox 类型 (多选)
  if (optionDef.type === 'checkbox') {
    const selectedCases = value?.type === 'checkbox' ? value.caseNames : optionDef.default_case || [];

    return (
      <div
        className={clsx(
          'space-y-2',
          depth > 0 && 'ml-4 pl-3 border-l-2 border-border',
          controllerIncompatible && 'opacity-60',
        )}
      >
        <OptionLabelWithIncompatible
          label={optionLabel}
          icon={optionDef.icon}
          basePath={basePath}
          controllerIncompatible={controllerIncompatible}
        />
        <OptionDescription
          description={optionDescription}
          basePath={basePath}
          translations={translations}
        />
        <div className="grid grid-cols-4 gap-1">
          {optionDef.cases.map((caseItem) => {
            const caseLabel = isMxuOption
              ? t(caseItem.label || caseItem.name)
              : resolveI18nText(caseItem.label, langKey) || caseItem.name;
            const isChecked = selectedCases.includes(caseItem.name);
            return (
              <button
                key={caseItem.name}
                type="button"
                onClick={() => {
                  if (disabled) return;
                  const newCases = isChecked
                    ? selectedCases.filter((n) => n !== caseItem.name)
                    : [...selectedCases, caseItem.name];
                  setTaskOptionValue(instanceId, taskId, optionKey, {
                    type: 'checkbox',
                    caseNames: newCases,
                  });
                }}
                disabled={disabled}
                className={clsx(
                  'px-2 py-1.5 text-xs rounded border transition-colors truncate',
                  isChecked
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-primary text-text-secondary border-border hover:border-accent hover:text-accent',
                  disabled && 'opacity-60 cursor-not-allowed',
                )}
                title={caseLabel}
              >
                {caseLabel}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Input 类型
  if (optionDef.type === 'input') {
    const inputValues = value?.type === 'input' ? value.values : {};

    return (
      <div
        className={clsx(
          'space-y-2',
          depth > 0 && 'ml-4 pl-3 border-l-2 border-border',
          controllerIncompatible && 'opacity-60',
        )}
      >
        <OptionLabelWithIncompatible
          label={optionLabel}
          icon={optionDef.icon}
          basePath={basePath}
          controllerIncompatible={controllerIncompatible}
        />
        <OptionDescription
          description={optionDescription}
          basePath={basePath}
          translations={translations}
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
              isMxuOption={isMxuOption}
              t={t}
            />
          );
        })}
      </div>
    );
  }

  // Select 类型 (默认)
  const selectedCaseName =
    value?.type === 'select' ? value.caseName : optionDef.default_case || optionDef.cases[0]?.name;

  // 选项超过 4 个时使用 ComboBox（带搜索功能）
  const useComboBox = optionDef.cases.length > 4;
  const SelectComponent = useComboBox ? OptionSelectComboBox : OptionSelectDropdown;

  return (
    <div
      className={clsx(
        'space-y-2',
        depth > 0 && 'ml-4 pl-3 border-l-2 border-border',
        controllerIncompatible && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <OptionLabelWithIncompatible
          label={optionLabel}
          icon={optionDef.icon}
          basePath={basePath}
          controllerIncompatible={controllerIncompatible}
        />
        <SelectComponent
          className="flex-1"
          value={selectedCaseName}
          disabled={disabled}
          basePath={basePath}
          options={optionDef.cases.map((caseItem) => {
            // 对于 MXU 内置选项，使用 t() 翻译；否则使用 resolveI18nText
            const label = isMxuOption
              ? t(caseItem.label || caseItem.name)
              : resolveI18nText(caseItem.label, langKey) || caseItem.name;
            return {
              value: caseItem.name,
              label,
              icon: caseItem.icon,
            };
          })}
          onChange={(next) => {
            if (disabled) return;
            setTaskOptionValue(instanceId, taskId, optionKey, {
              type: 'select',
              caseName: next,
            });
          }}
        />
      </div>
      <OptionDescription
        description={optionDescription}
        basePath={basePath}
        translations={translations}
      />
      {/* 渲染嵌套选项 */}
      {nestedOptionKeys.length > 0 && (
        <div className="space-y-2">
          {nestedOptionKeys.map((nestedKey) => (
            <OptionEditor
              key={nestedKey}
              instanceId={instanceId}
              taskId={taskId}
              optionKey={nestedKey}
              value={allOptionValues[nestedKey]}
              depth={depth + 1}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface OptionSelectDropdownProps {
  value: string;
  options: { value: string; label: string; icon?: string }[];
  disabled?: boolean;
  className?: string;
  basePath: string;
  onChange: (value: string) => void;
}

function OptionSelectDropdown({
  value,
  options,
  disabled = false,
  className,
  basePath,
  onChange,
}: OptionSelectDropdownProps) {
  const triggerId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);

  const initialIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // 打开时初始化活动项并将焦点移动到列表
  useEffect(() => {
    if (open && !disabled) {
      const index = Math.max(
        0,
        options.findIndex((opt) => opt.value === value),
      );
      setActiveIndex(index);
      setTimeout(() => {
        listboxRef.current?.focus();
      }, 0);
    }
  }, [open, disabled, options, value]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setOpen((prev) => !prev);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(options.length - 1, prev + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTrigger();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const opt = options[activeIndex];
      if (opt) {
        onChange(opt.value);
        closeAndFocusTrigger();
      }
    }
  };

  const isDisabled = disabled || options.length === 0;

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        disabled={isDisabled}
        className={clsx(
          'w-full px-3 py-1.5 text-sm rounded-md border flex items-center justify-between gap-2',
          'bg-bg-secondary text-text-primary border-border',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20',
          isDisabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:bg-bg-hover transition-colors',
        )}
        onClick={() => {
          if (isDisabled) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={handleTriggerKeyDown}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selectedOption?.icon && (
            <AsyncIcon
              icon={selectedOption.icon}
              basePath={basePath}
              className="w-4 h-4 object-contain flex-shrink-0"
            />
          )}
          {selectedOption?.label}
        </span>
        <ChevronDown
          className={clsx('w-4 h-4 text-text-secondary transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && !isDisabled && (
        <div
          id={listboxId}
          ref={listboxRef}
          className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-bg-primary shadow-lg outline-none"
          role="listbox"
          aria-labelledby={triggerId}
          tabIndex={-1}
          onKeyDown={handleListboxKeyDown}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isActive = index === activeIndex;
            const optionId = `${listboxId}-option-${opt.value}`;
            return (
              <button
                key={optionId}
                id={optionId}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  closeAndFocusTrigger();
                }}
                className={clsx(
                  'w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2',
                  isActive
                    ? 'bg-bg-active text-text-primary'
                    : isSelected
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-primary hover:bg-bg-hover',
                )}
                role="option"
                aria-selected={isSelected}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {opt.icon && (
                    <AsyncIcon
                      icon={opt.icon}
                      basePath={basePath}
                      className="w-4 h-4 object-contain flex-shrink-0"
                    />
                  )}
                  {opt.label}
                </span>
                {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 带搜索功能的 ComboBox 组件（用于选项数量较多时） */
function OptionSelectComboBox({
  value,
  options,
  disabled = false,
  className,
  basePath,
  onChange,
}: OptionSelectDropdownProps) {
  const { t } = useTranslation();
  const triggerId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  // 过滤选项
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (opt) => opt.label.toLowerCase().includes(query) || opt.value.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  const [activeIndex, setActiveIndex] = useState(0);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearchQuery('');
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // 打开时聚焦输入框并重置搜索
  useEffect(() => {
    if (open && !disabled) {
      setSearchQuery('');
      setActiveIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open, disabled]);

  // 当过滤结果变化时，重置活动索引
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredOptions.length]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    setSearchQuery('');
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      setOpen((prev) => !prev);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setSearchQuery('');
      }
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(filteredOptions.length - 1, prev + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(filteredOptions.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTrigger();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const opt = filteredOptions[activeIndex];
      if (opt) {
        onChange(opt.value);
        closeAndFocusTrigger();
      }
    }
  };

  // 滚动活动项到视图中
  useEffect(() => {
    if (!open || !listboxRef.current) return;
    const activeElement = listboxRef.current.querySelector(`[data-index="${activeIndex}"]`);
    if (activeElement) {
      activeElement.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  const isDisabled = disabled || options.length === 0;

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        disabled={isDisabled}
        className={clsx(
          'w-full px-3 py-1.5 text-sm rounded-md border flex items-center justify-between gap-2',
          'bg-bg-secondary text-text-primary border-border',
          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20',
          isDisabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:bg-bg-hover transition-colors',
        )}
        onClick={() => {
          if (isDisabled) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={handleTriggerKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selectedOption?.icon && (
            <AsyncIcon
              icon={selectedOption.icon}
              basePath={basePath}
              className="w-4 h-4 object-contain flex-shrink-0"
            />
          )}
          {selectedOption?.label}
        </span>
        <ChevronDown
          className={clsx('w-4 h-4 text-text-secondary transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && !isDisabled && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-bg-primary shadow-lg overflow-hidden">
          {/* 搜索输入框 */}
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('optionEditor.searchPlaceholder')}
              className={clsx(
                'w-full px-2.5 py-1.5 text-sm rounded-md border',
                'bg-bg-secondary text-text-primary border-border',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20',
                'placeholder:text-text-muted',
              )}
            />
          </div>

          {/* 选项列表 */}
          <div
            id={listboxId}
            ref={listboxRef}
            className="max-h-52 overflow-y-auto outline-none"
            role="listbox"
            aria-labelledby={triggerId}
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted text-center">
                {t('optionEditor.noMatchingOptions')}
              </div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = opt.value === value;
                const isActive = index === activeIndex;
                const optionId = `${listboxId}-option-${opt.value}`;
                return (
                  <button
                    key={optionId}
                    id={optionId}
                    type="button"
                    data-index={index}
                    onClick={() => {
                      onChange(opt.value);
                      closeAndFocusTrigger();
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={clsx(
                      'w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2',
                      isActive
                        ? 'bg-bg-active text-text-primary'
                        : isSelected
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-primary hover:bg-bg-hover',
                    )}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {opt.icon && (
                        <AsyncIcon
                          icon={opt.icon}
                          basePath={basePath}
                          className="w-4 h-4 object-contain flex-shrink-0"
                        />
                      )}
                      {opt.label}
                    </span>
                    {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Switch 网格组件的单个项 */
interface SwitchGridItemData {
  optionKey: string;
  label: string;
  description?: string;
  isChecked: boolean;
  controllerIncompatible?: boolean;
}

interface SwitchGridProps {
  instanceId: string;
  taskId: string;
  items: SwitchGridItemData[];
  disabled?: boolean;
}

/** Switch 网格组件：用于显示多个无子选项的 switch */
export function SwitchGrid({ instanceId, taskId, items, disabled = false }: SwitchGridProps) {
  const { setTaskOptionValue } = useAppStore();
  const { t } = useTranslation();

  const handleToggle = (optionKey: string, currentValue: boolean, itemDisabled: boolean) => {
    if (disabled || itemDisabled) return;
    setTaskOptionValue(instanceId, taskId, optionKey, {
      type: 'switch',
      value: !currentValue,
    });
  };

  return (
    <div className="grid grid-cols-4 gap-1">
      {items.map((item) => {
        const itemDisabled = disabled || !!item.controllerIncompatible;
        const tooltipContent = item.controllerIncompatible
          ? item.description
            ? `${t('optionEditor.incompatibleController')} — ${item.description}`
            : t('optionEditor.incompatibleController')
          : item.description;
        return (
          <Tooltip key={item.optionKey} content={tooltipContent}>
            <button
              type="button"
              onClick={() => handleToggle(item.optionKey, item.isChecked, itemDisabled)}
              disabled={itemDisabled}
              className={clsx(
                'px-2 py-1.5 text-xs rounded border transition-colors truncate',
                item.isChecked
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-primary text-text-secondary border-border hover:border-accent hover:text-accent',
                itemDisabled && 'opacity-60 cursor-not-allowed',
              )}
              title={item.description || item.label}
            >
              {item.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
