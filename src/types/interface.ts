// MaaFramework ProjectInterface V2 协议类型定义

export interface ProjectInterface {
  interface_version: 2;
  languages?: Record<string, string>;
  name: string;
  label?: string;
  title?: string;
  icon?: string;
  mirrorchyan_rid?: string;
  mirrorchyan_multiplatform?: boolean;
  github?: string;
  version?: string;
  contact?: string;
  license?: string;
  welcome?: string;
  description?: string;
  agent?: AgentConfig | AgentConfig[];
  controller: ControllerItem[];
  resource: ResourceItem[];
  /** v2.4.0: 任务分组声明 */
  group?: GroupItem[];
  task: TaskItem[];
  option?: Record<string, OptionDefinition>;
  /** v2.3.0: 全局选项配置，参与到所有任务的 pipeline override 中 */
  global_option?: string[];
  /** v2.2.0: 导入其他 PI 文件的路径数组 */
  import?: string[];
  /** v2.3.0: 预设配置 */
  preset?: PresetItem[];
  /** v2.7.0: Controller 启动前执行的预任务声明 */
  pretask?: PretaskItem | PretaskItem[];
  /** v2.9.0: 可执行的外部程序任务声明 */
  exec_task?: ExecTaskItem | ExecTaskItem[];
}

/**
 * v2.7.0: 预任务（pretask）配置项。
 * 由项目在 interface.json 中声明，Client 应在连接 Controller 前按顺序执行这些外部程序。
 * 结构与 {@link ExecTaskItem} 一致，区别仅在于执行时机（前置、自动运行）。
 */
export interface PretaskItem {
  /** 要执行的程序路径，可以是系统 PATH 中的可执行文件 */
  exec: string;
  /** 可选。固定参数数组，按顺序传递给 exec */
  args?: string[];
  /** 可选。唯一标识符，缺省时回退到 exec */
  name?: string;
  /** 可选。UI 展示名称，支持国际化字符串（以 $ 开头） */
  label?: string;
  /** 可选。详细说明，支持国际化字符串/文件路径/URL，内容支持 Markdown */
  description?: string;
  /** 可选。图标路径，相对于 interface.json 所在目录 */
  icon?: string;
  /** 可选。引用的顶层 option 键名数组，其取值序列化为最后一个参数 */
  option?: string[];
}

/**
 * 将 PI 协议中的 pretask 字段（单对象或数组）标准化为数组。
 * 如果 pretask 未定义则返回 undefined。
 */
export function normalizePretaskConfigs(
  pretask: PretaskItem | PretaskItem[] | undefined,
): PretaskItem[] | undefined {
  if (!pretask) return undefined;
  return Array.isArray(pretask) ? pretask : [pretask];
}

/**
 * v2.7.0: 外部程序任务（exec_task）配置项。
 * 由项目在 interface.json 中声明，可作为可勾选/可排序的任务项调度执行外部程序。
 */
export interface ExecTaskItem {
  /** 要执行的程序路径，可以是系统 PATH 中的可执行文件 */
  exec: string;
  /** 可选。固定参数数组，按顺序传递给 exec */
  args?: string[];
  /** 可选。唯一标识符，缺省时回退到 exec */
  name?: string;
  /** 可选。UI 展示名称，支持国际化字符串（以 $ 开头） */
  label?: string;
  /** 可选。详细说明，支持国际化字符串/文件路径/URL，内容支持 Markdown */
  description?: string;
  /** 可选。图标路径，相对于 interface.json 所在目录 */
  icon?: string;
  /** 可选。引用的顶层 option 键名数组，其取值序列化为最后一个参数 */
  option?: string[];
}

/**
 * 将 PI 协议中的 exec_task 字段（单对象或数组）标准化为数组。
 * 如果 exec_task 未定义则返回 undefined。
 */
export function normalizeExecTaskConfigs(
  execTask: ExecTaskItem | ExecTaskItem[] | undefined,
): ExecTaskItem[] | undefined {
  if (!execTask) return undefined;
  return Array.isArray(execTask) ? execTask : [execTask];
}

/** v2.4.0: 任务分组声明 */
export interface GroupItem {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  default_expand?: boolean;
}

export interface AgentConfig {
  child_exec: string;
  child_args?: string[];
  identifier?: string;
  /** 连接超时时间（毫秒），-1 表示无限等待 */
  timeout?: number;
}

/**
 * 将 PI 协议中的 agent 字段（单对象或数组）标准化为数组。
 * 如果 agent 未定义则返回 undefined。
 */
export function normalizeAgentConfigs(
  agent: AgentConfig | AgentConfig[] | undefined,
): AgentConfig[] | undefined {
  if (!agent) return undefined;
  return Array.isArray(agent) ? agent : [agent];
}

export type ControllerType = 'Adb' | 'Win32' | 'WlRoots' | 'PlayCover' | 'Gamepad';

export interface ControllerItem {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  type: ControllerType;
  display_short_side?: number;
  display_long_side?: number;
  display_raw?: boolean;
  permission_required?: boolean;
  /** v2.2.0: 额外的资源路径数组，在 resource.path 加载完成后加载 */
  attach_resource_path?: string[];
  /** v2.3.0: 控制器级的选项配置 */
  option?: string[];
  adb?: Record<string, unknown>;
  win32?: Win32Config;
  wlroots?: WlRootsConfig;
  playcover?: PlayCoverConfig;
  gamepad?: GamepadConfig;
}

export interface Win32Config {
  class_regex?: string;
  window_regex?: string;
  mouse?: string;
  keyboard?: string;
  screencap?: string | string[];
}

