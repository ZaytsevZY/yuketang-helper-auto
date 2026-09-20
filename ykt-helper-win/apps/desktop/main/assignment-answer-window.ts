import { BrowserWindow, dialog } from 'electron';
import { canOpenAssignmentAnswer, type AssignmentDetail } from '@ykt/contracts';
import { isAllowedYuketangUrl } from './browser-policy.js';

/** No injected scripts, answer API or copied Cookie: the official page owns submission. */
export async function openAssignmentAnswerWindow(
  parent: BrowserWindow,
  session: Electron.Session,
  detail: AssignmentDetail,
): Promise<void> {
  if (!canOpenAssignmentAnswer(detail))
    throw new Error('当前作业不可作答，请刷新状态或在官网查看。');
  const result = await dialog.showMessageBox(parent, {
    type: 'question',
    title: '打开作答页',
    message: `打开“${detail.assignment.title}”的官方作答页？`,
    buttons: ['打开', '取消'],
    defaultId: 1,
    cancelId: 1,
  });
  if (result.response !== 0) return;
  if (!canOpenAssignmentAnswer(detail))
    throw new Error('作业已截止，请刷新状态。');
  const window = new BrowserWindow({
    parent,
    width: 1050,
    height: 800,
    title: '雨课堂 · 作答',
    webPreferences: {
      session,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const guard = (event: Electron.Event, url: string) => {
    if (!isAllowedYuketangUrl(url)) event.preventDefault();
  };
  window.webContents.on('will-navigate', guard);
  window.webContents.on('will-redirect', guard);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const closed = new Promise<void>((resolve) =>
    window.once('closed', () => resolve()),
  );
  try {
    await window.loadURL(detail.assignment.url);
  } catch {
    if (!window.isDestroyed()) window.destroy();
    throw new Error('官方作答页打开失败，请重试。');
  }
  await closed;
}
