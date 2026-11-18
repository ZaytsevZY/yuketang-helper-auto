/** Stable IDs are also the allowlist for trusted local panel routes. */
export const ToolPanelIds = [
  'tools',
  'classroom',
  'assignments',
  'courses',
  'problems',
  'ai',
  'courseware',
  'profiles',
  'settings',
  'simulator',
  'diagnostics',
  'network',
] as const;
export type ToolPanelId = (typeof ToolPanelIds)[number];
export type WorkspacePage = Exclude<ToolPanelId, 'tools' | 'network'>;
export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ToolPanelState {
  id: ToolPanelId;
  bounds: PanelBounds;
  visible: boolean;
  maximized: boolean;
  focused: boolean;
  error: string | null;
}
export type ToolPanelAction =
  | {
      action: 'open' | 'close' | 'focus' | 'maximize' | 'reset';
      id: ToolPanelId;
    }
  | { action: 'bounds'; id: ToolPanelId; bounds: PanelBounds }
  | { action: 'arrange' }
  | { action: 'hide-all' };
export function isToolPanelId(value: unknown): value is ToolPanelId {
  return (
    typeof value === 'string' &&
    (ToolPanelIds as readonly string[]).includes(value)
  );
}
export function isToolPanelAction(value: unknown): value is ToolPanelAction {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (input.action === 'arrange' || input.action === 'hide-all') return true;
  if (!isToolPanelId(input.id)) return false;
  if (input.action === 'bounds') {
    if (!input.bounds || typeof input.bounds !== 'object') return false;
    const bounds = input.bounds as Record<string, unknown>;
    return (
      ['x', 'y', 'width', 'height'].every(
        (key) =>
          Number.isSafeInteger(bounds[key]) &&
          Math.abs(bounds[key] as number) <= 100_000,
      ) &&
      (bounds.width as number) > 0 &&
      (bounds.height as number) > 0
    );
  }
  return ['open', 'close', 'focus', 'maximize', 'reset'].includes(
    String(input.action),
  );
}
