import { loggers } from './logger';

const log = loggers.app;

// 最小窗口尺寸
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 500;

// 左侧面板最小宽度（确保工具栏按钮文字不换行）
export const MIN_LEFT_PANEL_WIDTH = 530;

// 检测是否在 Tauri 环境中
export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * 验证窗口尺寸是否有效
 */
export function isValidWindowSize(width: number, height: number): boolean {
  return width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT;
}

/**
 * 设置窗口标题
 */
export async function setWindowTitle(title: string) {
  // 同时设置 document.title（对浏览器和 Tauri 都有效）
  document.title = title;

  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      await currentWindow.setTitle(title);
    } catch (err) {
      log.warn('设置窗口标题失败:', err);
    }
  }
}

/**
 * 设置窗口大小
 */
export async function setWindowSize(width: number, height: number) {
  if (!isValidWindowSize(width, height)) {
    log.warn('窗口大小无效，跳过设置:', { width, height });
    return;
  }

  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const currentWindow = getCurrentWindow();
      await currentWindow.setSize(new LogicalSize(width, height));
    } catch (err) {
      log.warn('设置窗口大小失败:', err);
    }
  }
}

/**
 * 获取当前窗口大小
 */
export async function getWindowSize(): Promise<{ width: number; height: number } | null> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const size = await currentWindow.innerSize();
      const scaleFactor = await currentWindow.scaleFactor();
      // 转换为逻辑像素
      return {
        width: Math.round(size.width / scaleFactor),
        height: Math.round(size.height / scaleFactor),
      };
    } catch (err) {
      log.warn('获取窗口大小失败:', err);
    }
  }
  return null;
}
