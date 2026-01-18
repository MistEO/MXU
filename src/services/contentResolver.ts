/**
 * 内容解析服务
 * 根据 ProjectInterface V2 协议，处理以下类型的内容：
 * 1. 国际化文本（以 $ 开头）
 * 2. 文件路径（相对路径）
 * 3. URL（http:// 或 https://）
 * 4. 直接文本
 */

import { loggers } from '@/utils/logger';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const log = loggers.app;

// 检测是否在 Tauri 环境中
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * 判断内容是否为 URL
 */
function isUrl(content: string): boolean {
  return content.startsWith('http://') || content.startsWith('https://');
}

/**
 * 判断内容是否为文件路径（简单判断：包含文件扩展名或以 ./ 开头）
 */
function isFilePath(content: string): boolean {
  if (isUrl(content)) return false;
  // 检查是否以 ./ 或 ../ 开头，或者包含常见文件扩展名
  return (
    content.startsWith('./') ||
    content.startsWith('../') ||
    /\.(md|txt|json|html)$/i.test(content)
  );
}

/**
 * 从文件路径加载内容
 */
async function loadFromFile(filePath: string, basePath: string): Promise<string> {
  // 构建完整路径
  const fullPath = filePath.startsWith('./')
    ? `${basePath}/${filePath.slice(2)}`
    : filePath.startsWith('../')
      ? `${basePath}/${filePath}`
      : `${basePath}/${filePath}`;

  if (isTauri()) {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
    if (await exists(fullPath)) {
      return await readTextFile(fullPath);
    }
    throw new Error(`文件不存在: ${fullPath}`);
  } else {
    const response = await fetch(fullPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }
}

/**
 * 从 URL 加载内容
 */
async function loadFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.text();
}

export interface ResolveOptions {
  /** 翻译映射表 */
  translations?: Record<string, string>;
  /** 资源基础路径 */
  basePath?: string;
  /** 是否加载外部内容（文件/URL），默认 true */
  loadExternal?: boolean;
}

/**
 * 解析国际化文本
 * 如果文本以 $ 开头，则从翻译表中查找对应的值
 */
export function resolveI18nText(
  text: string | undefined,
  translations?: Record<string, string>
): string {
  if (!text) return '';
  if (!text.startsWith('$')) return text;
  
  const key = text.slice(1);
  return translations?.[key] || key;
}

/**
 * 解析内容（同步版本，仅处理国际化）
 * 用于不需要加载外部内容的场景
 */
export function resolveContentSync(
  content: string | undefined,
  options: ResolveOptions = {}
): string {
  if (!content) return '';
  
  // 先处理国际化
  const resolved = resolveI18nText(content, options.translations);
  
  return resolved;
}

/**
 * 解析内容（异步版本，完整处理）
 * 支持国际化、文件路径、URL
 */
export async function resolveContent(
  content: string | undefined,
  options: ResolveOptions = {}
): Promise<string> {
  if (!content) return '';
  
  const { translations, basePath = '.', loadExternal = true } = options;
  
  // 先处理国际化
  let resolved = resolveI18nText(content, translations);
  
  if (!loadExternal) return resolved;
  
  try {
    // 检查是否为 URL
    if (isUrl(resolved)) {
      resolved = await loadFromUrl(resolved);
    }
    // 检查是否为文件路径
    else if (isFilePath(resolved)) {
      resolved = await loadFromFile(resolved, basePath);
    }
  } catch (err) {
    log.warn(`加载内容失败 [${resolved}]:`, err);
    // 加载失败时返回原始文本
  }
  
  return resolved;
}

/**
 * 解析图标路径
 * 返回可用于 img src 的路径
 */
export function resolveIconPath(
  iconPath: string | undefined,
  basePath: string,
  translations?: Record<string, string>
): string | undefined {
  if (!iconPath) return undefined;
  
  // 先处理国际化
  let resolved = resolveI18nText(iconPath, translations);
  
  if (!resolved) return undefined;
  
  // 如果是 URL 直接返回
  if (isUrl(resolved)) return resolved;
  
  // 构建完整路径
  if (resolved.startsWith('./')) {
    resolved = `${basePath}/${resolved.slice(2)}`;
  } else if (!resolved.startsWith('/') && !resolved.startsWith('http')) {
    resolved = `${basePath}/${resolved}`;
  }
  
  return resolved;
}

