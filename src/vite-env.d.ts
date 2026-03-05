/// <reference types="vite/client" />

declare const __MXU_VERSION__: string;

declare module 'driver.js' {
  export const driver: (...args: any[]) => any;
}

declare module 'driver.js/dist/driver.css';
