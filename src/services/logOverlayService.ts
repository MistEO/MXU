/**
 * 日志悬浮窗服务
 *
 * - 只有控制器连接后才显示
 * - 定点模式：固定在屏幕位置，可拖拽，不跟随
 * - 跟随模式：锚定在控制器连接的窗口（游戏窗口）附近，跟随移动
 * - 层级选项：最置顶 / 只在连接窗口上一层（两种模式都生效）
 * - 关闭时保存悬浮窗尺寸，下次打开时恢复
 * - 定点模式下确保悬浮窗在屏幕可见范围内
 *
 * 所有坐标和尺寸统一使用物理像素（与 Win32 API 一致），避免 DPI 缩放问题。
 */

import { invoke } from '@tauri-apps/api/core';
import { getAllWindows, availableMonitors } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/utils/paths';
import { loggers } from '@/utils/logger';
import { useAppStore } from '@/stores/appStore';

const log = loggers.app;

const OVERLAY_LABEL = 'log-overlay';
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 260;
const DEFAULT_X = 100;
const DEFAULT_Y = 100;

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let closeListenerCleanup: (() => void) | null = null;
let closeListenerPending = false;
/** 程序主动关闭悬浮窗时为 true，close 事件中不修改 enabled 状态 */
let programmaticClose = false;
let saveTickCounter = 0;
const SAVE_INTERVAL_TICKS = 15; // 每 15 次 poll (~4.5s) 保存一次几何信息

// ========== Handle helpers ==========

async function queryConnectedHandle(): Promise<number | null> {
  const state = useAppStore.getState();

  // 优先查询当前激活实例的窗口句柄
  if (state.activeInstanceId) {
    const activeStatus = state.instanceConnectionStatus[state.activeInstanceId];
    if (activeStatus === 'Connected') {
      try {
        const handle = await invoke<number | null>('get_connected_window_handle', {
          instanceId: state.activeInstanceId,
        });
        if (handle) return handle;
      } catch {
        // ignore
      }
    }
  }

  // 回退：查找任意已连接实例
  for (const [instanceId, status] of Object.entries(state.instanceConnectionStatus)) {
    if (instanceId === state.activeInstanceId) continue; // 已经查过了
    if (status !== 'Connected') continue;
    try {
      const handle = await invoke<number | null>('get_connected_window_handle', { instanceId });
      if (handle) return handle;
    } catch {
      // ignore
    }
  }
  return null;
}

function hasAnyConnection(): boolean {
  const state = useAppStore.getState();
  return Object.values(state.instanceConnectionStatus).some((s) => s === 'Connected');
}

async function queryTargetRect(handle: number) {
  const [x, y, w, h, scale] = await invoke<[number, number, number, number, number]>(
    'get_window_rect_by_handle',
    { handle },
  );
  return { x, y, w, h, scale };
}

// ========== Close event listener ==========

/**
 * 监听悬浮窗关闭事件（由 Rust on_window_event 发出）
 * 保存尺寸并同步 toggle 状态
 */
function setupCloseListener() {
  if (closeListenerCleanup || closeListenerPending) return;
  closeListenerPending = true;

  listen<{ width: number; height: number; x: number; y: number }>(
    'log-overlay-closed',
    (event) => {
      const { width, height, x, y } = event.payload;
      log.info(`Log overlay closed, saving size: ${width}x${height}, pos: (${x}, ${y})`);

      // 保存逻辑尺寸（Rust 端已将物理像素转为逻辑像素）
      if (width > 0 && height > 0) {
        useAppStore.getState().setLogOverlaySize(width, height);
      }

      // 保存位置（物理像素，与创建时一致）
      if (x != null && y != null) {
        useAppStore.getState().setLogOverlayPosition(x, y);
      }

      // 仅用户手动关闭时同步 enabled 状态；
      // 程序主动关闭（断开连接等）不修改 enabled，保留用户偏好
      if (!programmaticClose) {
        useAppStore.getState().setLogOverlayEnabled(false);
      }
      programmaticClose = false;
      stopPolling();
    },
  ).then((unlisten) => {
    closeListenerCleanup = unlisten;
    closeListenerPending = false;
  });
}

// ========== Screen bounds check ==========

/**
 * 确保位置在屏幕可见范围内（定点模式用）
 *
 * 坐标空间说明：
 * - 输入 x, y 为物理像素（来自 outerPosition / 保存的 logOverlayX/Y）
 * - Tauri 2.0 的 availableMonitors() 返回的 Monitor.position (PhysicalPosition)
 *   和 Monitor.size (PhysicalSize) 同样是物理像素
 * - 因此两者在同一坐标空间，无需额外转换
 */
