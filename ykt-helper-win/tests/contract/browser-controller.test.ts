import { EventEmitter } from 'node:events';

import { BrowserEnvironment } from '@ykt/contracts';
import { describe, expect, it, vi } from 'vitest';

class FakeContents extends EventEmitter {
  static nextId = 1;
  readonly id = FakeContents.nextId++;
  readonly navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  readonly session = {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  };
  url = '';
  destroyed = false;
  windowOpenHandler: ((details: { url: string }) => unknown) | undefined;

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.url ? new URL(this.url).hostname : '';
  }

  async loadURL(url: string): Promise<void> {
    this.emit('did-start-loading');
    this.url = url;
    this.emit('did-navigate');
    this.emit('did-stop-loading');
  }

  setWindowOpenHandler(handler: (details: { url: string }) => unknown): void {
    this.windowOpenHandler = handler;
  }

  open(url: string): FakeContents {
    const result = this.windowOpenHandler?.({ url }) as {
      action: string;
      createWindow?: (options: {
        webPreferences: object;
        webContents: FakeContents;
      }) => FakeContents;
    };
    if (result.action !== 'allow' || !result.createWindow) {
      throw new Error('Window was blocked.');
    }
    const suppliedContents = new FakeContents();
    const child = result.createWindow({
      webPreferences: {},
      webContents: suppliedContents,
    });
    if (child !== suppliedContents) {
      throw new Error(
        'Invalid webContents. Created window should be connected to webContents passed with options object.',
      );
    }
    void child.loadURL(url);
    return child;
  }

  reload(): void {}
  focus(): void {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  close(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

class FakeView {
  readonly webContents: FakeContents;

  constructor(options?: { webContents?: FakeContents }) {
    this.webContents = options?.webContents ?? new FakeContents();
  }

  setBounds(): void {}
}

vi.doMock('electron', () => ({ WebContentsView: FakeView }));

describe('embedded browser tabs', () => {
  it('keeps the opener when Yuketang creates a new page', async () => {
    const { BrowserController } =
      await import('../../apps/desktop/main/browser-controller.js');
    const children: FakeView[] = [];
    const window = {
      contentView: {
        addChildView: (view: FakeView) => children.push(view),
        removeChildView: (view: FakeView) => {
          const index = children.indexOf(view);
          if (index >= 0) children.splice(index, 1);
        },
      },
      getContentBounds: () => ({ width: 1180, height: 800 }),
      on: vi.fn(),
    };
    const controller = new BrowserController(window as never, vi.fn());
    await controller.start(BrowserEnvironment.Pro);
    const original = controller.getState();

    const lessonUrl = 'https://pro.yuketang.cn/lesson/fullscreen/v3/7';
    (controller.webContents as unknown as FakeContents).open(lessonUrl);

    const opened = controller.getState();
    expect(opened.tabs).toHaveLength(2);
    expect(opened.url).toBe(lessonUrl);
    expect(children).toHaveLength(1);

    controller.activateTab(original.activeTabId);
    expect(controller.getState().url).toBe('https://pro.yuketang.cn/web');

    await controller.closeTab(opened.activeTabId);
    expect(controller.getState().tabs).toHaveLength(1);
  });

  it('adopts a blank window before Yuketang assigns its destination', async () => {
    const { BrowserController } =
      await import('../../apps/desktop/main/browser-controller.js');
    const window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      getContentBounds: () => ({ width: 1180, height: 800 }),
      on: vi.fn(),
    };
    const controller = new BrowserController(window as never, vi.fn());
    await controller.start(BrowserEnvironment.Pro);

    const child = (controller.webContents as unknown as FakeContents).open(
      'about:blank',
    );
    await child.loadURL('https://pro.yuketang.cn/lesson/fullscreen/v3/7');

    expect(controller.getState()).toMatchObject({
      url: 'https://pro.yuketang.cn/lesson/fullscreen/v3/7',
      tabs: [{}, {}],
    });
    expect(() => child.open('https://example.com')).toThrow(
      'Window was blocked',
    );
  });

  it('opens ended lessons on the classroom overview page', async () => {
    const { BrowserController } =
      await import('../../apps/desktop/main/browser-controller.js');
    const window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      getContentBounds: () => ({ width: 1180, height: 800 }),
      on: vi.fn(),
    };
    const controller = new BrowserController(window as never, vi.fn());
    await controller.start(BrowserEnvironment.Pro);

    await controller.openLesson(
      BrowserEnvironment.Pro,
      '1764118559357124352',
      'ended',
    );

    expect(controller.getState().url).toBe(
      'https://pro.yuketang.cn/m/v2/lesson/student/1764118559357124352/overview',
    );
  });
});
