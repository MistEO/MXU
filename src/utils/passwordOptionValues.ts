import type {
  InputItem,
  OptionDefinition,
  OptionValue,
  SelectedTask,
  TaskItem,
} from '@/types/interface';
import { buildInputSecretKey, decryptSecret, encryptSecret } from '@/utils/secretCrypto';

const REDACTED = '***';

export function isPasswordInput(input: InputItem): boolean {
  return input.password === true;
}

function getInputOptionDef(
  optionKey: string,
  allOptions: Record<string, OptionDefinition>,
): Extract<OptionDefinition, { type: 'input' }> | null {
  const def = allOptions[optionKey];
  return def?.type === 'input' ? def : null;
}

/** 加载配置后：将 encryptedValues 解密到 values（运行时明文）。 */
export function decryptPasswordOptionValues(
  optionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
  projectName?: string,
): Record<string, OptionValue> {
  const result: Record<string, OptionValue> = {};
  for (const [optionKey, value] of Object.entries(optionValues)) {
    if (value.type !== 'input') {
      result[optionKey] = value;
      continue;
    }
    const optionDef = getInputOptionDef(optionKey, allOptions);
    if (!optionDef) {
      result[optionKey] = value;
      continue;
    }
    const values = { ...value.values };
    const encryptedValues = value.encryptedValues ? { ...value.encryptedValues } : undefined;
    for (const input of optionDef.inputs) {
      if (!isPasswordInput(input)) continue;
      const enc = encryptedValues?.[input.name];
      if (enc) {
        values[input.name] = decryptSecret(
          enc,
          buildInputSecretKey(projectName, optionKey, input.name),
        );
      }
      // 兼容旧配置：values 中仍有明文时保留，下次保存会迁移为 encryptedValues
    }
    result[optionKey] = {
      type: 'input',
      values,
      ...(encryptedValues ? { encryptedValues } : {}),
    };
  }
  return result;
}

/** 持久化前：password 字段加密写入 encryptedValues，values 中对应键置空。 */
export function encryptPasswordOptionValues(
  optionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
  projectName?: string,
): Record<string, OptionValue> {
  const result: Record<string, OptionValue> = {};
  for (const [optionKey, value] of Object.entries(optionValues)) {
    if (value.type !== 'input') {
      result[optionKey] = value;
      continue;
    }
    const optionDef = getInputOptionDef(optionKey, allOptions);
    if (!optionDef) {
      result[optionKey] = value;
      continue;
    }
    const values = { ...value.values };
    const encryptedValues: Record<string, string> = { ...(value.encryptedValues ?? {}) };
    for (const input of optionDef.inputs) {
      if (!isPasswordInput(input)) continue;
      const plain = values[input.name] ?? '';
      if (plain) {
        encryptedValues[input.name] = encryptSecret(
          plain,
          buildInputSecretKey(projectName, optionKey, input.name),
        );
      } else {
        delete encryptedValues[input.name];
      }
      values[input.name] = '';
    }
    const hasEncrypted = Object.keys(encryptedValues).length > 0;
    result[optionKey] = {
      type: 'input',
      values,
      ...(hasEncrypted ? { encryptedValues } : {}),
    };
  }
  return result;
}

/** 收集 optionValues 中所有 password 字段的明文，供日志脱敏。 */
export function collectPasswordPlaintexts(
  optionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
): string[] {
  const secrets: string[] = [];
  for (const [optionKey, value] of Object.entries(optionValues)) {
    if (value.type !== 'input') continue;
    const optionDef = getInputOptionDef(optionKey, allOptions);
    if (!optionDef) continue;
    for (const input of optionDef.inputs) {
      if (!isPasswordInput(input)) continue;
      const plain = value.values[input.name];
      if (plain) secrets.push(plain);
    }
  }
  return secrets;
}

export function redactSecretsInText(text: string, secrets: string[]): string {
  if (!text || secrets.length === 0) return text;
  let result = text;
  const sorted = [...secrets].sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    if (secret.length > 0) {
      result = result.split(secret).join(REDACTED);
    }
  }
  return result;
}

export function redactPipelineOverrideForLog(
  pipelineOverride: string,
  optionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
): string {
  const secrets = collectPasswordPlaintexts(optionValues, allOptions);
  return redactSecretsInText(pipelineOverride, secrets);
}

/** 从任务定义收集该任务相关的 password 明文（含 globalOptionValues）。 */
export function collectTaskPasswordPlaintexts(
  taskDef: TaskItem | undefined,
  taskOptionValues: Record<string, OptionValue>,
  globalOptionValues: Record<string, OptionValue>,
  allOptions: Record<string, OptionDefinition>,
): string[] {
  const keys = new Set<string>([
    ...(taskDef?.option ?? []),
    ...Object.keys(allOptions).filter((k) => allOptions[k]?.type === 'input'),
  ]);
  const merged: Record<string, OptionValue> = {};
  for (const key of keys) {
    const v = taskOptionValues[key] ?? globalOptionValues[key];
    if (v) merged[key] = v;
  }
  return collectPasswordPlaintexts(merged, allOptions);
}

/** 批量启动任务前收集所有 password 明文，供日志脱敏。 */
export function collectPasswordPlaintextsFromRunnableTasks(
  batchTasks: Array<{
    selectedTask: SelectedTask;
    taskDef: TaskItem;
    specialTask?: { optionDefs?: Record<string, OptionDefinition> };
  }>,
  globalOptionValues: Record<string, OptionValue>,
  defaultAllOptions: Record<string, OptionDefinition>,
): string[] {
  const secrets = new Set<string>();
  for (const { selectedTask, taskDef, specialTask } of batchTasks) {
    const allOptions = specialTask?.optionDefs ?? defaultAllOptions;
    for (const plain of collectTaskPasswordPlaintexts(
      taskDef,
      selectedTask.optionValues,
      globalOptionValues,
      allOptions,
    )) {
      if (plain) secrets.add(plain);
    }
  }
  return [...secrets];
}
