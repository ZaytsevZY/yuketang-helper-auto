/// <reference types="vite/client" />

import type { DesktopApi } from '@ykt/contracts';

declare global {
  interface Window {
    readonly yuketang: DesktopApi;
  }
}

export {};
