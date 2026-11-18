// @vitest-environment jsdom
import { effectScope, ref } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolPanelState } from '@ykt/contracts';
import { useFloatingPanel } from '../../apps/desktop/renderer/src/composables/useFloatingPanel';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++nextFrame, fn);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const state = ref<ToolPanelState>({
    id: 'settings',
    visible: true,
    focused: true,
    maximized: false,
    error: null,
    bounds: { x: 100, y: 120, width: 500, height: 400 },
  });
  const control = vi.fn(async () => {});
  const scope = effectScope();
  const panel = scope.run(() => useFloatingPanel('settings', state, control))!;
  let captured = false;
  const target = {
    setPointerCapture: vi.fn(() => {
      captured = true;
    }),
    hasPointerCapture: () => captured,
    releasePointerCapture: vi.fn(() => {
      captured = false;
    }),
  };
  const event = (x: number, y: number) =>
    ({
      button: 0,
      screenX: x,
      screenY: y,
      pointerId: 1,
      currentTarget: target,
      preventDefault: vi.fn(),
    }) as unknown as PointerEvent;
  async function flush() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(0));
    await Promise.resolve();
    await Promise.resolve();
  }
  return { panel, scope, control, event, target, frames, flush, state };
}

it('uses stable screen deltas and batches movement to one update per animation frame', async () => {
  const f = fixture();
  f.panel.start(f.event(700, 300), 'move');
  f.panel.move(f.event(710, 320));
  f.panel.move(f.event(760, 340));
  expect(f.frames.size).toBe(1);
  await f.flush();
  expect(f.control).toHaveBeenCalledExactlyOnceWith({
    action: 'bounds',
    id: 'settings',
    bounds: { x: 160, y: 160, width: 500, height: 400 },
  });
  f.panel.stop(f.event(760, 340));
  expect(f.target.releasePointerCapture).toHaveBeenCalledOnce();
  f.scope.stop();
});

it('flushes the last resize on release and cleans up canceled gestures', async () => {
  const f = fixture();
  f.panel.start(f.event(700, 300), 'resize');
  f.panel.move(f.event(740, 350));
  f.panel.stop(f.event(740, 350));
  await f.flush();
  expect(f.control).toHaveBeenLastCalledWith({
    action: 'bounds',
    id: 'settings',
    bounds: { x: 100, y: 120, width: 540, height: 450 },
  });
  f.panel.start(f.event(700, 300), 'move');
  f.panel.move(f.event(800, 400));
  f.scope.stop();
  expect(f.frames.size).toBe(0);
  expect(f.target.releasePointerCapture).toHaveBeenCalledTimes(2);
});

it('supports precise keyboard movement and resizing and protects maximized geometry', async () => {
  const f = fixture();
  f.panel.keyboard(new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 'move');
  f.panel.keyboard(
    new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }),
    'resize',
  );
  expect(f.control).toHaveBeenCalledWith({
    action: 'bounds',
    id: 'settings',
    bounds: { x: 90, y: 120, width: 500, height: 400 },
  });
  expect(f.control).toHaveBeenCalledWith({
    action: 'bounds',
    id: 'settings',
    bounds: { x: 100, y: 120, width: 500, height: 440 },
  });
  f.state.value.maximized = true;
  f.panel.start(f.event(700, 300), 'move');
  expect(f.target.setPointerCapture).not.toHaveBeenCalled();
  f.scope.stop();
});
