import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browserCandidates = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ...(process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : []),
  ...(process.platform === 'win32' ? [
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ] : []),
  ...(process.platform === 'linux' ? [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ] : []),
].filter(Boolean);
const chrome = browserCandidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error(`No Chrome-compatible browser found. Set CHROME_PATH. Checked: ${browserCandidates.join(', ')}`);
const appOrigin = process.env.DEBUG_ORIGIN || 'http://127.0.0.1:8765';
const cdpPort = Number(process.env.DEBUG_CDP_PORT || 9333);
const profile = mkdtempSync(join(tmpdir(), 'ykt-debug-chrome-'));
const processRef = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(fn, timeout = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try { return await fn(); } catch (error) { lastError = error; await sleep(120); }
  }
  throw lastError || new Error('Timed out');
}

class Cdp {
  constructor(url) {
    this.sequence = 0; this.pending = new Map(); this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function createPage(url) {
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Runtime.enable');
  return page;
}

async function waitFor(page, expression, timeout = 12000) {
  return retry(async () => {
    const value = await page.evaluate(expression);
    if (!value) throw new Error(`Condition not met: ${expression}`);
    return value;
  }, timeout);
}

let teacher;
let student;
try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  });
  teacher = await createPage(`${appOrigin}/debug/teacher.html`);
  student = await createPage(`${appOrigin}/lesson/fullscreen/v3/mock-lesson/exercise/3?ykt_mock=1`);
  await waitFor(teacher, "document.querySelectorAll('.slide-thumb').length === 6");
  await waitFor(student, "Boolean(window.__YKT_MOCK__ && window.__YKT_CLASSROOM__)");
  await waitFor(teacher, "document.querySelector('#student-dot').classList.contains('online')");

  await teacher.evaluate("document.querySelectorAll('.slide-thumb')[1].click(); document.querySelector('#publish-question').click(); true");
  const readableCapture = await teacher.evaluate("decodeURIComponent(document.querySelector('#teacher-slide-image').src).includes('这是一道测试题，选A')");
  if (!readableCapture) throw new Error('Readable Chinese question text is missing from the slide capture source');
  const question = await waitFor(student, "!document.querySelector('#answer-card').hidden && document.querySelector('#problem-body').textContent");
  if (!question.includes('选A')) throw new Error(`Unexpected student question: ${question}`);
  await student.evaluate("document.querySelector('[data-key=\"A\"]').click(); document.querySelector('#mock-submit').click(); true");
  const answer = await waitFor(teacher, "document.querySelector('.answer-item')?.textContent || ''");
  if (!answer.includes('90002') || !answer.includes('A')) throw new Error(`Unexpected teacher answer: ${answer}`);
  await waitFor(student, "Boolean(document.querySelector('#ykt-btn-auto-answer'))");
  await student.evaluate("document.querySelector('#ykt-btn-auto-answer').click(); true");
  await teacher.evaluate("document.querySelectorAll('.slide-thumb')[2].click(); document.querySelector('#publish-question').click(); true");
  const automaticAnswer = await waitFor(teacher, "[...document.querySelectorAll('.answer-item')].map(node => node.textContent).find(text => text.includes('90003')) || ''", 15000);
  if (!automaticAnswer.includes('90003')) throw new Error(`Automatic answer was not returned: ${automaticAnswer}`);
  console.log('Browser flow passed: PPT delivery, manual answer and helper automatic answer all reached the teacher page.');
} finally {
  teacher?.close(); student?.close();
  if (processRef.exitCode == null) {
    processRef.kill('SIGTERM');
    await Promise.race([once(processRef, 'exit'), sleep(2000)]);
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
