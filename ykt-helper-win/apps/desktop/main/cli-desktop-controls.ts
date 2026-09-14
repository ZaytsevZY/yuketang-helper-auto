import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { shell } from 'electron';
import {
  ErrorCode,
  YuketangError,
  type BrowserEnvironment,
  type YuketangFacade,
} from '@ykt/contracts';

import type { BrowserController } from './browser-controller.js';
import type { CliDesktopControls } from './cli-handler.js';
import {
  fetchSlideImage,
  writePresentationPdf,
  writeSlideFile,
} from './media-export.js';
import type { NetworkLabController } from './network-lab-controller.js';
import {
  isSourceModuleId,
  sourceModulePath,
  sourceModuleIds,
} from './source-modules.js';

/**
 * Adapts the Electron-only desktop services to the capability surface the
 * CLI RPC handler expects. Every method here runs inside the desktop process,
 * so it can reuse the embedded browser session, window geometry and the
 * network lab controller.
 */
export function createCliDesktopControls(deps: {
  browser: BrowserController;
  networkLab: NetworkLabController;
  facade: YuketangFacade;
}): CliDesktopControls {
  const { browser, networkLab, facade } = deps;

  return {
    getBrowserState: () => Promise.resolve(browser.getState()),

    async selectBrowserEnvironment(environment: BrowserEnvironment) {
      await browser.selectEnvironment(environment);
      await facade.updateSettings({ browserEnvironment: environment });
    },

    navigateBrowser: (url) => browser.navigate(url),
    browserBack: () => browser.back(),
    browserForward: () => browser.forward(),
    browserReload: () => browser.reload(),
    browserHome: () => browser.home(),
    browserNewTab: () => browser.newTab(),
    activateBrowserTab: (tabId) => browser.activateTab(tabId),
    closeBrowserTab: (tabId) => browser.closeTab(tabId),
    captureCurrentPage: () => browser.captureCurrentPage(),

    setPanels({ assistantCollapsed, networkLabCollapsed }) {
      if (assistantCollapsed !== undefined) {
        browser.setAssistantPanelCollapsed(assistantCollapsed);
      }
      if (networkLabCollapsed !== undefined) {
        browser.setNetworkLabCollapsed(networkLabCollapsed);
      }
    },

    getNetworkSnapshot: () => Promise.resolve(networkLab.getSnapshot()),
    setNetworkPaused: (paused) => networkLab.setPaused(paused),
    setDeepCapture: (enabled) => networkLab.setDeepCapture(enabled),
    clearNetworkEntries: () => networkLab.clear(),

    async exportNetworkFixture(filePath) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        JSON.stringify(networkLab.getFixture(), null, 2),
        'utf8',
      );
      return { filePath };
    },

    async downloadSlideToFile({ imageUrl, filePath }) {
      const image = await fetchSlideImage(
        browser.webContents.session,
        imageUrl,
      );
      await writeSlideFile(image, filePath);
      return { filePath };
    },

    async exportPresentationPdfToFile({ lessonId, presentationId, filePath }) {
      const presentations = await facade.listPresentations(lessonId);
      const presentation = presentations.find(
        (item) => item.id === presentationId,
      );
      if (!presentation) {
        throw new YuketangError({
          code: ErrorCode.NotFound,
          message: `Presentation ${presentationId} was not found in lesson ${lessonId}.`,
        });
      }
      await mkdir(dirname(filePath), { recursive: true });
      return writePresentationPdf(presentation, filePath);
    },

    async openSourceModule(id) {
      if (!isSourceModuleId(id)) {
        throw new YuketangError({
          code: ErrorCode.InvalidArgument,
          message: `Unknown source module: ${id}. Expected one of ${sourceModuleIds.join(', ')}.`,
        });
      }
      const error = await shell.openPath(sourceModulePath(id));
      if (error) {
        throw new YuketangError({
          code: ErrorCode.InternalError,
          message: error,
        });
      }
    },
  };
}
