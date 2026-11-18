import { describe, expect, it, vi } from 'vitest';
import {
  isToolPanelAction,
  type ToolPanelId,
  type PanelBounds,
} from '@ykt/contracts';
import { ToolPanelsController } from '../../apps/desktop/main/tool-panels-controller.js';

function fixture() {
  const children: ReturnType<typeof makeView>[] = [];
  const views = new Map<ToolPanelId, ReturnType<typeof makeView>>();
  function makeView() {
    let destroyed = false;
    return {
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => destroyed,
        close: vi.fn(() => {
          destroyed = true;
        }),
      },
    };
  }
  const factory = vi.fn((id: ToolPanelId) => {
    const view = makeView();
    views.set(id, view);
    return view as never;
  });
  const window = {
    webContents: { focus: vi.fn() },
    contentView: {
      addChildView(view: ReturnType<typeof makeView>) {
        const i = children.indexOf(view);
        if (i >= 0) children.splice(i, 1);
        children.push(view);
      },
      removeChildView(view: ReturnType<typeof makeView>) {
        const i = children.indexOf(view);
        if (i >= 0) children.splice(i, 1);
      },
    },
  };
  const changed = vi.fn();
  const manager = new ToolPanelsController(window as never, factory, changed);
  manager.layout({ x: 0, y: 104, width: 1180, height: 696 });
  const state = (id: ToolPanelId) =>
    manager.snapshot().find((item) => item.id === id)!;
  return { manager, views, children, factory, window, changed, state };
}

