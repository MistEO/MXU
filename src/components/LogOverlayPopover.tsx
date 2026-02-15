import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { SwitchButton } from '@/components/FormControls';
import { isTauri } from '@/utils/paths';
import type { Win32Window } from '@/types/maa';

const POPOVER_WIDTH = 288; // w-72

interface LogOverlayPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function LogOverlayPopover({ open, onClose, anchorRef }: LogOverlayPopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  /* ---------- 定位状态 ---------- */
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [ready, setReady] = useState(false);

  /* ---------- store ---------- */
  const {
    logOverlayEnabled,
    setLogOverlayEnabled,
    logOverlayMode,
    setLogOverlayMode,
    logOverlayAnchor,
    setLogOverlayAnchor,
    logOverlayZOrder,
    setLogOverlayZOrder,
    activeInstanceId,
    selectedController: selectedControllerMap,
    projectInterface,
  } = useAppStore();

  /* ---------- ADB 窗口列表 ---------- */
  const [followWindows, setFollowWindows] = useState<Win32Window[]>([]);
  const [followWindowHandle, setFollowWindowHandle] = useState<number | null>(null);
  const [followWindowLoading, setFollowWindowLoading] = useState(false);

  const activeControllerName = activeInstanceId ? selectedControllerMap[activeInstanceId] : undefined;
  const activeControllerDef = projectInterface?.controller.find((c) => c.name === activeControllerName);
  const isAdbController = activeControllerDef?.type === 'Adb' || activeControllerDef?.type === 'PlayCover';

  const refreshFollowWindows = useCallback(async () => {
    if (!isTauri()) return;
    setFollowWindowLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const windows = await invoke<Win32Window[]>('maa_find_win32_windows', {
        classRegex: '',
        windowRegex: '',
      });
      setFollowWindows(windows.filter((w) => w.window_name.trim().length > 0));
    } catch {
      // ignore
    } finally {
      setFollowWindowLoading(false);
    }
  }, []);

  const selectFollowWindow = useCallback(
    async (handle: number | null) => {
      if (!isTauri() || !activeInstanceId) return;
      setFollowWindowHandle(handle);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_connected_window_handle', {
          instanceId: activeInstanceId,
          handle,
        });
        import('@/services/logOverlayService').then(({ onOverlaySettingsChanged }) =>
          onOverlaySettingsChanged(),
        );
        onClose();
      } catch {
        // ignore
      }
    },
    [activeInstanceId, onClose],
  );

  /* ---------- 打开时加载当前 handle ---------- */
  useEffect(() => {
    if (!open || !activeInstanceId) return;
    let cancelled = false;
    const loadCurrentHandle = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const handle = await invoke<number | null>('get_connected_window_handle', {
          instanceId: activeInstanceId,
        });
        if (!cancelled) setFollowWindowHandle(handle ?? null);
      } catch {
        if (!cancelled) setFollowWindowHandle(null);
      }
    };
    loadCurrentHandle();
    return () => {
      cancelled = true;
    };
  }, [open, activeInstanceId]);

  /* ---------- 自动刷新 ADB 窗口列表 ---------- */
  useEffect(() => {
    if (open && isAdbController && logOverlayMode === 'follow' && followWindows.length === 0) {
      refreshFollowWindows();
    }
  }, [open, isAdbController, logOverlayMode, followWindows.length, refreshFollowWindows]);

  /* ---------- 定位逻辑 ---------- */
  // 关闭时重置
  useEffect(() => {
    if (!open) {
      setReady(false);
    }
  }, [open]);

  // 打开 / 内容变化 → 计算位置
  // 所有会影响面板高度的状态都放入 deps，确保重算
  useLayoutEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    const panelWidth = panel.offsetWidth || POPOVER_WIDTH;

    const spaceBelow = window.innerHeight - anchorRect.bottom - 8;
    const spaceAbove = anchorRect.top - 8;

    let top: number;
    if (spaceBelow >= panelHeight) {
      top = anchorRect.bottom + 4;
    } else if (spaceAbove >= panelHeight) {
      top = anchorRect.top - panelHeight - 4;
    } else {
      top = spaceBelow >= spaceAbove
        ? anchorRect.bottom + 4
        : Math.max(8, anchorRect.top - panelHeight - 4);
    }

    let left = anchorRect.right - panelWidth;
    if (left < 8) left = 8;
    if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;

    setPos({ top, left });
    setReady(true);
  }, [open, anchorRef, logOverlayEnabled, logOverlayMode, isAdbController, followWindows.length]);

  /* ---------- 点击外部 / Esc 关闭 ---------- */
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = panelRef.current;
      const anchor = anchorRef.current;
      // 点击面板内部 → 不关闭
      if (el?.contains(e.target as Node)) return;
      // 点击触发按钮 → 不关闭（让按钮自身的 onClick toggle 处理）
      if (anchor?.contains(e.target as Node)) return;

      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  /* ---------- 操作回调 ---------- */
  const handleToggleEnabled = (v: boolean) => {
    setLogOverlayEnabled(v);
    if (v) {
      import('@/services/logOverlayService').then(({ showLogOverlay }) => showLogOverlay());
    } else {
      import('@/services/logOverlayService').then(({ hideLogOverlay }) => hideLogOverlay());
    }
  };

  const handleModeChange = (mode: 'fixed' | 'follow') => {
    setLogOverlayMode(mode);
    import('@/services/logOverlayService').then(({ onOverlaySettingsChanged }) =>
      onOverlaySettingsChanged(),
    );
  };

  const handleAnchorChange = (
    anchor: 'left-center' | 'right-top-third' | 'right-bottom-third' | 'top-center',
  ) => {
    setLogOverlayAnchor(anchor);
    import('@/services/logOverlayService').then(({ onOverlaySettingsChanged }) =>
      onOverlaySettingsChanged(),
    );
  };

  const handleZOrderChange = (z: 'always_on_top' | 'above_target') => {
    setLogOverlayZOrder(z);
    import('@/services/logOverlayService').then(({ onOverlaySettingsChanged }) =>
      onOverlaySettingsChanged(),
    );
  };

  /* ---------- 渲染 ---------- */
  // 不 open 时完全不渲染
  if (!open) return null;

  return createPortal(
    // onClick stopPropagation: 阻止 React 合成事件沿组件树冒泡到
    // LogsPanel 标题栏的 onClick={toggleSidePanelExpanded}
    // （React Portal 的事件按组件树而非 DOM 树冒泡）
    <div
      ref={panelRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="w-72 rounded-xl border border-border bg-bg-secondary shadow-2xl p-3"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        // 首次渲染测量尺寸时隐藏，定位完成后显示
        visibility: ready ? 'visible' : 'hidden',
        pointerEvents: ready ? 'auto' : 'none',
      }}
    >
      <div className="text-xs font-medium text-text-secondary mb-2">{t('settings.logOverlay')}</div>
      <p className="text-[10px] text-text-muted mb-3">{t('settings.logOverlayHint')}</p>

      <div className="space-y-3">
        {/* 开关 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">{t('settings.logOverlayEnable')}</span>
          <SwitchButton value={logOverlayEnabled} onChange={handleToggleEnabled} />
        </div>

        {logOverlayEnabled && (
          <>
            {/* 模式 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">{t('settings.logOverlayMode')}</span>
              <select
                value={logOverlayMode}
                onChange={(e) => handleModeChange(e.target.value as 'fixed' | 'follow')}
                className="px-2 py-1 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary"
              >
                <option value="fixed">{t('settings.logOverlayModeFixed')}</option>
                <option value="follow">{t('settings.logOverlayModeFollow')}</option>
              </select>
            </div>

            {logOverlayMode === 'follow' && (
              <>
                {/* 锚点 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">
                    {t('settings.logOverlayAnchor')}
                  </span>
                  <select
                    value={logOverlayAnchor}
                    onChange={(e) =>
                      handleAnchorChange(
                        e.target.value as
                          | 'left-center'
                          | 'right-top-third'
                          | 'right-bottom-third'
                          | 'top-center',
                      )
                    }
                    className="px-2 py-1 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary"
                  >
                    <option value="left-center">{t('settings.logOverlayAnchorLeftCenter')}</option>
                    <option value="right-top-third">{t('settings.logOverlayAnchorRightTop')}</option>
                    <option value="right-bottom-third">
                      {t('settings.logOverlayAnchorRightBottom')}
                    </option>
                    <option value="top-center">{t('settings.logOverlayAnchorTopCenter')}</option>
                  </select>
                </div>

                {/* 跟随窗口 */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-text-secondary">
                    {t('settings.logOverlayFollowWindow')}
                  </span>
                  {isAdbController ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={refreshFollowWindows}
                          disabled={followWindowLoading}
                          className="p-1.5 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors disabled:opacity-50 shrink-0"
                          title={t('settings.logOverlayRefreshWindows')}
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${followWindowLoading ? 'animate-spin' : ''}`}
                          />
                        </button>
                        <span className="text-[10px] text-text-muted">
                          {t('settings.logOverlayRefreshWindows')}
                        </span>
                      </div>
                      <ul className="max-h-32 overflow-y-auto rounded-lg border border-border bg-bg-tertiary divide-y divide-border">
                        <li>
                          <button
                            type="button"
                            onClick={() => selectFollowWindow(null)}
                            className={`w-full px-2 py-1.5 text-left text-sm truncate ${
                              followWindowHandle === null
                                ? 'bg-accent/15 text-accent'
                                : 'text-text-primary hover:bg-bg-hover'
                            }`}
                          >
                            {t('settings.logOverlayFollowWindowNone')}
                          </button>
                        </li>
                        {followWindows.map((w) => (
                          <li key={w.handle}>
                            <button
                              type="button"
                              onClick={() => selectFollowWindow(w.handle)}
                              title={w.window_name}
                              className={`w-full px-2 py-1.5 text-left text-sm truncate ${
                                followWindowHandle === w.handle
                                  ? 'bg-accent/15 text-accent'
                                  : 'text-text-primary hover:bg-bg-hover'
                              }`}
                            >
                              {w.window_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <span className="text-sm text-text-muted">
                      {t('settings.logOverlayFollowWindowAuto')}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* 窗口层级 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                {t('settings.logOverlayZOrder')}
              </span>
              <select
                value={logOverlayZOrder}
                onChange={(e) =>
                  handleZOrderChange(e.target.value as 'always_on_top' | 'above_target')
                }
                className="px-2 py-1 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary"
              >
                <option value="always_on_top">{t('settings.logOverlayZOrderTop')}</option>
                <option value="above_target">{t('settings.logOverlayZOrderAboveTarget')}</option>
              </select>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
