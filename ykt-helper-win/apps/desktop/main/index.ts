import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type WebContents,
} from 'electron';
import { createBackendRuntime } from '@ykt/backend';
import { IpcChannel, isBrowserEnvironment } from '@ykt/contracts';

import { BrowserController } from './browser-controller.js';
import { NetworkLabController } from './network-lab-controller.js';

const runtime = createBackendRuntime();
let mainWindow: BrowserWindow | undefined;
let browserController: BrowserController | undefined;
let networkLabController: NetworkLabController | undefined;

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
    return runtime.facade.getStatus();
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

function getBrowserController(): BrowserController {
  if (!browserController) throw new Error('Browser is not ready.');
  return browserController;
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
  networkLabController.start();
  let disposed = false;
  mainWindow.on('close', () => {
    if (disposed) return;
    disposed = true;
    networkLabController?.destroy();
    browserController?.destroy();
  });
  mainWindow.on('closed', () => {
    networkLabController = undefined;
    browserController = undefined;
    mainWindow = undefined;
  });
  await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  await browserController.start();
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await runtime.start();
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
  void runtime.stop();
});
