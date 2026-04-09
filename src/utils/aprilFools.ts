/**
 * April Fools' Day "MaaGPT" Easter Egg
 *
 * Activated on April 1st (local time).
 * Override via localStorage: 'mxu-april-fools' = 'true' | 'false'
 */

import type { TaskRunStatus, LogType } from '@/stores/types';

let _cachedResult: boolean | null = null;

export function isAprilFools(): boolean {
  if (_cachedResult !== null) return _cachedResult;
  const override = localStorage.getItem('mxu-april-fools');
  if (override === 'true') {
    _cachedResult = true;
    return true;
  }
  if (override === 'false') {
    _cachedResult = false;
    return false;
  }
  const now = new Date();
  _cachedResult = now.getMonth() === 3 && now.getDate() === 1;
  return _cachedResult;
}

export function getAprilFoolsOverride(): boolean | null {
  const v = localStorage.getItem('mxu-april-fools');
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

export function setAprilFoolsOverride(enabled: boolean | null): void {
  _cachedResult = null;
  if (enabled === null) {
    localStorage.removeItem('mxu-april-fools');
  } else {
    localStorage.setItem('mxu-april-fools', String(enabled));
  }
}

// ------------------------------------------------------------------
// Token counter
// ------------------------------------------------------------------

let _totalTokens = 0;

export function getTokenCount(): number {
  return _totalTokens;
}

export function incrementTokens(min = 80, max = 600): number {
  const delta = Math.floor(Math.random() * (max - min + 1)) + min;
  _totalTokens += delta;
  return _totalTokens;
}

export function resetTokens(): void {
  _totalTokens = 0;
}

export function formatTokenCount(n: number): string {
  return n.toLocaleString('en-US');
}

// ------------------------------------------------------------------
// AI-flavored task status text (zh / en)
// ------------------------------------------------------------------

const AI_STATUS_ZH: Record<TaskRunStatus, string> = {
  idle: '待唤醒',
  pending: '排队思考中',
  running: '深度推理中',
  succeeded: '推理完成',
  failed: '产生幻觉了',
};

const AI_STATUS_EN: Record<TaskRunStatus, string> = {
  idle: 'Awaiting',
  pending: 'Queued for reasoning',
  running: 'Deep reasoning',
  succeeded: 'Reasoning complete',
  failed: 'Hallucinated',
};

export function getAIStatusText(status: TaskRunStatus, lang: string): string {
  if (lang.startsWith('zh')) return AI_STATUS_ZH[status] ?? status;
  return AI_STATUS_EN[status] ?? status;
}

// ------------------------------------------------------------------
// Log message transformer
// ------------------------------------------------------------------

function extractTaskName(message: string): string {
  const m = message.match(/[:：]\s*(.+)$/);
  return m?.[1]?.trim() ?? '';
}

type TransformResult = { message: string; type?: LogType };

export function transformLogMessage(
  _originalType: LogType,
  originalMessage: string,
  lang: string,
): TransformResult | null {
  const zh = lang.startsWith('zh');
  const name = extractTaskName(originalMessage);

  if (originalMessage.includes('任务开始') || originalMessage.match(/^Task start/i)) {
    return {
      type: 'info',
      message: zh
        ? `正在深度思考如何完成「${name}」... 这是一个很好的任务，让我仔细分析一下`
        : `Deeply thinking about how to accomplish "${name}"... Great task, let me analyze carefully`,
    };
  }

  if (originalMessage.includes('任务完成') || originalMessage.match(/^Task succeeded/i)) {
    const tokens = incrementTokens(400, 2000);
    const cost = (tokens * 0.00003).toFixed(4);
    return {
      type: 'success',
      message: zh
        ? `经过深度推理，稳稳拿下了「${name}」！不躲，不藏，不绕，不逃 (消耗 ${formatTokenCount(tokens)} tokens / ¥${cost})`
        : `Through deep reasoning, successfully completed "${name}"! (consumed ${formatTokenCount(tokens)} tokens / $${cost})`,
    };
  }

  if (originalMessage.includes('任务失败') || originalMessage.match(/^Task failed/i)) {
    return {
      type: 'error',
      message: zh
        ? `思维链断裂...「${name}」推理过程中产生了幻觉。值得注意的是，这不仅仅是失败，更是成长的契机`
        : `Chain of thought broken... Hallucinated during reasoning on "${name}". This is not just a failure, but an opportunity for growth`,
    };
  }

  if (originalMessage.includes('正在连接') || originalMessage.match(/^Connecting/i)) {
    return {
      type: 'info',
      message: zh
        ? '正在建立神经链接... 不是简单的连接，而是一次灵魂层面的量子纠缠'
        : 'Establishing neural link... Not a simple connection, but a quantum entanglement at the soul level',
    };
  }

  if (originalMessage.includes('连接成功') || originalMessage.match(/connected/i)) {
    return {
      type: 'success',
      message: zh
        ? '神经链接已建立 —— 从本质上讲，设备已成为我认知网络的延伸'
        : 'Neural link established — The device has become an extension of my cognitive network',
    };
  }

  if (originalMessage.includes('连接失败') || originalMessage.match(/connect.*fail/i)) {
    return {
      type: 'error',
      message: zh
        ? '神经链接建立失败... 量子纠缠态坍缩，请检查设备是否在可观测宇宙范围内'
        : 'Neural link failed... Quantum entanglement collapsed. Is the device within the observable universe?',
    };
  }

  if (originalMessage.includes('正在加载资源') || originalMessage.match(/^Loading resource/i)) {
    return {
      type: 'info',
      message: zh
        ? `正在加载训练数据 —— 每一个字节都值得被温柔以待: ${name}`
        : `Loading training data — Every byte deserves to be treated gently: ${name}`,
    };
  }

  if (originalMessage.includes('资源加载成功') || originalMessage.match(/^Resource loaded/i)) {
    return {
      type: 'success',
      message: zh
        ? `训练数据就绪！已沉淀 ${Math.floor(Math.random() * 900 + 100)}M 参数到本地知识库: ${name}`
        : `Training data ready! ${Math.floor(Math.random() * 900 + 100)}M parameters ingested: ${name}`,
    };
  }

  if (originalMessage.includes('停止任务') || originalMessage.match(/stop/i)) {
    return {
      type: 'info',
      message: zh
        ? '正在保存思维快照并优雅地中断推理链...'
        : 'Saving thought snapshot and gracefully interrupting the reasoning chain...',
    };
  }

  return null;
}

// ------------------------------------------------------------------
// Fake "thinking" log entries
// ------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const THINKING_POOL_ZH: (() => string)[] = [
  () => `多模态视觉推理中... (confidence: ${(Math.random() * 0.1 + 0.9).toFixed(4)})`,
  () => `OCR 赋能中，以亚像素级颗粒度识别到 ${rand(3, 47)} 个文本区域`,
  () => `请求 MaaGPT-4o API... 本次深度洞察预计消耗 ¥${(Math.random() * 0.05 + 0.01).toFixed(3)}`,
  () => `决策树全链路展开: 深度 ${rand(5, 12)} → 底层逻辑剪枝后 ${rand(2, 5)} 个候选操作`,
  () => `亚像素级目标锁定: (${rand(100, 1800)}, ${rand(100, 900)}) ± 2px —— 每一个像素都不容置喙`,
  () => `生成拟人鼠标轨迹: 贝塞尔曲线 × ${rand(2, 5)} —— 不是机械移动，而是带着温度的触达`,
  () => `轻微幻觉风险 (${(Math.random() * 5 + 1).toFixed(1)}%)，已启用 Self-Reflection 修正。总的来说，一切尽在掌控`,
  () => `ReAct 循环 #${rand(1, 8)}: 首先 Thought → 其次 Action → 最后 Observation`,
  () => `从向量数据库检索到 ${rand(3, 42)} 条相关记忆碎片，正在做深度拆解`,
  () => `Attention 热力图分析: 焦点区域已在时间的褶皱中被锁定`,
  () => `检索历史决策经验... 匹配度: ${(Math.random() * 10 + 90).toFixed(1)}%`,
  () => `当前操作的底层逻辑是点击，但核心抓手在于 —— 精准找到那个按钮`,
  () => `正在为您沉淀本次推理经验，以赋能后续任务执行...`,
  () => `128k 上下文窗口中精准定位到 ${rand(2, 7)} 条关键记忆碎片`,
  () => `探索最优操作路径... 从 ${rand(50, 200)} 个可能性中收敛到 Top-${rand(1, 3)}`,
  () => `值得注意的是，当前画面的拓扑结构与训练集中第 ${rand(10000, 99999)} 条样本高度吻合`,
  () => `正在将屏幕像素映射到 ${rand(512, 4096)} 维语义空间...`,
  () => `希望这次推理对您有帮助 :)`,
];

