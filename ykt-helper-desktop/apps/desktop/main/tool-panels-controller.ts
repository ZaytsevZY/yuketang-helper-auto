import type { BrowserWindow, WebContentsView } from 'electron';
import type {
  PanelBounds,
  ToolPanelAction,
  ToolPanelId,
  ToolPanelState,
} from '@ykt/contracts';

interface Entry {
  view: WebContentsView;
  state: ToolPanelState;
  restore: PanelBounds | undefined;
}

function launcherHeight(width: number): number {
  // Six 78px grid columns, five 4px gaps, 24px padding and a 2px border.
  // Below that width the last tools flow into a third row.
  return width >= 514 ? 240 : 280;
}

/** One cached native view per tool: uncovered webpage pixels retain native hit testing. */
export class ToolPanelsController {
  readonly #entries = new Map<ToolPanelId, Entry>();
  #order: ToolPanelId[] = [];
  #area: PanelBounds = { x: 0, y: 104, width: 1180, height: 696 };
  #destroyed = false;
  constructor(
    private readonly window: BrowserWindow,
    private readonly createView: (id: ToolPanelId) => WebContentsView,
    private readonly changed: () => void,
  ) {}

  snapshot(): ToolPanelState[] {
    return this.#order
      .map((id) => this.#entries.get(id)!)
      .map(({ state }) => ({ ...state, bounds: { ...state.bounds } }));
  }

  /** The launcher also owns the sole background automation instance. */
  prepare(): void {
    this.ensure('tools');
  }

  control(command: ToolPanelAction): void {
    if (this.#destroyed) return;
    if (command.action === 'hide-all') {
      for (const entry of this.#entries.values()) {
        entry.state.visible = false;
        entry.state.focused = false;
      }
      this.apply();
      this.window.webContents.focus();
    } else if (command.action === 'arrange') {
      this.arrange();
    } else {
      const entry =
        command.action === 'open'
          ? this.ensure(command.id)
          : this.#entries.get(command.id);
      if (!entry) return;
      switch (command.action) {
        case 'open':
          entry.state.visible = true;
          this.focus(command.id);
          break;
        case 'focus':
          if (entry.state.visible) this.focus(command.id);
          break;
        case 'close': {
          const hadFocus = entry.state.focused;
          entry.state.visible = false;
          entry.state.focused = false;
          if (hadFocus) {
            const next = [...this.#order]
              .reverse()
              .find((id) => this.#entries.get(id)?.state.visible);
            if (next) this.focus(next);
            else this.window.webContents.focus();
          }
          break;
        }
        case 'bounds':
          entry.state.maximized = false;
          entry.restore = undefined;
          entry.state.bounds = this.clamp(command.bounds);
          break;
        case 'maximize':
          if (entry.state.maximized) {
            entry.state.bounds = this.clamp(
              entry.restore ?? this.defaultBounds(command.id),
            );
            entry.restore = undefined;
            entry.state.maximized = false;
          } else {
            entry.restore = { ...entry.state.bounds };
            entry.state.maximized = true;
            entry.state.bounds = this.available();
          }
          this.focus(command.id);
          break;
        case 'reset':
          entry.state.bounds = this.defaultBounds(command.id);
          entry.state.maximized = false;
          entry.restore = undefined;
          break;
      }
      this.apply();
    }
    this.changed();
  }

  layout(area: PanelBounds): void {
    this.#area = area;
    for (const entry of this.#entries.values()) {
      entry.state.bounds = entry.state.maximized
        ? this.available()
        : this.clamp(entry.state.bounds);
    }
    this.apply();
  }

  raiseAll(): void {
    for (const id of this.#order) {
      const entry = this.#entries.get(id)!;
      this.window.contentView.addChildView(entry.view);
    }
  }

  failed(id: ToolPanelId): void {
    if (this.#destroyed) return;
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.state.error = '面板加载失败，请重新打开';
    entry.state.visible = false;
    entry.state.focused = false;
    entry.view.setVisible(false);
    this.window.webContents.focus();
    this.changed();
  }

  destroy(): void {
    this.#destroyed = true;
    for (const { view } of this.#entries.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.#entries.clear();
    this.#order = [];
  }

  private ensure(id: ToolPanelId): Entry {
    const cached = this.#entries.get(id);
    if (cached && !cached.view.webContents.isDestroyed() && !cached.state.error)
      return cached;
    if (cached) {
      this.window.contentView.removeChildView(cached.view);
      if (!cached.view.webContents.isDestroyed())
        cached.view.webContents.close();
      this.#entries.delete(id);
      this.#order = this.#order.filter((key) => key !== id);
    }
    const view = this.createView(id);
    const entry: Entry = {
      view,
      state: {
        id,
        bounds: cached?.state.bounds ?? this.defaultBounds(id),
        visible: false,
        maximized: false,
        focused: false,
        error: null,
      },
      restore: undefined,
    };
    this.#entries.set(id, entry);
    this.#order.push(id);
    this.window.contentView.addChildView(view);
    view.setBounds(entry.state.bounds);
    view.setVisible(false);
    return entry;
  }

  private available(): PanelBounds {
    const margin = Math.min(
      12,
      Math.floor(Math.min(this.#area.width, this.#area.height) / 4),
    );
    return {
      x: this.#area.x + margin,
      y: this.#area.y + margin,
      width: Math.max(1, this.#area.width - margin * 2),
      height: Math.max(1, this.#area.height - margin * 2),
    };
  }
  private clamp(bounds: PanelBounds): PanelBounds {
    const area = this.available();
    const width = Math.min(area.width, Math.max(360, Math.round(bounds.width)));
    const height = Math.min(
      area.height,
      Math.max(240, Math.round(bounds.height)),
    );
    return {
      width,
      height,
      x: Math.max(
        area.x,
        Math.min(Math.round(bounds.x), area.x + area.width - width),
      ),
      y: Math.max(
        area.y,
        Math.min(Math.round(bounds.y), area.y + area.height - height),
      ),
    };
  }
  private defaultBounds(id: ToolPanelId): PanelBounds {
    const area = this.available();
    const offset = (this.#entries.size % 5) * 28;
    const width = id === 'network' ? 640 : 560;
    return this.clamp({
      x: area.x + area.width - 560 - offset,
      y: area.y + offset,
      width,
      height:
        id === 'tools' ? launcherHeight(Math.min(width, area.width)) : 640,
    });
  }
  private focus(id: ToolPanelId): void {
    for (const entry of this.#entries.values())
      entry.state.focused = entry.state.id === id;
    this.#order = [...this.#order.filter((key) => key !== id), id];
    const entry = this.#entries.get(id)!;
    this.window.contentView.addChildView(entry.view);
    entry.view.setVisible(entry.state.visible);
    entry.view.webContents.focus();
  }
  private apply(): void {
    for (const { view, state } of this.#entries.values()) {
      view.setBounds(state.bounds);
      view.setVisible(
        state.visible && this.#area.width > 0 && this.#area.height > 0,
      );
    }
  }
  private arrange(): void {
    const visible = this.#order
      .map((id) => this.#entries.get(id)!)
      .filter((entry) => entry.state.visible);
    if (!visible.length) return;
    const area = this.available();
    const columns = Math.max(
      1,
      Math.min(visible.length, Math.floor((area.width + 12) / 372)),
    );
    const rows = Math.ceil(visible.length / columns);
    const width = (area.width - (columns - 1) * 12) / columns;
    const height = (area.height - (rows - 1) * 12) / rows;
    visible.forEach((entry, index) => {
      // Cascade if tiling would make content unreadable; every panel remains recoverable.
      const cascade = height < 240;
      const panelWidth = cascade ? Math.min(560, area.width) : width;
      const panelHeight = cascade
        ? Math.min(440, area.height - Math.min(112, index * 28))
        : height;
      entry.state.bounds = this.clamp({
        x:
          area.x +
          (cascade ? (index % 5) * 28 : (index % columns) * (width + 12)),
        y:
          area.y +
          (cascade
            ? (index % 5) * 28
            : Math.floor(index / columns) * (height + 12)),
        width: panelWidth,
        height:
          entry.state.id === 'tools'
            ? Math.min(panelHeight, launcherHeight(Math.round(panelWidth)))
            : panelHeight,
      });
      entry.state.maximized = false;
      entry.restore = undefined;
    });
    this.apply();
  }
}
