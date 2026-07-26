import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalFocusTrapOptions {
  active?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0,
  );
}

/** 为模态框提供 Escape 关闭、Tab 循环、初始焦点和关闭后的焦点恢复。 */
export function useModalFocusTrap({
  active = true,
  containerRef,
  initialFocusRef,
  onEscape,
}: ModalFocusTrapOptions): void {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const initialFocus =
      initialFocusRef?.current ?? (container && getFocusableElements(container)[0]);
    initialFocus?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const focusableElements = getFocusableElements(currentContainer);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const focused = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!focused || focused === first || !currentContainer.contains(focused)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!focused || focused === last || !currentContainer.contains(focused)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}

/** 将模态框脱离局部 transform、overflow 和 stacking context。 */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
