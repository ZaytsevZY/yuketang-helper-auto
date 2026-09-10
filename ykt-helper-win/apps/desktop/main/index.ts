import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  powerSaveBlocker,
  shell,
  type WebContents,
} from 'electron';
import { createBackendRuntime, type BackendRuntime } from '@ykt/backend';
import {
  BrowserEnvironment,
  IpcChannel,
  isBrowserEnvironment,
  type AnswerInput,
  type ConnectAiProfileInput,
  type ClassroomSimulationAction,
  type GenerateAnswerProposalInput,
  type RecognizeSlideInput,
  type Presentation,
  type SourceModuleId,
  type TranslateTextInput,
  type UpdateAiProfileSelectionInput,
} from '@ykt/contracts';
import { BrowserLessonCollector, YuketangActiveClient } from '@ykt/routing';
import {
  DiskResourceCache,
  FileSecretStore,
  SqliteAppDataStore,
} from '@ykt/storage';
import electronSquirrelStartup from 'electron-squirrel-startup';

import { BrowserController } from './browser-controller.js';
import { isAllowedYuketangUrl, isClassroomUrl } from './browser-policy.js';
import { createDesktopCliHandler } from './cli-handler.js';
import { DesktopCliServer } from './cli-server.js';
import { ChromiumHttpTransport } from './chromium-http-transport.js';
import { ElectronSessionCredentialSource } from './electron-session-credentials.js';
import { ElectronSafeStorageCodec } from './electron-safe-storage-codec.js';
import { NetworkLabController } from './network-lab-controller.js';

let runtime: BackendRuntime | undefined;
let mainWindow: BrowserWindow | undefined;
let browserController: BrowserController | undefined;
let networkLabController: NetworkLabController | undefined;
let cliServer: DesktopCliServer | undefined;
let serviceCleanupPromise: Promise<void> | undefined;
let quitAfterCleanup = false;
let keepScreenAwake = false;
let wakeLockId: number | null = null;

if (electronSquirrelStartup) {
  app.quit();
}

configureStorageProfile();

const hasSingleInstanceLock =
  !electronSquirrelStartup && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) void createWindow().catch(reportStartupError);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function configureStorageProfile(): void {
  const portableMarker = join(dirname(app.getPath('exe')), 'portable.flag');
  if (process.argv.includes('--portable') || existsSync(portableMarker)) {
    app.setPath(
      'userData',
      join(dirname(app.getPath('exe')), 'ykt-helper-data'),
    );
  } else if (process.argv.includes('--debug-profile')) {
    app.setPath('userData', join(app.getPath('userData'), 'debug-profile'));
  }
}

