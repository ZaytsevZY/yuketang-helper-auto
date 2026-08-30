import type { RuntimeStatus } from './dto.js';

export const IpcChannel = {
  GetRuntimeStatus: 'runtime:get-status',
} as const;

export interface DesktopApi {
  getRuntimeStatus(): Promise<RuntimeStatus>;
}