describe('independent floating tools', () => {
  it('opens several tools independently and reuses closed views to preserve local drafts', () => {
    const f = fixture();
    f.manager.prepare();
    expect(f.state('tools').visible).toBe(false);
    f.manager.control({ action: 'open', id: 'settings' });
    f.manager.control({ action: 'open', id: 'network' });
    expect(f.state('settings').visible).toBe(true);
    expect(f.state('network').visible).toBe(true);
    const settings = f.views.get('settings');
    f.manager.control({ action: 'close', id: 'settings' });
    expect(f.state('network').visible).toBe(true);
    expect(settings?.webContents.close).not.toHaveBeenCalled();
    f.manager.control({ action: 'open', id: 'settings' });
    expect(f.views.get('settings')).toBe(settings);
    expect(f.factory).toHaveBeenCalledTimes(3);
    f.manager.control({ action: 'close', id: 'ai' });
    expect(f.factory).toHaveBeenCalledTimes(3);
  });
  it('raises the clicked panel and restores focus to the next visible panel on close', () => {
    const f = fixture();
    f.manager.control({ action: 'open', id: 'settings' });
    f.manager.control({ action: 'open', id: 'ai' });
    f.manager.control({ action: 'focus', id: 'settings' });
    expect(f.children.at(-1)).toBe(f.views.get('settings'));
    expect(f.state('settings').focused).toBe(true);
    f.manager.control({ action: 'close', id: 'settings' });
    expect(f.state('ai').focused).toBe(true);
    expect(f.children.at(-1)).toBe(f.views.get('ai'));
    f.manager.control({ action: 'close', id: 'ai' });
    expect(f.window.webContents.focus).toHaveBeenCalledOnce();
  });
  it('clamps movement and resizing, including after the host window becomes very small', () => {
    const f = fixture();
    f.manager.control({ action: 'open', id: 'ai' });
    f.manager.control({
      action: 'bounds',
      id: 'ai',
      bounds: { x: -999, y: 9999, width: 20, height: 5000 },
    });
    expect(f.state('ai').bounds).toEqual({
      x: 12,
      y: 116,
      width: 360,
      height: 672,
    });
    f.manager.layout({ x: 0, y: 104, width: 480, height: 296 });
    const bounds = f.state('ai').bounds;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(468);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(388);
    expect(bounds.y).toBeGreaterThanOrEqual(116);
    f.manager.layout({ x: 0, y: 104, width: 160, height: 60 });
    expect(f.state('ai').bounds).toEqual({
      x: 12,
      y: 116,
      width: 136,
      height: 36,
    });
  });
  it('maximizes and restores geometry and resets a moved panel', () => {
    const f = fixture();
    f.manager.control({ action: 'open', id: 'settings' });
    const original = { ...f.state('settings').bounds };
    f.manager.control({ action: 'maximize', id: 'settings' });
    expect(f.state('settings').bounds).toEqual({
      x: 12,
      y: 116,
      width: 1156,
      height: 672,
    });
    f.manager.control({ action: 'maximize', id: 'settings' });
    expect(f.state('settings').bounds).toEqual(original);
    f.manager.control({
      action: 'bounds',
      id: 'settings',
      bounds: { ...original, x: 12, y: 130 },
    });
    f.manager.control({ action: 'reset', id: 'settings' });
    expect(f.state('settings').bounds.x).toBeGreaterThan(12);
  });
  it('opens the launcher at a compact height and keeps it compact after restore, reset and arrange', () => {
    const f = fixture();
    f.manager.prepare();
    f.manager.control({ action: 'open', id: 'tools' });
    const original = f.state('tools').bounds;
    expect(original).toMatchObject({ width: 560, height: 240 });
    f.manager.control({ action: 'maximize', id: 'tools' });
    expect(f.state('tools').bounds.height).toBeGreaterThan(original.height);
    f.manager.control({ action: 'maximize', id: 'tools' });
    expect(f.state('tools').bounds).toEqual(original);
    f.manager.control({ action: 'open', id: 'settings' });
    f.manager.control({ action: 'arrange' });
    expect(f.state('tools').bounds.height).toBe(original.height);
    expect(f.state('settings').bounds.height).toBeGreaterThan(original.height);
    f.manager.layout({ x: 0, y: 104, width: 480, height: 296 });
    f.manager.control({ action: 'reset', id: 'tools' });
    expect(f.state('tools').bounds).toMatchObject({ width: 456, height: 272 });
  });
  it('tiles when space permits, cascades on small screens, and hides without discarding views', () => {
    const f = fixture();
    for (const id of ['settings', 'ai'] as const)
      f.manager.control({ action: 'open', id });
    f.manager.control({ action: 'arrange' });
    const a = f.state('settings').bounds;
    const b = f.state('ai').bounds;
    expect(a.x + a.width).toBeLessThan(b.x);
    f.manager.layout({ x: 0, y: 104, width: 480, height: 296 });
    f.manager.control({ action: 'arrange' });
    for (const { bounds } of f.manager.snapshot()) {
      expect(bounds.width).toBeGreaterThanOrEqual(360);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(388);
    }
    f.manager.control({ action: 'hide-all' });
    expect(f.manager.snapshot().every((item) => !item.visible)).toBe(true);
    for (const view of f.views.values())
      expect(view.webContents.close).not.toHaveBeenCalled();
    f.manager.destroy();
    for (const view of f.views.values())
      expect(view.webContents.close).toHaveBeenCalledOnce();
  });
  it('recreates a failed view only on an explicit reopen', () => {
    const f = fixture();
    f.manager.control({ action: 'open', id: 'settings' });
    const first = f.views.get('settings');
    f.manager.failed('settings');
    expect(f.state('settings').error).toBeTruthy();
    f.manager.control({ action: 'open', id: 'settings' });
    expect(first?.webContents.close).toHaveBeenCalledOnce();
    expect(f.views.get('settings')).not.toBe(first);
    expect(f.state('settings').error).toBeNull();
  });
});

describe('panel IPC validation', () => {
  it('rejects unknown routes and non-finite, fractional, oversized or invalid geometry', () => {
    expect(isToolPanelAction({ action: 'open', id: '../remote' })).toBe(false);
    for (const bounds of [
      { x: NaN, y: 0, width: 400, height: 400 },
      { x: 0.5, y: 0, width: 400, height: 400 },
      { x: 0, y: 0, width: 0, height: 400 },
      { x: 0, y: Infinity, width: 400, height: 400 },
      { x: 200000, y: 0, width: 400, height: 400 },
    ] satisfies PanelBounds[])
      expect(
        isToolPanelAction({ action: 'bounds', id: 'settings', bounds }),
      ).toBe(false);
    expect(
      isToolPanelAction({
        action: 'bounds',
        id: 'settings',
        bounds: { x: -20, y: 40, width: 400, height: 400 },
      }),
    ).toBe(true);
    expect(isToolPanelAction({ action: 'hide-all' })).toBe(true);
  });
});