function isTrustedRenderer(sender: WebContents, senderUrl: string): boolean {
  return (
    sender === mainWindow?.webContents &&
    senderUrl === sender.getURL() &&
    senderUrl.startsWith('file:')
  );
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.GetRuntimeStatus, async (event) => {
    if (!isTrustedRenderer(event.sender, event.senderFrame?.url ?? '')) {
      throw new Error('IPC request rejected.');
    }
    return getRuntime().facade.getStatus();
  });
  ipcMain.handle(IpcChannel.GetSettings, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    return getRuntime().facade.getSettings();
  });
  ipcMain.handle(IpcChannel.UpdateSettings, async (event, patch: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Invalid settings.');
    }
    const settings = await getRuntime().facade.updateSettings(patch);
    keepScreenAwake = settings.keepScreenAwake;
    syncScreenWakeLock();
    return settings;
  });
  ipcMain.handle(IpcChannel.ResetSettings, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    const settings = await getRuntime().facade.resetSettings();
    keepScreenAwake = settings.keepScreenAwake;
    syncScreenWakeLock();
    return settings;
  });
  ipcMain.handle(IpcChannel.ListAiProfiles, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    return getRuntime().facade.listAiProfiles();
  });
  ipcMain.handle(IpcChannel.ConnectAiProfile, async (event, input: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    assertConnectAiProfileInput(input);
    return getRuntime().facade.connectAiProfile(input);
  });
  ipcMain.handle(IpcChannel.RefreshAiProfile, async (event, id: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof id !== 'string') throw new Error('Invalid AI Profile id.');
    return getRuntime().facade.refreshAiProfile(id);
  });
  ipcMain.handle(
    IpcChannel.UpdateAiProfileSelection,
    async (event, input: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      assertUpdateAiProfileSelectionInput(input);
      return getRuntime().facade.updateAiProfileSelection(input);
    },
  );
  ipcMain.handle(IpcChannel.DeleteAiProfile, async (event, id: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof id !== 'string') throw new Error('Invalid AI Profile id.');
    return getRuntime().facade.deleteAiProfile(id);
  });
  ipcMain.handle(IpcChannel.SelectAiProfile, async (event, id: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof id !== 'string') throw new Error('Invalid AI Profile id.');
    return getRuntime().facade.selectAiProfile(id);
  });
  ipcMain.handle(IpcChannel.GetClassroomSimulation, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    return getRuntime().facade.getClassroomSimulation();
  });
  ipcMain.handle(
    IpcChannel.RunClassroomSimulation,
    async (event, action: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      assertClassroomSimulationAction(action);
      return getRuntime().facade.runClassroomSimulation(action);
    },
  );
  ipcMain.handle(
    IpcChannel.GenerateAnswerProposal,
    async (event, input: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      assertGenerateProposalInput(input);
      const imageUrls = await Promise.all(
        (input.imageUrls ?? []).map(prepareAiImage),
      );
      return getRuntime().facade.generateAnswerProposal({
        problemId: input.problemId,
        imageUrls,
        ...(input.customPrompt === undefined
          ? {}
          : { customPrompt: input.customPrompt }),
      });
    },
  );
  ipcMain.handle(IpcChannel.RecognizeSlide, async (event, input: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    assertRecognizeSlideInput(input);
    return getRuntime().facade.recognizeSlide({
      imageUrl: await prepareAiImage(input.imageUrl),
    });
  });
  ipcMain.handle(IpcChannel.TranslateText, async (event, input: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    assertTranslateTextInput(input);
    return getRuntime().facade.translateText(input);
  });
  ipcMain.handle(IpcChannel.GetUser, async (event, environment: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (!isBrowserEnvironment(environment)) {
      throw new Error('Invalid browser environment.');
    }
    return getRuntime().facade.getUser(environment);
  });
  ipcMain.handle(
    IpcChannel.RefreshUser,
    async (event, environment: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (!isBrowserEnvironment(environment)) {
        throw new Error('Invalid browser environment.');
      }
      return getRuntime().facade.refreshUser(environment);
    },
  );
  ipcMain.handle(IpcChannel.ListLogs, async (event, limit: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (limit !== undefined && typeof limit !== 'number') {
      throw new Error('Invalid log limit.');
    }
    return getRuntime().facade.listLogs(limit);
  });
  ipcMain.handle(
    IpcChannel.RefreshLessons,
    async (event, environment: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (!isBrowserEnvironment(environment)) {
        throw new Error('Invalid browser environment.');
      }
      return getRuntime().facade.refreshLessons(environment);
    },
  );
  ipcMain.handle(IpcChannel.ListLessons, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    return getRuntime().facade.listLessons();
  });
  ipcMain.handle(
    IpcChannel.ConnectLesson,
    async (event, environment: unknown, lessonId: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (!isBrowserEnvironment(environment) || typeof lessonId !== 'string') {
        throw new Error('Invalid lesson connection request.');
      }
      const facade = getRuntime().facade;
      const connectedEnvironment = await facade.connectLesson(
        environment,
        lessonId,
      );
      const lesson = (await facade.listLessons()).find(
        (item) => item.id === lessonId,
      );
      await getBrowserController().openLesson(
        connectedEnvironment,
        lessonId,
        lesson?.status,
      );
    },
  );
  ipcMain.handle(IpcChannel.ListProblems, async (event, lessonId: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof lessonId !== 'string') throw new Error('Invalid lesson id.');
    return getRuntime().facade.listProblems(lessonId);
  });
  ipcMain.handle(
    IpcChannel.ListPresentations,
    async (event, lessonId: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (typeof lessonId !== 'string') throw new Error('Invalid lesson id.');
      return getRuntime().facade.listPresentations(lessonId);
    },
  );
  ipcMain.handle(IpcChannel.ValidateAnswer, async (event, input: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    assertAnswerInput(input);
    return getRuntime().facade.validateAnswer(input);
  });
  ipcMain.handle(IpcChannel.SubmitAnswer, async (event, input: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    assertAnswerInput(input);
    return getRuntime().facade.submitAnswer(input);
  });

  ipcMain.handle(IpcChannel.GetBrowserState, (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    return getBrowserController().getState();
  });
  ipcMain.handle(
    IpcChannel.SelectBrowserEnvironment,
    async (event, environment: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (!isBrowserEnvironment(environment)) {
        throw new Error('Invalid browser environment.');
      }
      await getBrowserController().selectEnvironment(environment);
      await getRuntime().facade.updateSettings({
        browserEnvironment: environment,
      });
    },
  );
  ipcMain.handle(IpcChannel.BrowserBack, (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    getBrowserController().back();
  });
  ipcMain.handle(IpcChannel.BrowserForward, (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    getBrowserController().forward();
  });
  ipcMain.handle(IpcChannel.BrowserReload, (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    getBrowserController().reload();
  });
  ipcMain.handle(IpcChannel.BrowserHome, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    await getBrowserController().home();
  });
  ipcMain.handle(IpcChannel.BrowserNavigate, async (event, url: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof url !== 'string') throw new Error('Invalid browser URL.');
    await getBrowserController().navigate(url);
  });
  ipcMain.handle(IpcChannel.BrowserNewTab, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    await getBrowserController().newTab();
  });
  ipcMain.handle(IpcChannel.BrowserActivateTab, (event, tabId: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof tabId !== 'string') throw new Error('Invalid browser tab.');
    getBrowserController().activateTab(tabId);
  });
  ipcMain.handle(IpcChannel.BrowserCloseTab, async (event, tabId: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof tabId !== 'string') throw new Error('Invalid browser tab.');
    await getBrowserController().closeTab(tabId);
  });
  ipcMain.handle(
    IpcChannel.SetNetworkLabCollapsed,
    (event, collapsed: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (typeof collapsed !== 'boolean') {
        throw new Error('Invalid network lab state.');
      }
      getBrowserController().setNetworkLabCollapsed(collapsed);
    },
  );
  ipcMain.handle(
    IpcChannel.SetAssistantPanelCollapsed,
    (event, collapsed: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (typeof collapsed !== 'boolean') {
        throw new Error('Invalid assistant panel state.');
      }
      getBrowserController().setAssistantPanelCollapsed(collapsed);
    },
  );
  ipcMain.handle(IpcChannel.GetNetworkSnapshot, (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    return getNetworkLabController().getSnapshot();
  });
  ipcMain.handle(IpcChannel.SetNetworkPaused, (event, paused: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof paused !== 'boolean') throw new Error('Invalid pause state.');
    getNetworkLabController().setPaused(paused);
  });
  ipcMain.handle(IpcChannel.SetDeepCapture, async (event, enabled: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid deep capture state.');
    }
    await getNetworkLabController().setDeepCapture(enabled);
  });
  ipcMain.handle(IpcChannel.ClearNetworkEntries, (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    getNetworkLabController().clear();
  });
  ipcMain.handle(IpcChannel.ExportNetworkFixture, async (event) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Desktop window is not ready.');

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出脱敏网络 Fixture',
      defaultPath: `yuketang-network-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;

    await writeFile(
      result.filePath,
      JSON.stringify(getNetworkLabController().getFixture(), null, 2),
      'utf8',
    );
    return { filePath: result.filePath };
  });
  ipcMain.handle(
    IpcChannel.ExportPresentationPdf,
    async (event, lessonId: unknown, presentationId: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (typeof lessonId !== 'string' || typeof presentationId !== 'string') {
        throw new Error('Invalid presentation export request.');
      }
      const presentations =
        await getRuntime().facade.listPresentations(lessonId);
      const presentation = presentations.find(
        (item) => item.id === presentationId,
      );
      if (!presentation) throw new Error('Presentation was not found.');
      return exportPresentationPdf(presentation);
    },
  );
  ipcMain.handle(
    IpcChannel.DownloadSlide,
    async (event, imageUrl: unknown, suggestedName: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (
        typeof imageUrl !== 'string' ||
        typeof suggestedName !== 'string' ||
        !isHttpsUrl(imageUrl)
      ) {
        throw new Error('Invalid slide download request.');
      }
      return downloadSlide(imageUrl, suggestedName);
    },
  );
  ipcMain.handle(
    IpcChannel.ShowNotification,
    async (event, title: unknown, body: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (typeof title !== 'string' || typeof body !== 'string') {
        throw new Error('Invalid notification.');
      }
      if (Notification.isSupported()) {
        new Notification({
          title: title.slice(0, 80),
          body: body.slice(0, 500),
        }).show();
      }
    },
  );
  ipcMain.handle(IpcChannel.OpenSourceModule, async (event, id: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (!isSourceModuleId(id)) throw new Error('Invalid source module.');
    const error = await shell.openPath(sourceModulePath(id));
    if (error) throw new Error(error);
  });
}

function assertTrustedIpc(sender: WebContents, senderUrl: string): void {
  if (!isTrustedRenderer(sender, senderUrl)) {
    throw new Error('IPC request rejected.');
  }
}

function assertAnswerInput(value: unknown): asserts value is AnswerInput {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid answer input.');
  }
  const input = value as Record<string, unknown>;
  const answer = input.answer;
  const validAnswer =
    typeof answer === 'string' ||
    (Array.isArray(answer) &&
      answer.every((item) => typeof item === 'string')) ||
    (typeof answer === 'object' &&
      answer !== null &&
      typeof (answer as Record<string, unknown>).content === 'string' &&
      Array.isArray((answer as Record<string, unknown>).pics) &&
      ((answer as Record<string, unknown>).pics as unknown[]).every(
        (item) => typeof item === 'string',
      ));
  if (
    typeof input.problemId !== 'string' ||
    !validAnswer ||
    (input.forceRetry !== undefined && typeof input.forceRetry !== 'boolean') ||
    (input.proposalId !== undefined && typeof input.proposalId !== 'string') ||
    (input.confirmedBy !== undefined &&
      input.confirmedBy !== 'user' &&
      input.confirmedBy !== 'agent') ||
    (input.confirmedBy !== undefined && input.proposalId === undefined)
  ) {
    throw new Error('Invalid answer input.');
  }
}

function assertConnectAiProfileInput(
  value: unknown,
): asserts value is ConnectAiProfileInput {
  if (
    !isRecord(value) ||
    typeof value.baseUrl !== 'string' ||
    typeof value.apiKey !== 'string' ||
    (value.providerId !== undefined && typeof value.providerId !== 'string')
  ) {
    throw new Error('Invalid AI connection.');
  }
}

function assertUpdateAiProfileSelectionInput(
  value: unknown,
): asserts value is UpdateAiProfileSelectionInput {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.visionModel !== 'string' ||
    typeof value.ocrModel !== 'string' ||
    typeof value.translationModel !== 'string' ||
    (value.temperature !== null && typeof value.temperature !== 'number')
  ) {
    throw new Error('Invalid AI model selection.');
  }
}

function assertClassroomSimulationAction(
  value: unknown,
): asserts value is ClassroomSimulationAction {
  if (
    ![
      'reset',
      'show-slide',
      'publish-courseware',
      'publish-problem-object',
      'publish-problem-scalar',
      'finish-lesson',
    ].includes(value as ClassroomSimulationAction)
  ) {
    throw new Error('Invalid classroom simulation action.');
  }
}

function assertGenerateProposalInput(
  value: unknown,
): asserts value is GenerateAnswerProposalInput {
  if (
    !isRecord(value) ||
    typeof value.problemId !== 'string' ||
    (value.customPrompt !== undefined &&
      typeof value.customPrompt !== 'string') ||
    (value.imageUrls !== undefined &&
      (!Array.isArray(value.imageUrls) ||
        !value.imageUrls.every((url) => typeof url === 'string')))
  ) {
    throw new Error('Invalid AI proposal request.');
  }
}

function assertRecognizeSlideInput(
  value: unknown,
): asserts value is RecognizeSlideInput {
  if (!isRecord(value) || typeof value.imageUrl !== 'string') {
    throw new Error('Invalid OCR request.');
  }
}

function assertTranslateTextInput(
  value: unknown,
): asserts value is TranslateTextInput {
  if (
    !isRecord(value) ||
    typeof value.text !== 'string' ||
    typeof value.targetLanguage !== 'string'
  ) {
    throw new Error('Invalid translation request.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function prepareAiImage(value: string): Promise<string> {
  if (value.startsWith('data:image/')) return value;
  if (!isHttpsUrl(value)) throw new Error('课件图片必须使用 HTTPS。');
  const response =
    await getBrowserController().webContents.session.fetch(value);
  if (!response.ok)
    throw new Error(`课件图片读取失败：HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? 'image/jpeg')
    .split(';')[0]!
    .trim();
  if (!contentType.startsWith('image/')) throw new Error('课件资源不是图片。');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > 16 * 1024 * 1024)
    throw new Error('课件图片超过 16MB。');
  return `data:${contentType};base64,${body.toString('base64')}`;
}