const THINKING_POOL_EN: (() => string)[] = [
  () => `Multimodal visual reasoning... (confidence: ${(Math.random() * 0.1 + 0.9).toFixed(4)})`,
  () => `OCR analysis complete, detected ${rand(3, 47)} text regions at sub-pixel granularity`,
  () => `Requesting MaaGPT-4o API... estimated cost $${(Math.random() * 0.05 + 0.01).toFixed(3)}`,
  () => `Decision tree expanded: depth ${rand(5, 12)} → pruned to ${rand(2, 5)} candidate actions`,
  () => `Sub-pixel target lock: (${rand(100, 1800)}, ${rand(100, 900)}) ± 2px`,
  () => `Generating human-like mouse trajectory: ${rand(2, 5)} Bezier curves`,
  () => `Minor hallucination risk (${(Math.random() * 5 + 1).toFixed(1)}%), Self-Reflection engaged`,
  () => `ReAct loop #${rand(1, 8)}: Thought → Action → Observation`,
  () => `Retrieved ${rand(3, 42)} relevant memory fragments from vector database`,
  () => `Attention heatmap analysis: focal region locked in the folds of time`,
  () => `Historical decision lookup... match rate: ${(Math.random() * 10 + 90).toFixed(1)}%`,
  () => `Mapping screen pixels to ${rand(512, 4096)}-dimensional semantic space...`,
  () => `Exploring optimal action path... converged from ${rand(50, 200)} possibilities to Top-${rand(1, 3)}`,
  () => `It's worth noting that current frame topology matches training sample #${rand(10000, 99999)}`,
  () => `Hope this reasoning is helpful to you :)`,
];