async function clampToScreen(
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) return { x, y };

    // 检查位置是否在任一显示器范围内（至少有一部分可见）
    // position/size 均为物理像素
    const isVisible = monitors.some((m) => {
      const mx = m.position.x;
      const my = m.position.y;
      const mw = m.size.width;
      const mh = m.size.height;
      return x + 50 > mx && x < mx + mw && y + 30 > my && y < my + mh;
    });

    if (isVisible) return { x, y };

    // 不可见，移到主显示器左上角
    log.info('Log overlay: position out of screen, resetting');
    const primary = monitors[0];
    return {
      x: primary.position.x + 50,
      y: primary.position.y + 50,
    };
  } catch {
    return { x, y };
  }
}

// ========== Window management ==========

export async function showLogOverlay(): Promise<void> {
  if (!isTauri()) return;

  const state = useAppStore.getState();
  if (!state.logOverlayEnabled) return;
  if (!hasAnyConnection()) return;

  // 确保关闭事件监听器已设置
  setupCloseListener();

  try {
    const windows = await getAllWindows();
    const existing = windows.find((w) => w.label === OVERLAY_LABEL);

    if (existing) {
      await existing.show();
      startPolling();
      return;
    }

    // 使用保存的尺寸或默认值
    const overlayW = state.logOverlayWidth || DEFAULT_WIDTH;
    const overlayH = state.logOverlayHeight || DEFAULT_HEIGHT;

    let pos = await getInitialPosition(overlayW, overlayH);

    // 定点模式下检查屏幕范围
    if (state.logOverlayMode === 'fixed') {
      pos = await clampToScreen(pos.x, pos.y);
    }

    const alwaysOnTop = state.logOverlayZOrder === 'always_on_top';

    log.info(
      `Creating log overlay: pos=(${pos.x}, ${pos.y}), size=${overlayW}x${overlayH}, alwaysOnTop=${alwaysOnTop}, mode=${state.logOverlayMode}`,
    );

    await invoke('create_log_overlay_window', {
      x: pos.x,
      y: pos.y,
      width: overlayW,
      height: overlayH,
      alwaysOnTop,
    });

    log.info('Log overlay window created');
    startPolling();
  } catch (err) {
    log.error('Failed to create log overlay window:', err);
  }
}

export async function hideLogOverlay(keepEnabled = false): Promise<void> {
  if (!isTauri()) return;
  stopPolling();
  try {
    // 关闭前保存尺寸
    await saveOverlayGeometry();
    // 标记为程序主动关闭，close 事件中不修改 enabled 状态
    if (keepEnabled) {
      programmaticClose = true;
    }
    await invoke('close_log_overlay');
    log.info('Log overlay closed');
  } catch (err) {
    programmaticClose = false;
    log.error('Failed to close log overlay window:', err);
  }
}

export async function toggleLogOverlay(): Promise<void> {
  if (!isTauri()) return;
  try {
    const windows = await getAllWindows();
    const existing = windows.find((w) => w.label === OVERLAY_LABEL);
    if (existing) {
      await hideLogOverlay();
    } else {
      await showLogOverlay();
    }
  } catch {
    // ignore
  }
}

// ========== Unified polling ==========