function getBrowserController(): BrowserController {
  if (!browserController) throw new Error('Browser is not ready.');
  return browserController;
}

function getRuntime(): BackendRuntime {
  if (!runtime) throw new Error('Backend is not ready.');
  return runtime;
}

function getNetworkLabController(): NetworkLabController {
  if (!networkLabController) throw new Error('Network lab is not ready.');
  return networkLabController;
}

function syncScreenWakeLock(): void {
  const active = keepScreenAwake ? browserController?.getState() : undefined;
  const shouldPreventSleep =
    keepScreenAwake && Boolean(active && isClassroomUrl(active.url));
  if (shouldPreventSleep && wakeLockId === null) {
    wakeLockId = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!shouldPreventSleep && wakeLockId !== null) {
    if (powerSaveBlocker.isStarted(wakeLockId))
      powerSaveBlocker.stop(wakeLockId);
    wakeLockId = null;
  }
}

async function exportPresentationPdf(
  presentation: Presentation,
): Promise<{ filePath: string } | null> {
  if (!mainWindow) throw new Error('Desktop window is not ready.');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出课件 PDF',
    defaultPath: `${safeFileName(presentation.title || '雨课堂课件')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'persist:yuketang-browser',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(presentationHtml(presentation))}`,
    );
    await printWindow.webContents.executeJavaScript(`
      Promise.race([
        Promise.all(Array.from(document.images).map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              })
        )),
        new Promise((resolve) => setTimeout(resolve, 15000))
      ])
    `);
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    });
    await writeFile(result.filePath, pdf);
    return { filePath: result.filePath };
  } finally {
    printWindow.destroy();
  }
}

