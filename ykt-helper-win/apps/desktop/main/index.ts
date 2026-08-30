import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, type WebContents } from 'electron';
import { createBackendRuntime } from '@ykt/backend';
import { IpcChannel, isBrowserEnvironment } from '@ykt/contracts';

import { BrowserController } from './browser-controller.js';

const runtime = createBackendRuntime();
let mainWindow: BrowserWindow | undefined;
let browserController: BrowserController | undefined;

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

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
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
  mainWindow.on('closed', () => {
    browserController?.destroy();
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
