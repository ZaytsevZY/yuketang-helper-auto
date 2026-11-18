import type { ToolPanelsController } from './tool-panels-controller.js';
import {
  WebContentsView,
  type BrowserWindow,
  type WebContents,
  type WebPreferences,
} from 'electron';
import {
  BrowserEnvironment,
  isWebAreaBounds,
  type BrowserState,
  type BrowserTabState,
  type Lesson,
  type WebAreaBounds,
  type ToolPanelAction,
} from '@ykt/contracts';

import {
  environmentForUrl,
  isAllowedYuketangUrl,
  resolveYuketangNavigation,
  targetForEnvironment,
} from './browser-policy.js';

const SESSION_PARTITION = 'persist:yuketang-browser';
const TOOLBAR_HEIGHT = 104;
const NEW_TAB_HOME_URL = 'https://www.yuketang.cn/v2/web/index';

interface BrowserTab {
  id: string;
  view: WebContentsView;
  environment: BrowserEnvironment;
  loading: boolean;
  errorMessage: string | null;
}

export class BrowserController {
  readonly #tabs: BrowserTab[] = [];
  readonly #contentsListeners = new Set<(contents: WebContents) => void>();
  #activeTabId = '';
  #nextTabId = 1;
  #networkCollapsed = true;
  #assistantCollapsed = true;
  #measuredBounds: WebAreaBounds | null = null;
  #destroying = false;
  #panels: ToolPanelsController | undefined;

  constructor(
    private readonly window: BrowserWindow,
    private readonly onStateChanged: (state: BrowserState) => void,
  ) {
    const initialTab = this.createTab(BrowserEnvironment.Standard);
    this.#activeTabId = initialTab.id;
    this.window.contentView.addChildView(initialTab.view);
    this.configurePermissions(initialTab.view.webContents);
    this.applyActiveBounds();
    this.window.on('resize', () => this.refreshLayout());
  }

  attachToolPanels(panels: ToolPanelsController): void {
    this.#panels = panels;
    this.applyActiveBounds();
  }