async function downloadSlide(
  imageUrl: string,
  suggestedName: string,
): Promise<{ filePath: string } | null> {
  if (!mainWindow) throw new Error('Desktop window is not ready.');
  const response =
    await getBrowserController().webContents.session.fetch(imageUrl);
  if (!response.ok)
    throw new Error(`课件图片下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  const extension = imageExtension(contentType, imageUrl);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '下载当前课件页',
    defaultPath: `${safeFileName(suggestedName || '课件页')}${extension}`,
    filters: [{ name: '图片', extensions: [extension.slice(1)] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, Buffer.from(await response.arrayBuffer()));
  return { filePath: result.filePath };
}

function imageExtension(contentType: string, imageUrl: string): string {
  if (/image\/png/i.test(contentType)) return '.png';
  if (/image\/webp/i.test(contentType)) return '.webp';
  if (/image\/gif/i.test(contentType)) return '.gif';
  const path = new URL(imageUrl).pathname;
  const match = /\.(png|webp|gif|jpe?g)$/i.exec(path);
  return match ? `.${match[1]!.toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

function presentationHtml(presentation: Presentation): string {
  const slides = presentation.slides
    .map((slide, index) => {
      const image =
        slide.imageUrl && isAllowedYuketangUrl(slide.imageUrl)
          ? `<img src="${escapeHtml(slide.imageUrl)}" alt="第 ${index + 1} 页" />`
          : '<div class="missing">该页没有可导出的图片</div>';
      return `<section class="slide"><header>${index + 1} / ${presentation.slides.length}</header>${image}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://yuketang.cn https://*.yuketang.cn; style-src 'unsafe-inline'"><title>${escapeHtml(presentation.title)}</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#1f2924;font-family:"Microsoft YaHei","Segoe UI",sans-serif}.slide{display:grid;width:100%;height:190mm;grid-template-rows:8mm 1fr;break-after:page;page-break-after:always}.slide:last-child{break-after:auto;page-break-after:auto}header{color:#65736b;font-size:9pt;text-align:right}img{width:100%;height:100%;object-fit:contain}.missing{display:grid;place-items:center;border:1px solid #d9e1dc;color:#77847d}</style></head><body>${slides}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim() || '雨课堂课件';
}

function isSourceModuleId(value: unknown): value is SourceModuleId {
  return ['renderer', 'ipc', 'backend', 'routing', 'storage'].includes(
    value as SourceModuleId,
  );
}

function sourceModulePath(id: SourceModuleId): string {
  const paths: Record<SourceModuleId, string> = {
    renderer: join(__dirname, '../../renderer/src/App.vue'),
    ipc: join(__dirname, '../../preload/index.ts'),
    backend: join(__dirname, '../../../../packages/backend/src/runtime.ts'),
    routing: join(
      __dirname,
      '../../../../packages/routing/src/active/client.ts',
    ),
    storage: join(
      __dirname,
      '../../../../packages/storage/src/sqlite-app-data-store.ts',
    ),
  };
  return paths[id];
}

async function createWindow(): Promise<void> {
  if (serviceCleanupPromise) {
    await serviceCleanupPromise;
    serviceCleanupPromise = undefined;
  }
  const window = new BrowserWindow({
    show: false,
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 680,
    title: '雨课堂助手',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = window;

  const nextBrowserController = new BrowserController(window, (state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(IpcChannel.BrowserStateChanged, state);
    }
    syncScreenWakeLock();
  });
  browserController = nextBrowserController;
  const browserLessonCollector = new BrowserLessonCollector();
  const nextNetworkLabController = new NetworkLabController(
    nextBrowserController.webContents,
    (entry) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IpcChannel.NetworkEntryAdded, entry);
      }
    },
    (state) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IpcChannel.NetworkCaptureStateChanged, state);
      }
    },
    browserLessonCollector,
  );
  nextBrowserController.onWebContentsCreated((contents) => {
    nextNetworkLabController.attach(contents);
  });
  networkLabController = nextNetworkLabController;
  const windowResources: { cliServer?: DesktopCliServer } = {};
  let disposed = false;
  window.on('close', () => {
    if (disposed) return;
    disposed = true;
    nextNetworkLabController.destroy();
    nextBrowserController.destroy();
    void cleanupServices();
    keepScreenAwake = false;
    syncScreenWakeLock();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
    if (browserController === nextBrowserController) {
      browserController = undefined;
    }
    if (networkLabController === nextNetworkLabController) {
      networkLabController = undefined;
    }
    if (cliServer === windowResources.cliServer) cliServer = undefined;
    runtime = undefined;
  });

  const storageDirectory = join(app.getPath('userData'), 'storage');
  const dataStore = new SqliteAppDataStore(
    join(storageDirectory, 'yuketang.sqlite'),
  );
  const settings = await dataStore.getSettings();
  keepScreenAwake = settings.keepScreenAwake;
  if (window.isDestroyed()) {
    dataStore.close();
    return;
  }
  const resourceCache = await DiskResourceCache.open({
    directory: join(storageDirectory, 'resource-cache'),
    maxBytes: settings.cacheMaxBytes,
  });
  if (window.isDestroyed()) {
    resourceCache.close();
    dataStore.close();
    return;
  }
  const secretStore = new FileSecretStore(
    join(storageDirectory, 'credentials.json'),
    new ElectronSafeStorageCodec(),
  );
  const nextRuntime = createBackendRuntime({
    dataStore,
    resourceCache,
    secretStore,
    activeClient: new YuketangActiveClient({
      credentials: new ElectronSessionCredentialSource(
        () => nextBrowserController.webContents,
        secretStore,
      ),
      transport: new ChromiumHttpTransport(
        nextBrowserController.webContents.session,
      ),
      recorder: nextNetworkLabController.recorder,
      browserCollector: browserLessonCollector,
    }),
    onClassroomNotice: (notice) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IpcChannel.ClassroomNotice, notice);
      }
    },
  });
  runtime = nextRuntime;
  await nextRuntime.start();
  windowResources.cliServer = new DesktopCliServer(
    createDesktopCliHandler({
      facade: nextRuntime.facade,
      openLesson: (environment, lessonId, status) =>
        nextBrowserController.openLesson(environment, lessonId, status),
      prepareImage: prepareAiImage,
    }),
  );
  cliServer = windowResources.cliServer;
  await windowResources.cliServer.start();
  if (window.isDestroyed()) return;
  let initialEnvironment = isBrowserEnvironment(settings.browserEnvironment)
    ? settings.browserEnvironment
    : undefined;
  if (!initialEnvironment) {
    const users = await Promise.all([
      dataStore.getUser(BrowserEnvironment.Standard),
      dataStore.getUser(BrowserEnvironment.Pro),
    ]);
    const recentUser = users
      .filter((user) => user !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    initialEnvironment = recentUser?.environment ?? BrowserEnvironment.Standard;
    await dataStore.updateSettings({ browserEnvironment: initialEnvironment });
  }
  const browserStart = nextBrowserController.start(initialEnvironment);
  try {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  } catch (error: unknown) {
    if (window.isDestroyed()) return;
    throw error;
  }
  if (window.isDestroyed()) return;
  await nextNetworkLabController.start();
  if (window.isDestroyed()) return;
  window.show();
  nextBrowserController.refreshLayout();
  await browserStart;
}

if (hasSingleInstanceLock) {
  void app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      registerIpc();
      await createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow().catch(reportStartupError);
        }
      });
    })
    .catch((error: unknown) => {
      reportStartupError(error);
      app.quit();
    });
}

function reportStartupError(error: unknown): void {
  console.error(
    '[ykt-helper] Desktop startup failed:',
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
}

function cleanupServices(): Promise<void> {
  if (serviceCleanupPromise) return serviceCleanupPromise;
  const activeCliServer = cliServer;
  const activeRuntime = runtime;
  serviceCleanupPromise = Promise.allSettled([
    activeCliServer?.close() ?? Promise.resolve(),
    activeRuntime?.stop() ?? Promise.resolve(),
  ]).then(() => undefined);
  return serviceCleanupPromise;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitAfterCleanup) return;
  event.preventDefault();
  void cleanupServices().finally(() => {
    quitAfterCleanup = true;
    app.quit();
  });
});