// 配置 marked，使用 use() API 添加 Tailwind 样式
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const styles: Record<number, string> = {
        1: 'text-xl font-bold mt-4 mb-2',
        2: 'text-lg font-semibold mt-4 mb-2',
        3: 'text-base font-semibold mt-3 mb-1',
        4: 'text-sm font-semibold mt-2 mb-1',
        5: 'text-sm font-medium mt-2 mb-1',
        6: 'text-xs font-medium mt-2 mb-1',
      };
      return `<h${depth} class="${styles[depth] || ''}">${text}</h${depth}>`;
    },

    paragraph({ tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<p class="my-1">${text}</p>`;
    },

    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">${text}</a>`;
    },

    code({ text, lang }) {
      const escapedCode = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const langClass = lang ? ` language-${lang}` : '';
      return `<pre class="bg-bg-tertiary rounded p-2 my-2 overflow-x-auto text-sm"><code class="${langClass}">${escapedCode}</code></pre>`;
    },

    codespan({ text }) {
      return `<code class="bg-bg-tertiary px-1 rounded text-sm">${text}</code>`;
    },

    list(token) {
      const body = token.items.map(item => this.listitem(item)).join('');
      const tag = token.ordered ? 'ol' : 'ul';
      const listClass = token.ordered ? 'list-decimal' : 'list-disc';
      return `<${tag} class="${listClass} list-inside my-1">${body}</${tag}>`;
    },

    listitem(item) {
      let text = this.parser.parse(item.tokens);
      if (item.task) {
        const checkbox = `<input type="checkbox" disabled ${item.checked ? 'checked' : ''} class="mr-1" />`;
        text = checkbox + text;
      }
      return `<li>${text}</li>`;
    },

    blockquote({ tokens }) {
      const text = this.parser.parse(tokens);
      return `<blockquote class="border-l-4 border-border pl-4 my-2 text-text-secondary italic">${text}</blockquote>`;
    },

    hr() {
      return '<hr class="my-4 border-border" />';
    },

    table(token) {
      const headerCells = token.header.map((cell, i) => 
        this.tablecell({ ...cell, align: token.align[i] })
      ).join('');
      const header = `<tr class="border-b border-border">${headerCells}</tr>`;

      const bodyRows = token.rows.map(row => {
        const cells = row.map((cell, i) => 
          this.tablecell({ ...cell, align: token.align[i] })
        ).join('');
        return `<tr class="border-b border-border">${cells}</tr>`;
      }).join('');

      return `<table class="w-full my-2 border-collapse"><thead>${header}</thead><tbody>${bodyRows}</tbody></table>`;
    },

    tablecell(token) {
      const text = this.parser.parseInline(token.tokens);
      const tag = token.header ? 'th' : 'td';
      const alignClass = token.align ? ` text-${token.align}` : '';
      const baseClass = token.header ? 'font-semibold' : '';
      return `<${tag} class="px-2 py-1${alignClass} ${baseClass}">${text}</${tag}>`;
    },

    strong({ tokens }) {
      return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    },

    em({ tokens }) {
      return `<em>${this.parser.parseInline(tokens)}</em>`;
    },

    del({ tokens }) {
      return `<del>${this.parser.parseInline(tokens)}</del>`;
    },

    image({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<img src="${href}" alt="${text}"${titleAttr} class="max-w-full my-2 rounded" />`;
    },
  },
});

/**
 * 将 Markdown 转换为安全的 HTML
 * 使用 marked 解析 markdown，使用 DOMPurify 清理 HTML 防止 XSS
 */
export function markdownToHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel'],
  });
}

/**
 * @deprecated 请使用 markdownToHtml
 */
export const simpleMarkdownToHtml = markdownToHtml;
