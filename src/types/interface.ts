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
  agent?: AgentConfig;
  controller: ControllerItem[];
  resource: ResourceItem[];
  task: TaskItem[];
  option?: Record<string, OptionDefinition>;
  /** v2.2.0: 导入其他 PI 文件的路径数组，只导入 task 和 option 字段 */
  import?: string[];
}

export interface AgentConfig {
  child_exec: string;
  child_args?: string[];
  identifier?: string;
  /** 连接超时时间（毫秒），-1 表示无限等待 */
  timeout?: number;
}

export type ControllerType = 'Adb' | 'Win32' | 'PlayCover' | 'Gamepad';

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
  adb?: Record<string, unknown>;
  win32?: Win32Config;
  playcover?: PlayCoverConfig;
  gamepad?: GamepadConfig;
}

export interface Win32Config {
  class_regex?: string;
  window_regex?: string;
  mouse?: string;
  keyboard?: string;
  screencap?: string;
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
}

export interface TaskItem {
  name: string;
  label?: string;
  entry: string;
  default_check?: boolean;
  description?: string;
  icon?: string;
  resource?: string[];
  controller?: string[];
  pipeline_override?: Record<string, unknown>;
  option?: string[];
}

export type OptionType = 'select' | 'input' | 'switch';

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
  /** MXU 扩展：输入控件类型，'file' 会渲染文件选择器 */
  input_type?: 'text' | 'file';
  /** MXU 扩展：输入框占位提示文本（i18n key） */
  placeholder?: string;
}

export interface SelectOption {
  type?: 'select';
  label?: string;
  description?: string;
  icon?: string;
  cases: CaseItem[];
  default_case?: string;
}

export interface SwitchOption {
  type: 'switch';
  label?: string;
  description?: string;
  icon?: string;
  cases: [CaseItem, CaseItem];
  default_case?: string;
}

export interface InputOption {
  type: 'input';
  label?: string;
  description?: string;
  icon?: string;
  inputs: InputItem[];
  pipeline_override?: Record<string, unknown>;
}

export type OptionDefinition = SelectOption | SwitchOption | InputOption;

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
  playcoverAddress?: string;
}

// 定时执行策略
export interface SchedulePolicy {
  id: string;
  name: string; // 策略名称
  enabled: boolean; // 是否启用
  weekdays: number[]; // 重复日期 (0-6, 0=周日)
  hours: number[]; // 开始时间 (0-23)
}

// pre-action config
export interface ActionConfig {
  enabled: boolean; // 是否启用
  program: string; // 程序路径
  args: string; // 附加参数
  waitForExit: boolean; // 是否等待进程退出（默认 true）
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
  preAction?: ActionConfig;
}

// 翻译文件类型
export type TranslationMap = Record<string, string>;

// ============================================================================
// MXU 内置特殊任务系统
// ============================================================================

/**
 * MXU 特殊任务定义接口
 * 用于注册 MXU 内置的特殊任务（通过 custom_action 实现）
 */
export interface MxuSpecialTaskDefinition {
  /** 任务唯一标识符，如 '__MXU_SLEEP__' */
  taskName: string;
  /** MaaFramework 任务入口名，如 'MXU_SLEEP' */
  entry: string;
  /** 虚拟 TaskItem 定义 */
  taskDef: TaskItem;
  /** 相关选项定义（键为选项 key） */
  optionDefs: Record<string, OptionDefinition>;
  /** 图标名称（对应 lucide-react 图标） */
  iconName: 'Clock' | 'Zap' | 'Bell' | 'Timer' | 'Pause' | 'Play';
  /** 图标颜色 CSS 类 */
  iconColorClass: string;
}

// MXU_SLEEP 特殊任务常量（保留向后兼容）
export const MXU_SLEEP_TASK_NAME = '__MXU_SLEEP__';
export const MXU_SLEEP_ENTRY = 'MXU_SLEEP';
export const MXU_SLEEP_ACTION = 'MXU_SLEEP_ACTION';

// MXU_LAUNCH 特殊任务常量
export const MXU_LAUNCH_TASK_NAME = '__MXU_LAUNCH__';
export const MXU_LAUNCH_ENTRY = 'MXU_LAUNCH';
export const MXU_LAUNCH_ACTION = 'MXU_LAUNCH_ACTION';

// MXU_WEBHOOK 特殊任务常量
export const MXU_WEBHOOK_TASK_NAME = '__MXU_WEBHOOK__';
export const MXU_WEBHOOK_ENTRY = 'MXU_WEBHOOK';
export const MXU_WEBHOOK_ACTION = 'MXU_WEBHOOK_ACTION';

