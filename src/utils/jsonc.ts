import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { loggers } from './logger';

const log = loggers.app;

/**
 * 解析 JSONC 格式的字符串（支持注释和尾逗号）
 * @param content JSON/JSONC 字符串内容
 * @param sourceName 来源名称，用于错误日志
 */
export function parseJsonc<T>(content: string, sourceName?: string): T {
  const errors: ParseError[] = [];
  const result = parse(content, errors, {
    allowTrailingComma: true,
  });

  if (errors.length > 0) {
    const source = sourceName ? ` [${sourceName}]` : '';
    for (const error of errors) {
      log.warn(`JSONC 解析警告${source}: ${printParseErrorCode(error.error)} at offset ${error.offset}`);
    }
  }

  return result as T;
}
