import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type WebContents,
} from 'electron';
import { createBackendRuntime, type BackendRuntime } from '@ykt/backend';
import {
  IpcChannel,
  isBrowserEnvironment,
  type AnswerInput,
} from '@ykt/contracts';
import { YuketangActiveClient } from '@ykt/routing';
import {
  DiskResourceCache,
  FileSecretStore,
  SqliteAppDataStore,
} from '@ykt/storage';

import { BrowserController } from './browser-controller.js';
import { ElectronSessionCredentialSource } from './electron-session-credentials.js';
import { ElectronSafeStorageCodec } from './electron-safe-storage-codec.js';
import { NetworkLabController } from './network-lab-controller.js';

let runtime: BackendRuntime | undefined;
let mainWindow: BrowserWindow | undefined;
let browserController: BrowserController | undefined;
let networkLabController: NetworkLabController | undefined;

configureStorageProfile();

function configureStorageProfile(): void {
  if (process.argv.includes('--portable')) {
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
    return getRuntime().facade.updateSettings(patch);
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
  ipcMain.handle(
    IpcChannel.ConnectLesson,
    async (event, environment: unknown, lessonId: unknown) => {
      assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
      if (!isBrowserEnvironment(environment) || typeof lessonId !== 'string') {
        throw new Error('Invalid lesson connection request.');
      }
      await getRuntime().facade.connectLesson(environment, lessonId);
    },
  );
  ipcMain.handle(IpcChannel.ListProblems, async (event, lessonId: unknown) => {
    assertTrustedIpc(event.sender, event.senderFrame?.url ?? '');
    if (typeof lessonId !== 'string') throw new Error('Invalid lesson id.');
    return getRuntime().facade.listProblems(lessonId);
  });
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
    (input.forceRetry !== undefined && typeof input.forceRetry !== 'boolean')
  ) {
    throw new Error('Invalid answer input.');
  }
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

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
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

  browserController = new BrowserController(mainWindow, (state) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.BrowserStateChanged, state);
    }
  });
  networkLabController = new NetworkLabController(
    browserController.webContents,
    (entry) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IpcChannel.NetworkEntryAdded, entry);
      }
    },
    (state) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(
          IpcChannel.NetworkCaptureStateChanged,
          state,
        );
      }
    },
  );
  const storageDirectory = join(app.getPath('userData'), 'storage');
  const dataStore = new SqliteAppDataStore(
    join(storageDirectory, 'yuketang.sqlite'),
  );
  const settings = await dataStore.getSettings();
  const resourceCache = await DiskResourceCache.open({
    directory: join(storageDirectory, 'resource-cache'),
    maxBytes: settings.cacheMaxBytes,
  });
  const secretStore = new FileSecretStore(
    join(storageDirectory, 'credentials.json'),
    new ElectronSafeStorageCodec(),
  );
  runtime = createBackendRuntime({
    dataStore,
    resourceCache,
    activeClient: new YuketangActiveClient({
      credentials: new ElectronSessionCredentialSource(
        browserController.webContents,
        secretStore,
      ),
      recorder: networkLabController.recorder,
    }),
  });
  await runtime.start();
  networkLabController.start();
  let disposed = false;
  mainWindow.on('close', () => {
    if (disposed) return;
    disposed = true;
    networkLabController?.destroy();
    browserController?.destroy();
    void runtime?.stop();
  });
  mainWindow.on('closed', () => {
    networkLabController = undefined;
    browserController = undefined;
    mainWindow = undefined;
    runtime = undefined;
  });
  await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  await browserController.start();
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void runtime?.stop();
});