  controlToolPanel(action: ToolPanelAction): void {
    if (!this.#panels) throw new Error('Tool panels are not available.');
    this.#panels.control(action);
  }

  getState(): BrowserState {
    const active = this.activeTab();
    const activeState = this.tabState(active);
    return {
      tabs: this.#tabs.map((tab) => this.tabState(tab)),
      activeTabId: active.id,
      environment: active.environment,
      url: activeState.url,
      title: activeState.title,
      loading: active.loading,
      canGoBack: active.view.webContents.navigationHistory.canGoBack(),
      canGoForward: active.view.webContents.navigationHistory.canGoForward(),
      errorMessage: active.errorMessage,
      assistantPanelCollapsed: this.#panels
        ? !this.#panels
            .snapshot()
            .some((panel) => panel.id === 'tools' && panel.visible)
        : this.#assistantCollapsed,
      networkLabCollapsed: this.#panels
        ? !this.#panels
            .snapshot()
            .some((panel) => panel.id === 'network' && panel.visible)
        : this.#networkCollapsed,
      ...(this.#panels ? { panels: this.#panels.snapshot() } : {}),
    };
  }

  get webContents(): WebContents {
    return this.activeTab().view.webContents;
  }

  onWebContentsCreated(listener: (contents: WebContents) => void): () => void {
    this.#contentsListeners.add(listener);
    for (const tab of this.#tabs) listener(tab.view.webContents);
    return () => this.#contentsListeners.delete(listener);
  }

  async start(
    environment: BrowserEnvironment = this.activeTab().environment,
  ): Promise<void> {
    await this.selectEnvironment(environment);
  }

  async selectEnvironment(environment: BrowserEnvironment): Promise<void> {
    const tab = this.activeTab();
    tab.environment = environment;
    await this.loadUrl(tab, targetForEnvironment(environment).startUrl);
  }

  async openLesson(
    environment: BrowserEnvironment,
    lessonId: string,
    status: Lesson['status'] = 'active',
  ): Promise<void> {
    const target = targetForEnvironment(environment);
    const pathname =
      status === 'ended'
        ? `/m/v2/lesson/student/${encodeURIComponent(lessonId)}/overview`
        : `/lesson/fullscreen/v3/${encodeURIComponent(lessonId)}`;
    const url = new URL(pathname, target.startUrl).toString();
    const existing = this.#tabs.find(
      (tab) => tab.view.webContents.getURL() === url,
    );
    if (existing) {
      this.activateTab(existing.id);
      existing.view.webContents.reload();
      return;
    }

    const tab = this.createTab(environment);
    this.activateTab(tab.id);
    await this.loadUrl(tab, url);
  }

  back(): void {
    const history = this.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  }

  forward(): void {
    const history = this.webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
  }

  reload(): void {
    this.webContents.reload();
  }

  async captureCurrentPage(): Promise<string> {
    const image = await this.webContents.capturePage();
    if (image.isEmpty())
      throw new Error('当前网页截图为空，请刷新页面后重试。');
    const dataUrl = image.toDataURL();
    if (dataUrl.length > 16 * 1024 * 1024) {
      throw new Error('当前网页截图超过 16MB，请缩小窗口后重试。');
    }
    return dataUrl;
  }

  async home(): Promise<void> {
    const tab = this.activeTab();
    await this.loadUrl(tab, targetForEnvironment(tab.environment).startUrl);
  }

  async navigate(value: string): Promise<void> {
    const tab = this.activeTab();
    const currentUrl =
      tab.view.webContents.getURL() ||
      targetForEnvironment(tab.environment).startUrl;
    await this.loadUrl(tab, resolveYuketangNavigation(value, currentUrl));
  }

  async newTab(): Promise<void> {
    const tab = this.createTab(BrowserEnvironment.Standard);
    this.activateTab(tab.id);
    await this.loadUrl(tab, NEW_TAB_HOME_URL);
  }

  activateTab(tabId: string): void {
    if (tabId === this.#activeTabId) return;
    const next = this.#tabs.find((tab) => tab.id === tabId);
    if (!next) throw new Error('Browser tab was not found.');

    const current = this.#tabs.find((tab) => tab.id === this.#activeTabId);
    if (current) this.window.contentView.removeChildView(current.view);
    this.#activeTabId = next.id;
    this.window.contentView.addChildView(next.view);
    this.applyActiveBounds();
    this.#panels?.raiseAll();
    next.view.webContents.focus();
    this.emitState();
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.#tabs.find((item) => item.id === tabId);
    if (!tab) return;
    this.removeTab(tab, true);
  }

  setNetworkLabCollapsed(collapsed: boolean): void {
    this.#networkCollapsed = collapsed;
    this.#panels?.control({
      action: collapsed ? 'close' : 'open',
      id: 'network',
    });
    this.emitState();
  }

  setAssistantPanelCollapsed(collapsed: boolean): void {
    this.#assistantCollapsed = collapsed;
    this.#panels?.control({
      action: collapsed ? 'close' : 'open',
      id: 'tools',
    });
    this.emitState();
  }

  /**
   * Rect measured by the renderer from the actual web-area placeholder
   * (ResizeObserver). Once received, it replaces the main-process constant
   * math so the native view always tracks the rendered layout exactly.
   */
  setWebAreaBounds(bounds: WebAreaBounds): void {
    if (!isWebAreaBounds(bounds)) {
      throw new Error('Invalid web area bounds.');
    }
    this.#measuredBounds = bounds;
    this.refreshLayout();
  }

  refreshLayout(): void {
    this.applyActiveBounds();
    this.emitState();
  }

  destroy(): void {
    this.#destroying = true;
    this.#panels?.destroy();
    this.#panels = undefined;
    for (const tab of this.#tabs) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.#tabs.length = 0;
    this.#contentsListeners.clear();
  }

  private createTab(
    environment: BrowserEnvironment,
    inheritedPreferences: WebPreferences = {},
    adoptedContents?: WebContents,
  ): BrowserTab {
    const view = adoptedContents
      ? new WebContentsView({ webContents: adoptedContents })
      : new WebContentsView({
          webPreferences: secureWebPreferences(inheritedPreferences),
        });
    const tab: BrowserTab = {
      id: `tab-${this.#nextTabId++}`,
      view,
      environment,
      loading: false,
      errorMessage: null,
    };
    this.#tabs.push(tab);
    this.configureNavigation(tab);
    this.configureStateEvents(tab);
    for (const listener of this.#contentsListeners) listener(view.webContents);
    return tab;
  }

  private configurePermissions(contents: WebContents): void {
    const browserSession = contents.session;
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
  }

  private configureNavigation(tab: BrowserTab): void {
    const contents = tab.view.webContents;

    contents.on('will-navigate', (event) => {
      if (!isAllowedYuketangUrl(event.url)) {
        event.preventDefault();
        tab.errorMessage = '已阻止跳转到雨课堂域名之外的页面';
        this.emitState();
      }
    });

    contents.on('will-redirect', (event) => {
      if (!isAllowedYuketangUrl(event.url)) {
        event.preventDefault();
        tab.errorMessage = '已阻止不受信任的重定向';
        this.emitState();
      }
    });

    contents.setWindowOpenHandler((details) => {
      const opensBlankPage = details.url === 'about:blank';
      if (!opensBlankPage && !isAllowedYuketangUrl(details.url)) {
        tab.errorMessage = '已阻止外部新窗口';
        this.emitState();
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const adoptedContents = (
            options as typeof options & { webContents?: WebContents }
          ).webContents;
          const child = this.createTab(
            environmentForUrl(details.url) ?? tab.environment,
            options.webPreferences,
            adoptedContents,
          );
          this.activateTab(child.id);
          if (!adoptedContents) void this.loadUrl(child, details.url);
          return child.view.webContents;
        },
      };
    });
  }

  private configureStateEvents(tab: BrowserTab): void {
    const contents = tab.view.webContents;

    contents.on('did-start-loading', () => {
      tab.loading = true;
      tab.errorMessage = null;
      this.emitState();
    });
    contents.on('did-stop-loading', () => {
      tab.loading = false;
      this.updateEnvironment(tab);
      this.emitState();
    });
    contents.on('did-navigate', () => {
      this.updateEnvironment(tab);
      this.emitState();
    });
    contents.on('did-navigate-in-page', () => {
      this.updateEnvironment(tab);
      this.emitState();
    });
    contents.on('page-title-updated', () => this.emitState());
    contents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) {
          tab.loading = false;
          tab.errorMessage = errorDescription;
          this.emitState();
        }
      },
    );
    contents.on('render-process-gone', () => {
      tab.loading = false;
      tab.errorMessage = '雨课堂页面进程已退出，请刷新重试';
      this.emitState();
    });
    contents.once('destroyed', () => {
      if (!this.#destroying) this.removeTab(tab, false);
    });
  }

  private async loadUrl(tab: BrowserTab, url: string): Promise<void> {
    if (!isAllowedYuketangUrl(url)) {
      throw new Error('Navigation is not allowed.');
    }

    tab.loading = true;
    tab.errorMessage = null;
    this.emitState();
    try {
      await tab.view.webContents.loadURL(url);
    } catch (error: unknown) {
      if (isNavigationAborted(error)) {
        tab.loading = tab.view.webContents.isLoading();
        this.updateEnvironment(tab);
        this.emitState();
        return;
      }
      tab.loading = false;
      tab.errorMessage =
        error instanceof Error ? error.message : '页面加载失败';
      this.emitState();
    }
  }

  private removeTab(tab: BrowserTab, closeContents: boolean): void {
    const index = this.#tabs.indexOf(tab);
    if (index < 0) return;
    const wasActive = tab.id === this.#activeTabId;
    if (wasActive) this.window.contentView.removeChildView(tab.view);
    this.#tabs.splice(index, 1);
    if (closeContents && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }

    if (!wasActive) {
      this.emitState();
      return;
    }
    if (this.#tabs.length === 0) {
      const replacement = this.createTab(BrowserEnvironment.Standard);
      this.#activeTabId = replacement.id;
      this.window.contentView.addChildView(replacement.view);
      this.#panels?.raiseAll();
      this.applyActiveBounds();
      void this.loadUrl(replacement, NEW_TAB_HOME_URL);
      return;
    }
    const next = this.#tabs[Math.min(index, this.#tabs.length - 1)];
    if (!next) return;
    this.#activeTabId = next.id;
    this.window.contentView.addChildView(next.view);
    this.applyActiveBounds();
    this.#panels?.raiseAll();
    next.view.webContents.focus();
    this.emitState();
  }

  private activeTab(): BrowserTab {
    const tab = this.#tabs.find((item) => item.id === this.#activeTabId);
    if (!tab) throw new Error('Browser has no active tab.');
    return tab;
  }

  private tabState(tab: BrowserTab): BrowserTabState {
    const contents = tab.view.webContents;
    return {
      id: tab.id,
      environment: tab.environment,
      url: contents.getURL(),
      title: contents.getTitle() || targetForEnvironment(tab.environment).label,
      loading: tab.loading,
    };
  }

  private updateEnvironment(tab: BrowserTab): void {
    tab.environment =
      environmentForUrl(tab.view.webContents.getURL()) ?? tab.environment;
  }

  private applyActiveBounds(): void {
    if (this.#tabs.length === 0) return;
    const { width, height } = this.window.getContentBounds();
    const measured = this.#measuredBounds ?? this.defaultBounds();
    const bounds = {
      x: Math.min(measured.x, width),
      y: Math.min(measured.y, height),
      width: Math.max(0, Math.min(measured.width, width - measured.x)),
      height: Math.max(0, Math.min(measured.height, height - measured.y)),
    };
    const view = this.activeTab().view;
    const visible = bounds.width > 0 && bounds.height > 0;
    view.setVisible(visible);
    view.setBounds(bounds);
    this.#panels?.layout(bounds);
  }

  private defaultBounds(): WebAreaBounds {
    const { width, height } = this.window.getContentBounds();
    return {
      x: 0,
      y: TOOLBAR_HEIGHT,
      width: Math.max(0, width),
      height: Math.max(0, height - TOOLBAR_HEIGHT),
    };
  }

  private emitState(): void {
    if (this.#tabs.length > 0) this.onStateChanged(this.getState());
  }
}

function secureWebPreferences(
  inheritedPreferences: WebPreferences,
): WebPreferences {
  const preferences = { ...inheritedPreferences };
  delete preferences.preload;
  delete preferences.session;
  return {
    ...preferences,
    partition: SESSION_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  };
}

function isNavigationAborted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string | number }).code;
  return (
    code === 'ERR_ABORTED' ||
    code === -3 ||
    /ERR_ABORTED|\(-3\)/i.test(error.message)
  );
}
