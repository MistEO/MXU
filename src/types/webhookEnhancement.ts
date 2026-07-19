import type { InputOption, SwitchOption } from './interface';
import {
  MXU_SPECIAL_TASKS,
  MXU_WEBHOOK_ENTRY,
  MXU_WEBHOOK_TASK_NAME,
} from './specialTasks';

const WEBHOOK_OPTION_KEY = '__MXU_WEBHOOK_OPTION__';
const WEBHOOK_HEADERS_SWITCH_OPTION_KEY = '__MXU_WEBHOOK_HEADERS_SWITCH_OPTION__';
const WEBHOOK_HEADERS_OPTION_KEY = '__MXU_WEBHOOK_HEADERS_OPTION__';

const DEFAULT_BODY_TEMPLATE = '{"content":"{title}\\n{content}\\n{time}"}';

/**
 * Replace the built-in URL-only webhook option with a MAA-style fixed POST configuration.
 * Keeping this as a small overlay avoids coupling the feature to the large special-task registry.
 */
const webhookOption: InputOption = {
  type: 'input',
  label: 'specialTask.webhook.optionLabel',
  description: 'specialTask.webhook.optionDescription',
  inputs: [
    {
      name: 'url',
      label: 'specialTask.webhook.urlLabel',
      default: '',
      pipeline_type: 'string',
      verify: '^https?://.+$',
      pattern_msg: 'specialTask.webhook.urlError',
      placeholder: 'specialTask.webhook.urlPlaceholder',
    },
    {
      name: 'title',
      label: 'specialTask.webhook.titleLabel',
      default: 'MXU',
      pipeline_type: 'string',
      placeholder: 'specialTask.webhook.titlePlaceholder',
    },
    {
      name: 'content',
      label: 'specialTask.webhook.contentLabel',
      default: '',
      pipeline_type: 'string',
      placeholder: 'specialTask.webhook.contentPlaceholder',
    },
    {
      name: 'body_template',
      label: 'specialTask.webhook.bodyTemplateLabel',
      default: DEFAULT_BODY_TEMPLATE,
      pipeline_type: 'string',
      verify: '^\\s*\\{[\\s\\S]*\\}\\s*$',
      pattern_msg: 'specialTask.webhook.bodyTemplateError',
      placeholder: 'specialTask.webhook.bodyTemplatePlaceholder',
    },
  ],
  pipeline_override: {
    [MXU_WEBHOOK_ENTRY]: {
      custom_action_param: {
        url: '{url}',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body_template: '{body_template}',
        title: '{title}',
        content: '{content}',
        timeout_secs: 15,
        fail_on_non_success: true,
      },
    },
  },
};

const webhookHeadersOption: InputOption = {
  type: 'input',
  label: 'specialTask.webhook.headersOptionLabel',
  description: 'specialTask.webhook.headersOptionDescription',
  inputs: [
    {
      name: 'header_1_name',
      label: 'specialTask.webhook.headerNameLabel',
      default: 'Authorization',
      pipeline_type: 'string',
      verify: '^[A-Za-z0-9-]+$',
      pattern_msg: 'specialTask.webhook.headerNameError',
      placeholder: 'specialTask.webhook.headerNamePlaceholder',
    },
    {
      name: 'header_1_value',
      label: 'specialTask.webhook.headerValueLabel',
      default: '',
      pipeline_type: 'string',
      placeholder: 'specialTask.webhook.headerValuePlaceholder',
    },
    {
      name: 'header_2_name',
      label: 'specialTask.webhook.headerNameLabel2',
      default: 'X-API-Key',
      pipeline_type: 'string',
      verify: '^[A-Za-z0-9-]+$',
      pattern_msg: 'specialTask.webhook.headerNameError',
      placeholder: 'specialTask.webhook.headerNamePlaceholder',
    },
    {
      name: 'header_2_value',
      label: 'specialTask.webhook.headerValueLabel2',
      default: '',
      pipeline_type: 'string',
      placeholder: 'specialTask.webhook.headerValuePlaceholder',
    },
  ],
  pipeline_override: {
    [MXU_WEBHOOK_ENTRY]: {
      custom_action_param: {
        headers: {
          '{header_1_name}': '{header_1_value}',
          '{header_2_name}': '{header_2_value}',
        },
      },
    },
  },
};

const webhookHeadersSwitchOption: SwitchOption = {
  type: 'switch',
  label: 'specialTask.webhook.headersSwitchLabel',
  description: 'specialTask.webhook.headersSwitchDescription',
  cases: [
    {
      name: 'Yes',
      label: 'specialTask.webhook.headersSwitchYes',
      option: [WEBHOOK_HEADERS_OPTION_KEY],
    },
    {
      name: 'No',
      label: 'specialTask.webhook.headersSwitchNo',
    },
  ],
  default_case: 'No',
};

const webhookTask = MXU_SPECIAL_TASKS[MXU_WEBHOOK_TASK_NAME];
if (webhookTask) {
  webhookTask.taskDef.option = [WEBHOOK_OPTION_KEY, WEBHOOK_HEADERS_SWITCH_OPTION_KEY];
  webhookTask.optionDefs[WEBHOOK_OPTION_KEY] = webhookOption;
  webhookTask.optionDefs[WEBHOOK_HEADERS_SWITCH_OPTION_KEY] = webhookHeadersSwitchOption;
  webhookTask.optionDefs[WEBHOOK_HEADERS_OPTION_KEY] = webhookHeadersOption;
}