// MXU_SLEEP 任务定义
const MXU_SLEEP_TASK_DEF_INTERNAL: TaskItem = {
  name: MXU_SLEEP_TASK_NAME,
  label: 'specialTask.sleep.label',
  entry: MXU_SLEEP_ENTRY,
  option: ['__MXU_SLEEP_OPTION__'],
  pipeline_override: {
    [MXU_SLEEP_ENTRY]: {
      action: 'Custom',
      custom_action: MXU_SLEEP_ACTION,
    },
  },
};

// MXU_SLEEP 选项定义
const MXU_SLEEP_OPTION_DEF_INTERNAL: InputOption = {
  type: 'input',
  label: 'specialTask.sleep.optionLabel',
  inputs: [
    {
      name: 'sleep_time',
      label: 'specialTask.sleep.inputLabel',
      default: '5',
      pipeline_type: 'int',
      verify: '^[1-9]\\d*$',
      pattern_msg: 'specialTask.sleep.inputError',
    },
  ],
  pipeline_override: {
    [MXU_SLEEP_ENTRY]: {
      custom_action_param: {
        sleep_time: '{sleep_time}',
      },
    },
  },
};

// MXU_LAUNCH 任务定义
const MXU_LAUNCH_TASK_DEF_INTERNAL: TaskItem = {
  name: MXU_LAUNCH_TASK_NAME,
  label: 'specialTask.launch.label',
  entry: MXU_LAUNCH_ENTRY,
  option: [
    '__MXU_LAUNCH_OPTION__',
    '__MXU_LAUNCH_WAIT_OPTION__',
  ],
  pipeline_override: {
    [MXU_LAUNCH_ENTRY]: {
      action: 'Custom',
      custom_action: MXU_LAUNCH_ACTION,
    },
  },
};

// MXU_LAUNCH 输入选项定义（程序路径和参数）
const MXU_LAUNCH_INPUT_OPTION_DEF_INTERNAL: InputOption = {
  type: 'input',
  label: 'specialTask.launch.optionLabel',
  inputs: [
    {
      name: 'program',
      label: 'specialTask.launch.programLabel',
      default: '',
      pipeline_type: 'string',
      input_type: 'file',
      placeholder: 'specialTask.launch.programPlaceholder',
    },
    {
      name: 'args',
      label: 'specialTask.launch.argsLabel',
      default: '',
      pipeline_type: 'string',
      placeholder: 'specialTask.launch.argsPlaceholder',
    },
  ],
  pipeline_override: {
    [MXU_LAUNCH_ENTRY]: {
      custom_action_param: {
        program: '{program}',
        args: '{args}',
      },
    },
  },
};

// MXU_LAUNCH 等待选项定义（是否等待进程退出）
const MXU_LAUNCH_WAIT_OPTION_DEF_INTERNAL: SwitchOption = {
  type: 'switch',
  label: 'specialTask.launch.waitLabel',
  description: 'specialTask.launch.waitDescription',
  cases: [
    {
      name: 'Yes',
      label: 'specialTask.launch.waitYes',
      pipeline_override: {
        [MXU_LAUNCH_ENTRY]: {
          custom_action_param: {
            wait_for_exit: true,
          },
        },
      },
    },
    {
      name: 'No',
      label: 'specialTask.launch.waitNo',
      pipeline_override: {
        [MXU_LAUNCH_ENTRY]: {
          custom_action_param: {
            wait_for_exit: false,
          },
        },
      },
    },
  ],
  default_case: 'No',
};

// MXU_WEBHOOK 任务定义
const MXU_WEBHOOK_TASK_DEF_INTERNAL: TaskItem = {
  name: MXU_WEBHOOK_TASK_NAME,
  label: 'specialTask.webhook.label',
  entry: MXU_WEBHOOK_ENTRY,
  option: [
    '__MXU_WEBHOOK_OPTION__',
  ],
  pipeline_override: {
    [MXU_WEBHOOK_ENTRY]: {
      action: 'Custom',
      custom_action: MXU_WEBHOOK_ACTION,
    },
  },
};

// MXU_WEBHOOK 输入选项定义（URL）
const MXU_WEBHOOK_OPTION_DEF_INTERNAL: InputOption = {
  type: 'input',
  label: 'specialTask.webhook.optionLabel',
  inputs: [
    {
      name: 'url',
      label: 'specialTask.webhook.urlLabel',
      default: '',
      pipeline_type: 'string',
      placeholder: 'specialTask.webhook.urlPlaceholder',
    },
  ],
  pipeline_override: {
    [MXU_WEBHOOK_ENTRY]: {
      custom_action_param: {
        url: '{url}',
      },
    },
  },
};

