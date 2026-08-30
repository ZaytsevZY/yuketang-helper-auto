import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { createBackendRuntime } from '@ykt/backend';
import { IpcChannel } from '@ykt/contracts';

const runtime = createBackendRuntime();
let mainWindow: BrowserWindow | undefined;

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

  await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
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
