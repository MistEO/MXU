import { resolveI18nText } from '@/services/contentResolver';
import { getInterfaceLangKey } from '@/i18n';
import type { ProjectInterface } from '@/types/interface';

export interface PiEnvContext {
  projectInterface: ProjectInterface | null;
  controllerName: string | undefined;
  resourceName: string | undefined;
  translations: Record<string, string> | undefined;
  language: string;
  maaVersion: string | null;
}

/**
 * 递归解析对象中所有 `$` 开头的 i18n 字符串字段。
 * 返回的新对象中 label、description 等字段已替换为最终展示文本。
 */
function resolveI18nInObject(
  obj: Record<string, unknown>,
  translations?: Record<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      resolved[key] = resolveI18nText(value, translations);
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? resolveI18nInObject(item as Record<string, unknown>, translations)
          : typeof item === 'string'
            ? resolveI18nText(item, translations)
            : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      resolved[key] = resolveI18nInObject(value as Record<string, unknown>, translations);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * PI v2.5.0: 构建启动 Agent 子进程时应注入的 `PI_*` 环境变量。
 *
 * @see https://github.com/MaaXYZ/MaaFramework/pull/1226
 */
export function buildPiEnvVars(context: PiEnvContext): Record<string, string> {
  const { projectInterface, controllerName, resourceName, translations, language, maaVersion } =
    context;

  const envs: Record<string, string> = {};

  envs.PI_INTERFACE_VERSION = 'v2.5.0';
  envs.PI_CLIENT_NAME = 'MXU';
  envs.PI_CLIENT_VERSION =
    typeof __MXU_VERSION__ !== 'undefined' ? __MXU_VERSION__ : 'unknown';
  envs.PI_CLIENT_LANGUAGE = getInterfaceLangKey(language);

  if (maaVersion) {
    envs.PI_CLIENT_MAAFW_VERSION = maaVersion.startsWith('v') ? maaVersion : `v${maaVersion}`;
  }

  if (projectInterface?.version) {
    envs.PI_VERSION = projectInterface.version;
  }

  const controller = projectInterface?.controller.find((c) => c.name === controllerName);
  if (controller) {
    const resolved = resolveI18nInObject(
      controller as unknown as Record<string, unknown>,
      translations,
    );
    envs.PI_CONTROLLER = JSON.stringify(resolved);
  }

  const resource = projectInterface?.resource.find((r) => r.name === resourceName);
  if (resource) {
    const resolved = resolveI18nInObject(
      resource as unknown as Record<string, unknown>,
      translations,
    );
    envs.PI_RESOURCE = JSON.stringify(resolved);
  }

  return envs;
}
