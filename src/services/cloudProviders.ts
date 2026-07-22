import type { CloudConfig, Win32Config } from '@/types/interface';

/**
 * 云串流服务商的窗口签名与截图/输入方式。Cloud 控制器本质是一个特定配置的 Win32
 * 窗口：按 窗口类 + 标题 定位，使用给定的截图/输入方式驱动。签名与 MaaFramework
 * 内置的 provider 注册表保持一致（见 CloudProviders.h）。
 */
interface CloudProvider {
  /** 窗口类名正则 */
  class_regex: string;
  /** 标题正则模板，含 {game} 占位符 */
  title_template: string;
  /** Win32 截图方式 */
  screencap: string;
  /** Win32 鼠标/键盘输入方式 */
  input: string;
}

const CLOUD_PROVIDERS: Record<string, CloudProvider> = {
  // GeForce NOW 原生桌面客户端（CEF 流窗口）。签名由 MaaEnd / MaaNTE 实测确认。
  geforce_now: {
    class_regex: 'CEFCLIENT',
    title_template: '{game}.*on GeForce NOW',
    screencap: 'PrintWindow',
    input: 'Seize',
  },
};

/** 是否为已知云服务商。 */
export function isKnownCloudProvider(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLOUD_PROVIDERS, name);
}

/**
 * 把 Cloud 控制器脱糖为等价的 Win32 配置：由 provider 决定窗口类/截图/输入方式，
 * 并把 game_title 代入标题模板。未知 provider 返回 null。
 */
export function cloudToWin32Config(cloud: CloudConfig): Win32Config | null {
  const provider = CLOUD_PROVIDERS[cloud.provider];
  if (!provider) {
    return null;
  }
  const game = cloud.game_title ?? '';
  const window_regex = provider.title_template.replace(/\{game\}/g, game);
  return {
    class_regex: provider.class_regex,
    window_regex,
    screencap: provider.screencap,
    mouse: provider.input,
    keyboard: provider.input,
  };
}
