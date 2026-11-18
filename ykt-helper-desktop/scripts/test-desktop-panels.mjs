/* Run with Electron via npm run test:panels. Uses fresh data and an isolated CLI pipe. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { app, BrowserWindow } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (event) => {
    if (event.level === 'error') console.error('Renderer:', event.message);
  });
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ykt-panel-test-'));
app.setPath('userData', profile);
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('yuketang-helper-desktop')
  ) {
    args[0] =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\ykt-panel-test-${process.pid}`
        : `/tmp/ykt-panel-test-${process.pid}.sock`;
  }
  return listen.apply(this, args);
};
const output = path.resolve(__dirname, '../apps/desktop/.impeccable/review');
fs.mkdirSync(output, { recursive: true });
let code = 0;
let finished = false;
const deadline = setTimeout(() => {
  console.error('Panel smoke test timed out.');
  app.exit(1);
}, 45000);
await import('../apps/desktop/dist/main/index.cjs');
async function until(predicate) {
  const limit = Date.now() + 15000;
  while (Date.now() < limit) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the desktop renderer.');
}
async function run() {
  await app.whenReady();
  const window = await until(() => BrowserWindow.getAllWindows()[0]);
  const shell = window.webContents;
  await until(
    () => shell.getURL().endsWith('/renderer/index.html') && !shell.isLoading(),
  );
  await until(() =>
    window.contentView.children.find(
      (view) =>
        view.webContents?.getURL().endsWith('#tools') &&
        !view.webContents.isLoading(),
    ),
  );
  const command = (input) =>
    shell.executeJavaScript(
      `window.yuketang.controlToolPanel(${JSON.stringify(input)})`,
    );
  const snapshot = () =>
    shell.executeJavaScript('window.yuketang.getBrowserState()');
  const getView = (id) =>
    window.contentView.children.find((view) =>
      view.webContents
        ?.getURL()
        .endsWith(id === 'tools' ? '#tools' : `#panel=${id}`),
    );
  const clickLayoutControl = (label) => {
    const selector = `.floating-titlebar button[aria-label="${label}"]`;
    return getView('tools').webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
  };
  for (const id of ['tools', 'settings', 'courseware', 'network']) {
    await command({ action: 'open', id });
    const view = await until(() => {
      const v = getView(id);
      return v && !v.webContents.isLoading() ? v : undefined;
    });
    await until(() =>
      view.webContents.executeJavaScript(
        "!!document.querySelector('.floating-content') && !document.querySelector('.floating-content')?.textContent.includes('面板操作失败')",
      ),
    );
  }
  await until(() =>
    getView('network').webContents.executeJavaScript(
      "!!document.querySelector('.network-lab')",
    ),
  );
  const launcherState = await getView('tools').webContents.executeJavaScript(`({
    text: document.querySelector('.tool-launcher').textContent,
    opened: Array.from(document.querySelectorAll('.tool-open')).map(button => ({ text: button.textContent.trim(), pressed: button.getAttribute('aria-pressed') }))
  })`);
  assert(
    !/学习工具|自动排列|收起全部|可同时打开|拖动标题栏|已打开|Esc 收起/.test(
      launcherState.text,
    ),
  );
  assert.equal(launcherState.opened.length, 3);
  assert(launcherState.opened.every((button) => button.pressed === 'true'));
  const before = await snapshot();
  assert.equal(before.panels.filter((panel) => panel.visible).length, 4);
  const launcher = getView('tools').webContents;
  const launcherFits = await launcher.executeJavaScript(`(() => {
    const content = document.querySelector('.tool-launcher');
    return innerHeight <= 280 && content.scrollHeight <= content.clientHeight + 1;
  })()`);
  assert(
    launcherFits,
    'The default launcher should fit its tools without taking up the workspace',
  );
  await command({ action: 'focus', id: 'tools' });
  await launcher.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  fs.writeFileSync(
    path.join(output, 'compact-launcher-default.png'),
    (await launcher.capturePage()).toPNG(),
  );
  const settings = getView('settings');
  await until(() =>
    settings.webContents.executeJavaScript(
      "!!document.querySelector('input[type=checkbox]')",
    ),
  );
  const originalContents = settings.webContents.id;
  await settings.webContents.executeJavaScript(
    "window.__draftElement = document.querySelector('input[type=checkbox]'); window.__draftElement.click(); window.__draftValue = window.__draftElement.checked;",
  );
  await command({ action: 'close', id: 'settings' });
  assert.equal(
    (await snapshot()).panels.find((panel) => panel.id === 'network').visible,
    true,
  );
  await command({ action: 'open', id: 'settings' });
  assert.equal(getView('settings').webContents.id, originalContents);
  assert.equal(
    await settings.webContents.executeJavaScript(
      'window.__draftElement === document.querySelector("input[type=checkbox]") && window.__draftElement.checked === window.__draftValue',
    ),
    true,
  );
  // Exercise the real Vue titlebar keyboard handler through the isolated preload.
  const initialX = (await snapshot()).panels.find(
    (panel) => panel.id === 'settings',
  ).bounds.x;
  await settings.webContents.executeJavaScript(
    "document.querySelector('.panel-drag-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))",
  );
  await until(
    async () =>
      (await snapshot()).panels.find((panel) => panel.id === 'settings').bounds
        .x < initialX,
  );
  for (const [name, width, height] of [
    ['desktop', 1180, 800],
    ['small', 800, 600],
    ['compact', 480, 400],
  ]) {
    window.setContentSize(width, height);
    await until(() =>
      shell.executeJavaScript(
        `innerWidth === ${width} && innerHeight === ${height}`,
      ),
    );
    await command({ action: 'maximize', id: 'tools' });
    await clickLayoutControl('自动排列');
    await until(async () => {
      const panel = (await snapshot()).panels.find(({ id }) => id === 'tools');
      return !panel.maximized;
    });
    const state = await snapshot();
    assert(state.panels.find(({ id }) => id === 'tools').bounds.height <= 280);
    for (const panel of state.panels.filter((panel) => panel.visible)) {
      assert(panel.bounds.x >= 0 && panel.bounds.y >= 104);
      assert(panel.bounds.x + panel.bounds.width <= width);
      assert(panel.bounds.y + panel.bounds.height <= height);
    }
    for (const id of ['tools', 'settings', 'network']) {
      await command({ action: 'focus', id });
      const view = getView(id);
      const metrics = await view.webContents.executeJavaScript(
        '({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth })',
      );
      assert.equal(
        metrics.overflow,
        false,
        `${name}/${id} horizontal overflow`,
      );
      await view.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      if (id === 'tools') {
        assert.equal(
          await view.webContents.executeJavaScript(
            "getComputedStyle(document.querySelector('.background-owner')).display",
          ),
          'contents',
        );
      }
      if (id === 'network') {
        assert.equal(
          await view.webContents.executeJavaScript(
            "document.querySelector('.network-lab').getBoundingClientRect().height > 0 && getComputedStyle(document.querySelector('.network-lab')).display !== 'none'",
          ),
          true,
          'Network controls must remain visible on small screens',
        );
      }
      if (id === 'network') {
        const layout = await view.webContents.executeJavaScript(`(() => {
          const toolbar = document.querySelector('.lab-toolbar');
          const bounds = toolbar.getBoundingClientRect();
          const childBottom = Math.max(...Array.from(toolbar.children, child => child.getBoundingClientRect().bottom));
          return { bottom: bounds.bottom, childBottom, bodyTop: document.querySelector('.lab-body').getBoundingClientRect().top };
        })()`);
        assert(
          layout.bottom + 1 >= layout.childBottom,
          `${name}: toolbar clipped controls`,
        );
        assert(
          layout.bodyTop + 1 >= layout.bottom,
          `${name}: records overlap toolbar`,
        );
        const accessible = await view.webContents
          .executeJavaScript(`(async () => {
          const controls = [document.querySelector('.lab-toolbar .search'), ...Array.from(document.querySelectorAll('.lab-toolbar button')).filter(button => ['暂停', '清空', '导出'].includes(button.textContent.trim()))];
          if (controls.length !== 4) return false;
          for (const control of controls) {
            control.scrollIntoView({ block: 'nearest' });
            await new Promise(resolve => requestAnimationFrame(resolve));
            const rect = control.getBoundingClientRect();
            if (rect.top < document.querySelector('.floating-titlebar').getBoundingClientRect().bottom || rect.bottom > innerHeight + 1 || rect.width <= 0) return false;
          }
          document.querySelector('.network-lab').scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        })()`);
        assert(
          accessible,
          `${name}: network controls must be reachable by scrolling`,
        );
      }
      const image = await view.webContents.capturePage();
      assert.equal(image.isEmpty(), false);
      fs.writeFileSync(
        path.join(output, `multi-${name}-${id}.png`),
        image.toPNG(),
      );
    }
  }
  await command({ action: 'focus', id: 'settings' });
  await settings.webContents.executeJavaScript(
    "document.querySelector('.floating-workspace').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await until(
    async () =>
      !(await snapshot()).panels.find((panel) => panel.id === 'settings')
        .visible,
  );
  assert.equal(
    (await snapshot()).panels.find((panel) => panel.id === 'network').visible,
    true,
  );
  await shell.executeJavaScript('window.yuketang.browserNewTab()');
  const top = window.contentView.children.at(-1);
  assert(
    top.webContents.getURL().includes('#'),
    'A webpage covered the floating panels',
  );
  window.setContentSize(800, 600);
  for (const id of ['assignments', 'courses', 'diagnostics']) {
    await command({ action: 'open', id });
    const view = await until(() => getView(id));
    await until(() =>
      view.webContents.executeJavaScript(
        "!!document.querySelector('.assistant-panel .panel-scroll')",
      ),
    );
    assert.equal(
      await view.webContents.executeJavaScript(
        "!!document.querySelector('.diagnostics-page')",
      ),
      id === 'diagnostics',
      `${id}: diagnostics must only render when selected`,
    );
    await view.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    fs.writeFileSync(
      path.join(output, `routing-${id}.png`),
      (await view.webContents.capturePage()).toPNG(),
    );
  }
  await clickLayoutControl('收起全部');
  await until(async () =>
    (await snapshot()).panels.every((panel) => !panel.visible),
  );
  console.log(
    'Desktop panel smoke test passed: multi-open, cached draft, keyboard move, resize clamping, stacking, and Escape.',
  );
  console.log(`Individual native-view screenshots: ${output}`);
}
run()
  .catch((error) => {
    code = 1;
    console.error(error);
  })
  .finally(() => {
    finished = true;
    clearTimeout(deadline);
    process.exitCode = code;
    app.quit();
  });
app.on('will-quit', () => {
  if (finished) console.log(`Isolated test data: ${profile}`);
});
