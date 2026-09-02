import {
  WebContentsView,
  type BrowserWindow,
  type WebContents,
} from 'electron';
import { BrowserEnvironment, type BrowserState } from '@ykt/contracts';

import {
  environmentForUrl,
  isAllowedYuketangUrl,
  targetForEnvironment,
} from './browser-policy.js';

const SESSION_PARTITION = 'persist:yuketang-browser';
const TOOLBAR_HEIGHT = 96;
const NETWORK_LAB_EXPANDED_HEIGHT = 300;
const NETWORK_LAB_COLLAPSED_HEIGHT = 43;

export class BrowserController {
  readonly #view: WebContentsView;
  #environment: BrowserEnvironment = BrowserEnvironment.Standard;
  #loading = false;
  #errorMessage: string | null = null;
  #networkLabHeight = NETWORK_LAB_EXPANDED_HEIGHT;

  constructor(
    private readonly window: BrowserWindow,
    private readonly onStateChanged: (state: BrowserState) => void,
  ) {
    this.#view = new WebContentsView({
      webPreferences: {
        partition: SESSION_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    this.window.contentView.addChildView(this.#view);
    this.configurePermissions();
    this.configureNavigation();
    this.configureStateEvents();
    this.resize();
    this.window.on('resize', () => this.resize());
  }

  getState(): BrowserState {
    const contents = this.#view.webContents;
    return {
      environment: this.#environment,
      url: contents.getURL(),
      title:
        contents.getTitle() || targetForEnvironment(this.#environment).label,
      loading: this.#loading,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      errorMessage: this.#errorMessage,
    };
  }

  get webContents(): WebContents {
    return this.#view.webContents;
  }

  async start(): Promise<void> {
    await this.selectEnvironment(this.#environment);
  }

  async selectEnvironment(environment: BrowserEnvironment): Promise<void> {
    this.#environment = environment;
    await this.loadUrl(targetForEnvironment(environment).startUrl);
  }

  back(): void {
    const history = this.#view.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  }

  forward(): void {
    const history = this.#view.webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
  }

  reload(): void {
    this.#view.webContents.reload();
  }

  setNetworkLabCollapsed(collapsed: boolean): void {
    this.#networkLabHeight = collapsed
      ? NETWORK_LAB_COLLAPSED_HEIGHT
      : NETWORK_LAB_EXPANDED_HEIGHT;
    this.resize();
  }

  destroy(): void {
    if (!this.#view.webContents.isDestroyed()) this.#view.webContents.close();
  }

  private configurePermissions(): void {
    const browserSession = this.#view.webContents.session;
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => {
        callback(false);
      },
    );
  }

  private configureNavigation(): void {
    const contents = this.#view.webContents;

    contents.on('will-navigate', (event) => {
      if (!isAllowedYuketangUrl(event.url)) {
        event.preventDefault();
        this.#errorMessage = '已阻止跳转到雨课堂域名之外的页面';
        this.emitState();
      }
    });

    contents.on('will-redirect', (event) => {
      if (!isAllowedYuketangUrl(event.url)) {
        event.preventDefault();
        this.#errorMessage = '已阻止不受信任的重定向';
        this.emitState();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedYuketangUrl(url)) void this.loadUrl(url);
      else {
        this.#errorMessage = '已阻止外部新窗口';
        this.emitState();
      }
      return { action: 'deny' };
    });
  }

  private configureStateEvents(): void {
    const contents = this.#view.webContents;

    contents.on('did-start-loading', () => {
      this.#loading = true;
      this.#errorMessage = null;
      this.emitState();
    });
    contents.on('did-stop-loading', () => {
      this.#loading = false;
      this.updateEnvironment();
      this.emitState();
    });
    contents.on('did-navigate', () => {
      this.updateEnvironment();
      this.emitState();
    });
    contents.on('did-navigate-in-page', () => this.emitState());
    contents.on('page-title-updated', () => this.emitState());
    contents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) {
          this.#loading = false;
          this.#errorMessage = errorDescription;
          this.emitState();
        }
      },
    );
    contents.on('render-process-gone', () => {
      this.#loading = false;
      this.#errorMessage = '雨课堂页面进程已退出，请刷新重试';
      this.emitState();
    });
  }

  private async loadUrl(url: string): Promise<void> {
    if (!isAllowedYuketangUrl(url))
      throw new Error('Navigation is not allowed.');

    this.#loading = true;
    this.#errorMessage = null;
    this.emitState();
    try {
      await this.#view.webContents.loadURL(url);
    } catch (error: unknown) {
      this.#loading = false;
      this.#errorMessage =
        error instanceof Error ? error.message : '页面加载失败';
      this.emitState();
    }
  }

  private updateEnvironment(): void {
    this.#environment =
      environmentForUrl(this.#view.webContents.getURL()) ?? this.#environment;
  }

  private resize(): void {
    const { width, height } = this.window.getContentBounds();
    this.#view.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT - this.#networkLabHeight),
    });
  }

  private emitState(): void {
    if (!this.#view.webContents.isDestroyed()) {
      this.onStateChanged(this.getState());
    }
  }
}
