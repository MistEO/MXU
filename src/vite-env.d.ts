/// <reference types="vite/client" />

declare const __MXU_VERSION__: string;

declare module 'driver.js' {
  export interface Driver {
    drive: () => void;
    destroy: () => void;
    isActive: () => boolean;
    moveNext: () => void;
  }

  export interface DriverStep {
    element: string;
    popover: {
      title: string;
      description: string;
      side: 'left' | 'right' | 'top' | 'bottom';
      align: 'start' | 'center' | 'end';
      showButtons: Array<'next' | 'close'>;
      nextBtnText?: string;
      doneBtnText?: string;
      onNextClick?: (
        _el: unknown,
        _step: unknown,
        context: {
          driver: Driver;
        },
      ) => void;
    };
  }

  export interface DriverConfig {
    steps: DriverStep[];
    animate: boolean;
    overlayColor: string;
    overlayOpacity: number;
    stagePadding: number;
    stageRadius: number;
    allowClose: boolean;
    popoverClass: string;
    onDestroyed: () => void;
  }

  export function driver(options: DriverConfig): Driver;
}

declare module 'driver.js/dist/driver.css';
