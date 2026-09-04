import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAIAnswer } from '../src/tsm/ai-format.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const html = read('debug/index.html');
const teacher = read('debug/teacher.html');
const student = read('debug/student.html');
const teacherLogic = read('debug/teacher.js');
const bus = read('debug/classroom-bus.js');
const ppt = read('debug/ppt-fixtures.js');
const runtime = read('debug/mock-gm.js');
const fixtures = read('debug/mock-data.js');
const loader = read('debug/debug-loader.js');
const server = read('scripts/debug-server.mjs');
const logger = read('debug/local-logger.js');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(existsSync(resolve(root, 'dist/ykt-helper.debug.user.js')), 'stable debug bundle is missing');
expect(loader.includes('/dist/ykt-helper.debug.user.js'), 'loader does not reference the stable debug bundle');
expect(loader.includes("inject') === 'external'"), 'external injection mode is missing');
expect(student.indexOf('/debug/mock-gm.js') < student.indexOf('/debug/debug-loader.js'), 'transport mocks must load before the debug loader');
expect(student.indexOf('/debug/local-logger.js') < student.indexOf('/debug/mock-gm.js'), 'local logger must load before product and transport mocks');
expect(html.includes('/debug/teacher.html') && html.includes('/lesson/fullscreen/v3/'), 'role launcher links are missing');
expect(teacher.includes('teacher-slide-list') && teacher.includes('publish-question'), 'teacher controls are missing');
expect(student.includes('presentation-card') && student.includes('answer-card'), 'student presentation or answer view is missing');
for (const marker of ['lesson__header', 'cards__nav', 'page-exercise', 'problem-body', 'options-label', 'submit-btn']) {
  expect(student.includes(marker) || fixtures.includes(marker), `realistic host marker is missing: ${marker}`);
}
for (const api of ['__YKT_MOCK__', 'MockXMLHttpRequest', 'MockWebSocket', 'GM_xmlhttpRequest', 'setOnline', 'setCurrentSlide', 'getSnapshot']) {
  expect(runtime.includes(api), `mock runtime API is missing: ${api}`);
}
expect(runtime.includes('/__ykt_proxy__') && runtime.includes('gm:xhr-proxy'), 'GM requests are not connected to the local AI proxy');
expect(server.includes("new Set(['api.moonshot.cn'])"), 'AI proxy must remain restricted to api.moonshot.cn');
expect(server.includes('/__ykt_logs__') && logger.includes('[REDACTED_MEDIA_BASE64]'), 'redacted local log persistence is missing');
for (const signal of ['fetchtimeline', 'unlockproblem', 'lessonfinished', '/api/v3/lesson/problem/answer']) {
  expect(fixtures.includes(signal), `fixture signal is missing: ${signal}`);
}
for (const marker of ['BroadcastChannel', 'classroom-state', 'student-answer']) {
  expect(bus.includes(marker) || teacherLogic.includes(marker), `cross-tab classroom marker is missing: ${marker}`);
}
for (let page = 1; page <= 6; page += 1) {
  expect(existsSync(resolve(root, `debug/fixtures/test-ppt/slide-${page}.png`)), `rendered PPT page is missing: ${page}`);
  expect(ppt.includes(`page: ${page}`), `PPT fixture does not define page ${page}`);
}
const sampleProblem = { problemType: 1, options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }] };
expect(parseAIAnswer(sampleProblem, 'STATE: NO_PROMPT\nSUMMARY: no question') === null, 'NO_PROMPT must not become a suggested answer');
expect(JSON.stringify(parseAIAnswer(sampleProblem, '答案: A\n解释: test')) === '["A"]', 'explicit single-choice answer parsing failed');
expect(parseAIAnswer(sampleProblem, 'SUMMARY: A question-like page') === null, 'choice parser must not guess from descriptive text');
expect(parseAIAnswer(sampleProblem, '答案: S') === null, 'choice parser must reject options absent from the problem');
expect(JSON.stringify(parseAIAnswer({ ...sampleProblem, problemType: 2 }, '答案: A、S、C')) === '["A","C"]', 'multiple-choice parser must filter invalid options');

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log('Debug harness verification passed.');
