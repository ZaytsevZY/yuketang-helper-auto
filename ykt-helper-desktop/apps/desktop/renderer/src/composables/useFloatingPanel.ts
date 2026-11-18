import { computed, onScopeDispose, ref, type Ref } from 'vue';
import type {
  PanelBounds,
  ToolPanelAction,
  ToolPanelId,
  ToolPanelState,
} from '@ykt/contracts';

/** Screen coordinates stay stable while Electron moves the view under the pointer. */
export function useFloatingPanel(
  id: ToolPanelId,
  state: Readonly<Ref<ToolPanelState | undefined>>,
  control: (command: ToolPanelAction) => Promise<void>,
) {
  const interaction = ref<'move' | 'resize' | null>(null);
  const error = ref('');
  let gesture:
    | {
        bounds: PanelBounds;
        x: number;
        y: number;
        target: HTMLElement;
        pointer: number;
      }
    | undefined;
  let pending: PanelBounds | undefined;
  let frame: number | undefined;
  let lastRequest: Promise<void> = Promise.resolve();
  const maximized = computed(() => state.value?.maximized ?? false);

  async function run(command: ToolPanelAction): Promise<void> {
    try {
      error.value = '';
      await control(command);
    } catch {
      error.value = '无法调整面板，请重试。';
    }
  }
  function flush(): void {
    frame = undefined;
    const bounds = pending;
    pending = undefined;
    if (!bounds) return;
    // Preserve ordering when the main process is busy; never send stale final bounds last.
    lastRequest = lastRequest.then(() => run({ action: 'bounds', id, bounds }));
  }
  function start(event: PointerEvent, mode: 'move' | 'resize'): void {
    if (event.button !== 0 || !state.value || maximized.value) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    gesture = {
      bounds: { ...state.value.bounds },
      x: event.screenX,
      y: event.screenY,
      target,
      pointer: event.pointerId,
    };
    interaction.value = mode;
    target.setPointerCapture(event.pointerId);
    if (!state.value.focused) void run({ action: 'focus', id });
  }
  function move(event: PointerEvent): void {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const dx = Math.round(event.screenX - gesture.x);
    const dy = Math.round(event.screenY - gesture.y);
    pending =
      interaction.value === 'move'
        ? {
            ...gesture.bounds,
            x: gesture.bounds.x + dx,
            y: gesture.bounds.y + dy,
          }
        : {
            ...gesture.bounds,
            width: Math.max(1, gesture.bounds.width + dx),
            height: Math.max(1, gesture.bounds.height + dy),
          };
    if (frame === undefined) frame = requestAnimationFrame(flush);
  }
  function stop(event?: PointerEvent): void {
    if (event && gesture?.pointer !== event.pointerId) return;
    if (frame !== undefined) cancelAnimationFrame(frame);
    flush();
    const previous = gesture;
    gesture = undefined;
    interaction.value = null;
    if (previous?.target.hasPointerCapture(previous.pointer))
      previous.target.releasePointerCapture(previous.pointer);
  }
  function keyboard(event: KeyboardEvent, mode: 'move' | 'resize'): void {
    if (!state.value || maximized.value) return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    const [dx, dy] = direction.map((value) => value * step) as [number, number];
    const bounds = state.value.bounds;
    void run({
      action: 'bounds',
      id,
      bounds:
        mode === 'move'
          ? { ...bounds, x: bounds.x + dx, y: bounds.y + dy }
          : {
              ...bounds,
              width: Math.max(1, bounds.width + dx),
              height: Math.max(1, bounds.height + dy),
            },
    });
  }
  onScopeDispose(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    pending = undefined;
    frame = undefined;
    const previous = gesture;
    gesture = undefined;
    if (previous?.target.hasPointerCapture(previous.pointer))
      previous.target.releasePointerCapture(previous.pointer);
  });
  return { interaction, error, maximized, start, move, stop, keyboard, run };
}
