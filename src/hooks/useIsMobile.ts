import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * 检测当前设备是否为移动端（竖屏/窄屏），断点为 768px。
 * 响应窗口尺寸变化。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