/**
 * MXU 特殊任务注册表
 * 所有 MXU 内置特殊任务都在这里注册
 * 添加新特殊任务只需在此注册表中添加新条目
 */
export const MXU_SPECIAL_TASKS: Record<string, MxuSpecialTaskDefinition> = {
  [MXU_SLEEP_TASK_NAME]: {
    taskName: MXU_SLEEP_TASK_NAME,
    entry: MXU_SLEEP_ENTRY,
    taskDef: MXU_SLEEP_TASK_DEF_INTERNAL,
    optionDefs: {
      __MXU_SLEEP_OPTION__: MXU_SLEEP_OPTION_DEF_INTERNAL,
    },
    iconName: 'Clock',
    iconColorClass: 'text-warning/80',
  },
  [MXU_LAUNCH_TASK_NAME]: {
    taskName: MXU_LAUNCH_TASK_NAME,
    entry: MXU_LAUNCH_ENTRY,
    taskDef: MXU_LAUNCH_TASK_DEF_INTERNAL,
    optionDefs: {
      __MXU_LAUNCH_OPTION__: MXU_LAUNCH_INPUT_OPTION_DEF_INTERNAL,
      __MXU_LAUNCH_WAIT_OPTION__: MXU_LAUNCH_WAIT_OPTION_DEF_INTERNAL,
    },
    iconName: 'Play',
    iconColorClass: 'text-success/80',
  },
  [MXU_WEBHOOK_TASK_NAME]: {
    taskName: MXU_WEBHOOK_TASK_NAME,
    entry: MXU_WEBHOOK_ENTRY,
    taskDef: MXU_WEBHOOK_TASK_DEF_INTERNAL,
    optionDefs: {
      __MXU_WEBHOOK_OPTION__: MXU_WEBHOOK_OPTION_DEF_INTERNAL,
    },
    iconName: 'Bell',
    iconColorClass: 'text-info/80',
  },
};

// 导出兼容旧代码的常量（指向注册表中的定义）
export const MXU_SLEEP_TASK_DEF = MXU_SPECIAL_TASKS[MXU_SLEEP_TASK_NAME].taskDef;
export const MXU_SLEEP_OPTION_DEF = MXU_SPECIAL_TASKS[MXU_SLEEP_TASK_NAME].optionDefs[
  '__MXU_SLEEP_OPTION__'
] as InputOption;

/**
 * 判断是否为 MXU 内置特殊任务
 * @param taskName 任务名称
 * @returns 是否为特殊任务
 */
export function isMxuSpecialTask(taskName: string): boolean {
  return taskName in MXU_SPECIAL_TASKS;
}

/**
 * 获取 MXU 特殊任务定义
 * @param taskName 任务名称
 * @returns 特殊任务定义，不存在则返回 undefined
 */
export function getMxuSpecialTask(taskName: string): MxuSpecialTaskDefinition | undefined {
  return MXU_SPECIAL_TASKS[taskName];
}

/**
 * 获取 MXU 特殊任务的选项定义
 * @param taskName 任务名称
 * @param optionKey 选项键
 * @returns 选项定义，不存在则返回 undefined
 */
export function getMxuSpecialTaskOption(
  taskName: string,
  optionKey: string,
): OptionDefinition | undefined {
  const specialTask = MXU_SPECIAL_TASKS[taskName];
  return specialTask?.optionDefs[optionKey];
}

/**
 * 通过选项键反查 MXU 特殊任务的选项定义
 * 遍历所有注册的特殊任务，查找包含该 optionKey 的选项定义
 * @param optionKey 选项键，如 '__MXU_LAUNCH_WAIT_OPTION__'
 * @returns 选项定义，不存在则返回 undefined
 */
export function findMxuOptionByKey(optionKey: string): OptionDefinition | undefined {
  for (const specialTask of Object.values(MXU_SPECIAL_TASKS)) {
    const optionDef = specialTask.optionDefs[optionKey];
    if (optionDef) return optionDef;
  }
  return undefined;
}

/**
 * 获取所有 MXU 特殊任务定义列表
 * @returns 特殊任务定义数组
 */
export function getAllMxuSpecialTasks(): MxuSpecialTaskDefinition[] {
  return Object.values(MXU_SPECIAL_TASKS);
}