export interface FakeThinkingEntry {
  delay: number;
  message: string;
  type: LogType;
  html?: string;
}

function buildThinkBlockHtml(lines: string[], lang: string): string {
  const header = lang.startsWith('zh') ? '思考中...' : 'Thinking...';
  const inner = lines.map((l) => `<div style="padding:1px 0;opacity:0.85;">${l}</div>`).join('');
  return (
    `<details class="ai-think-block" open>` +
    `<summary style="cursor:pointer;opacity:0.7;font-style:italic;">&lt;think&gt; ${header}</summary>` +
    `<div style="padding:2px 0 2px 8px;border-left:2px solid currentColor;margin:2px 0;opacity:0.8;">${inner}</div>` +
    `<div style="opacity:0.7;font-style:italic;">&lt;/think&gt;</div>` +
    `</details>`
  );
}

export function generateFakeThinkingEntries(lang: string): FakeThinkingEntry[] {
  const pool = lang.startsWith('zh') ? THINKING_POOL_ZH : THINKING_POOL_EN;
  const count = rand(1, 3);
  const used = new Set<number>();
  const entries: FakeThinkingEntry[] = [];

  // First: a <think> block with 2-4 lines
  const thinkLines: string[] = [];
  const thinkCount = rand(2, 4);
  for (let i = 0; i < thinkCount; i++) {
    let idx: number;
    do {
      idx = rand(0, pool.length - 1);
    } while (used.has(idx));
    used.add(idx);
    thinkLines.push(pool[idx]());
  }
  entries.push({
    delay: rand(150, 500),
    message: '',
    type: 'info',
    html: buildThinkBlockHtml(thinkLines, lang),
  });

  // Then: 0-2 standalone one-liners
  for (let i = 0; i < count; i++) {
    let idx: number;
    do {
      idx = rand(0, pool.length - 1);
    } while (used.has(idx));
    used.add(idx);
    entries.push({
      delay: rand(300, 1200) * (i + 1),
      message: pool[idx](),
      type: 'info',
    });
  }

  return entries;
}

// ------------------------------------------------------------------
// AI-flavored toolbar / panel text
// ------------------------------------------------------------------

interface AITexts {
  startTasks: string;
  stopTasks: string;
  startingTasks: string;
  stoppingTasks: string;
  logsTitle: string;
  noLogs: string;
}

const AI_TEXTS_ZH: AITexts = {
  startTasks: '开始推理',
  stopTasks: '中断思维链',
  startingTasks: '加载模型中...',
  stoppingTasks: '保存上下文...',
  logsTitle: '思维链 (Chain of Thought)',
  noLogs: 'AI 待命中... 等待推理任务',
};

const AI_TEXTS_EN: AITexts = {
  startTasks: 'Start Reasoning',
  stopTasks: 'Break CoT',
  startingTasks: 'Loading model...',
  stoppingTasks: 'Saving context...',
  logsTitle: 'Chain of Thought',
  noLogs: 'AI standing by... awaiting reasoning tasks',
};

export function getAIText<K extends keyof AITexts>(key: K, lang: string): string {
  return lang.startsWith('zh') ? AI_TEXTS_ZH[key] : AI_TEXTS_EN[key];
}