export interface WlRootsConfig {
  wlr_socket_path?: string;
  use_win32_vk_code?: boolean;
}

export interface PlayCoverConfig {
  uuid?: string;
}

export interface GamepadConfig {
  class_regex?: string;
  window_regex?: string;
  gamepad_type?: 'Xbox360' | 'DualShock4' | 'DS4';
  screencap?: string;
}

export interface ResourceItem {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  path: string[];
  controller?: string[];
  option?: string[];
  /** v2.6.0: resource integrity hash from MaaResourceGetHash */
  hash?: string;
}

export interface TaskItem {
  name: string;
  label?: string;
  entry: string;
  default_check?: boolean;
  description?: string;
  icon?: string;
  /** v2.4.0: 任务所属分组列表 */
  group?: string[];
  resource?: string[];
  controller?: string[];
  pipeline_override?: Record<string, unknown>;
  option?: string[];
}

export type OptionType = 'select' | 'checkbox' | 'input' | 'switch';

export interface CaseItem {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  option?: string[];
  pipeline_override?: Record<string, unknown>;
}

export interface InputItem {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  default?: string;
  pipeline_type?: 'string' | 'int' | 'bool';
  verify?: string;
  pattern_msg?: string;
  /**
   * MXU 扩展：输入控件类型，'file' 会渲染文件选择器，'time' 会渲染时间选择器
   */
  input_type?: 'text' | 'file' | 'time';
  /** MXU 扩展：输入框占位提示文本（i18n key） */
  placeholder?: string;
}

export interface SelectOption {
  type?: 'select';
  label?: string;
  description?: string;
  icon?: string;
  controller?: string[];
  /** v2.3.0: 指定适用的资源包列表 */
  resource?: string[];
  cases: CaseItem[];
  default_case?: string;
}

/** v2.3.0: 多选框类型 */
export interface CheckboxOption {
  type: 'checkbox';
  label?: string;
  description?: string;
  icon?: string;
  controller?: string[];
  resource?: string[];
  cases: CaseItem[];
  default_case?: string[];
}

export interface SwitchOption {
  type: 'switch';
  label?: string;
  description?: string;
  icon?: string;
  controller?: string[];
  resource?: string[];
  cases: [CaseItem, CaseItem];
  default_case?: string;
}

export interface InputOption {
  type: 'input';
  label?: string;
  description?: string;
  icon?: string;
  controller?: string[];
  resource?: string[];
  inputs: InputItem[];
  pipeline_override?: Record<string, unknown>;
}

export type OptionDefinition = SelectOption | CheckboxOption | SwitchOption | InputOption;

// 运行时状态类型
export interface SelectedTask {
  id: string;
  taskName: string;
  customName?: string; // 用户自定义名称
  enabled: boolean;
  optionValues: Record<string, OptionValue>;
  expanded: boolean;
}

export type OptionValue =
  | {
      type: 'select';
      caseName: string;
    }
  | {
      type: 'checkbox';
      caseNames: string[];
    }
  | {
      type: 'switch';
      value: boolean;
    }
  | {
      type: 'input';
      values: Record<string, string>;
    };

// 保存的设备信息（运行时使用）
export interface SavedDeviceInfo {
  adbDeviceName?: string;
  windowName?: string;
  wlrSocketPath?: string;
  playcoverAddress?: string;
  /** Win32 连接窗口对应的进程可执行文件路径 */
  connectedProgramPath?: string;
}

// 定时执行策略
export interface SchedulePolicy {
  id: string;
  name: string; // 策略名称
  enabled: boolean; // 是否启用
  weekdays: number[]; // 重复日期 (0-6, 0=周日)
  times: string[]; // 开始时间点 ("HH:mm"，已排序去重)
}

// pre-action config
export interface ActionConfig {
  id: string; // 唯一标识（用于排序和识别）
  customName?: string; // 用户自定义名称
  enabled: boolean; // 是否启用
  program: string; // 程序路径
  args: string; // 附加参数
  waitForExit: boolean; // 是否等待进程退出（默认 true）
  skipIfRunning: boolean; // 程序已运行时跳过执行（默认 true）
  useCmd: boolean; // 通过 cmd /c 启动（仅 Windows，默认 false）
}

// 多开实例状态
export interface Instance {
  id: string;
  name: string;
  controllerId?: string;
  resourceId?: string;
  // 保存的控制器和资源名称
  controllerName?: string;
  resourceName?: string;
  // 保存的设备信息
  savedDevice?: SavedDeviceInfo;
  selectedTasks: SelectedTask[];
  isRunning: boolean;
  // 定时执行策略列表
  schedulePolicies?: SchedulePolicy[];
  preActions?: ActionConfig[];
}

/** v2.3.0: 预设中的任务配置 */
export interface PresetTaskItem {
  name: string;
  enabled?: boolean;
  option?: Record<string, PresetOptionValue>;
}

/** v2.3.0: 预设中的选项值 */
export type PresetOptionValue =
  | string // select / switch
  | string[] // checkbox
  | Record<string, string>; // input

/** v2.3.0: 预设配置项 */
export interface PresetItem {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  task: PresetTaskItem[];
}

/** v2.3.0: focus 模板，支持字符串简写和对象完整写法 */
export type FocusDisplayChannel = 'log' | 'toast' | 'notification' | 'dialog' | 'modal';

export interface FocusTemplateObject {
  content: string;
  display?: FocusDisplayChannel | FocusDisplayChannel[];
}

export type FocusTemplate = string | FocusTemplateObject;

// 翻译文件类型
export type TranslationMap = Record<string, string>;