function startPolling() {
  if (pollIntervalId) return;
  log.debug('Log overlay: starting poll');
  pollIntervalId = setInterval(pollTick, 300);
  pollTick();
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

async function pollTick() {
  const state = useAppStore.getState();
  const needFollow = state.logOverlayMode === 'follow';
  const needZOrder = state.logOverlayZOrder === 'above_target';

  // 定期保存悬浮窗尺寸（无论什么模式都需要）
  saveTickCounter++;
  if (saveTickCounter >= SAVE_INTERVAL_TICKS) {
    saveTickCounter = 0;
    saveOverlayGeometry();
  }

  if (!needFollow && !needZOrder) return;

  const handle = await queryConnectedHandle();
  if (!handle) return;

  try {
    if (needFollow) {
      const windows = await getAllWindows();
      const overlayWin = windows.find((w) => w.label === OVERLAY_LABEL);
      if (!overlayWin) return;

      const target = await queryTargetRect(handle);

      const physSize = await overlayWin.outerSize();
      const ow = physSize.width;
      const oh = physSize.height;

      const pos = calcAnchorPosition(
        target.x, target.y, target.w, target.h,
        ow, oh,
        state.logOverlayAnchor,
      );
      await overlayWin.setPosition(new PhysicalPosition(pos.x, pos.y));
    }

    if (needZOrder) {
      await invoke('set_overlay_above_target', { targetHandle: handle });
    }
  } catch {
    // window may have been closed or handle invalid
  }
}

/**
 * 保存悬浮窗当前尺寸和位置到 store（自动持久化到配置文件）
 */
async function saveOverlayGeometry() {
  try {
    const windows = await getAllWindows();
    const overlayWin = windows.find((w) => w.label === OVERLAY_LABEL);
    if (!overlayWin) return;

    const physSize = await overlayWin.innerSize();
    const scaleFactor = await overlayWin.scaleFactor();
    // inner_size 返回物理像素，创建窗口时用逻辑像素，需要转换
    const logicalW = Math.round(physSize.width / scaleFactor);
    const logicalH = Math.round(physSize.height / scaleFactor);
    if (logicalW > 0 && logicalH > 0) {
      const { logOverlayWidth, logOverlayHeight } = useAppStore.getState();
      if (logicalW !== logOverlayWidth || logicalH !== logOverlayHeight) {
        useAppStore.getState().setLogOverlaySize(logicalW, logicalH);
      }
    }

    // 保存位置（outer_position 返回物理像素，与创建时 PhysicalPosition 一致）
    const physPos = await overlayWin.outerPosition();
    const { logOverlayX, logOverlayY } = useAppStore.getState();
    if (physPos.x !== logOverlayX || physPos.y !== logOverlayY) {
      useAppStore.getState().setLogOverlayPosition(physPos.x, physPos.y);
    }
  } catch {
    // overlay may have been closed
  }
}

// ========== Position calculation ==========

function calcAnchorPosition(
  wx: number, wy: number, ww: number, wh: number,
  ow: number, oh: number,
  anchor: string,
): { x: number; y: number } {
  switch (anchor) {
    case 'left-center':
      return { x: wx, y: wy + Math.round((wh - oh) / 2) };
    case 'right-top-third':
      return { x: wx + ww - ow, y: wy + Math.round(wh / 3) - Math.round(oh / 2) };
    case 'right-bottom-third':
      return { x: wx + ww - ow, y: wy + Math.round((2 * wh) / 3) - Math.round(oh / 2) };
    case 'top-center':
      return { x: wx + Math.round((ww - ow) / 2), y: wy };
    default:
      return { x: wx + ww - ow, y: wy + Math.round(wh / 3) - Math.round(oh / 2) };
  }
}

async function getInitialPosition(
  overlayW: number,
  overlayH: number,
): Promise<{ x: number; y: number }> {
  const state = useAppStore.getState();

  if (state.logOverlayMode === 'follow') {
    const handle = await queryConnectedHandle();
    if (handle) {
      try {
        const target = await queryTargetRect(handle);
        const ow = Math.round(overlayW * target.scale);
        const oh = Math.round(overlayH * target.scale);
        return calcAnchorPosition(
          target.x, target.y, target.w, target.h,
          ow, oh,
          state.logOverlayAnchor,
        );
      } catch {
        // fallback
      }
    }
  }

  // 定点模式：优先使用上次保存的位置
  if (state.logOverlayX != null && state.logOverlayY != null) {
    return { x: state.logOverlayX, y: state.logOverlayY };
  }

  return { x: DEFAULT_X, y: DEFAULT_Y };
}

export async function onOverlaySettingsChanged(): Promise<void> {
  const state = useAppStore.getState();

  // 检查悬浮窗是否存在，不存在则无需操作
  const windows = await getAllWindows();
  if (!windows.some((w) => w.label === OVERLAY_LABEL)) return;

  try {
    await invoke('set_overlay_always_on_top', {
      alwaysOnTop: state.logOverlayZOrder === 'always_on_top',
    });
  } catch {
    // overlay may not exist yet
  }

  if (pollIntervalId) {
    stopPolling();
  }
  startPolling();
}

export function subscribeConnectionStatus(): () => void {
  // 设置关闭事件监听
  setupCloseListener();

  const unsub = useAppStore.subscribe(
    (state) => ({
      hasConnection: Object.values(state.instanceConnectionStatus).some((s) => s === 'Connected'),
      enabled: state.logOverlayEnabled,
    }),
    (curr, prev) => {
      if (!curr.enabled) return;

      if (curr.hasConnection && !prev.hasConnection) {
        log.info('Log overlay: connection detected, showing overlay');
        setTimeout(() => showLogOverlay().catch(() => {}), 500);
      } else if (!curr.hasConnection && prev.hasConnection) {
        log.info('Log overlay: all disconnected, hiding overlay (keeping enabled)');
        hideLogOverlay(true).catch(() => {});
      }
    },
    {
      equalityFn: (a, b) => a.hasConnection === b.hasConnection && a.enabled === b.enabled,
    },
  );

  return () => {
    unsub();
    if (closeListenerCleanup) {
      closeListenerCleanup();
      closeListenerCleanup = null;
    }
  };
}
