import tpl from './ai.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { formatProblemForAI, formatProblemForDisplay, parseAIAnswer } from '../../tsm/ai-format.js';
import { queryDeepSeek } from '../../ai/deepseek.js';
import { submitAnswer } from '../../tsm/answer.js';
import { showAutoAnswerPopup } from '../panels/auto-answer-popup.js';

let mounted = false;
let root;

function $(sel) {
  return document.querySelector(sel);
}

export function mountAIPanel() {
  if (mounted) return root;
  const host = document.createElement('div');
  host.innerHTML = tpl;
  document.body.appendChild(host.firstElementChild);
  root = document.getElementById('ykt-ai-answer-panel');

  $('#ykt-ai-close')?.addEventListener('click', () => showAIPanel(false));
  $('#ykt-ai-ask')?.addEventListener('click', askAIForCurrent);

  mounted = true;
  return root;
}

window.addEventListener('ykt:open-ai', () => {
  showAIPanel(true);          // 打开面板
  // 可选：再次同步当前题面
  // renderQuestion(); // 若 renderQuestion 非导出，可在 showAIPanel(true) 内部触发
});

export function showAIPanel(visible = true) {
  mountAIPanel();
  root.classList.toggle('visible', !!visible);
  if (visible) renderQuestion();
}

export function setAILoading(v) {
  mountAIPanel();
  $('#ykt-ai-loading').style.display = v ? '' : 'none';
}

export function setAIError(msg = '') {
  mountAIPanel();
  const el = $('#ykt-ai-error');
  el.style.display = msg ? '' : 'none';
  el.textContent = msg || '';
}

export function setAIAnswer(content = '') {
  mountAIPanel();
  $('#ykt-ai-answer').textContent = content || '';
}

function renderQuestion() {
  const p = repo.currentSlideId ? repo.slides.get(repo.currentSlideId)?.problem : null;
  const problem = p || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);
  const text = problem ? formatProblemForDisplay(problem, ui.config.TYPE_MAP || {}) : '未选择题目';
  $('#ykt-ai-question').textContent = text;
}

export async function askAIForCurrent() {
  const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
  const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);
  if (!problem) return setAIError('未找到当前题目');

  setAIError('');
  setAILoading(true);
  setAIAnswer('');

  try {
    const q = formatProblemForAI(problem, ui.config.TYPE_MAP || {});
    const aiContent = await queryDeepSeek(q, ui.config.ai);
    const parsed = parseAIAnswer(problem, aiContent);

    setAILoading(false);
    if (!parsed) return setAIError('无法解析 AI 答案');

    setAIAnswer(`AI 建议答案：${JSON.stringify(parsed)}`);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = '提交答案';
    submitBtn.onclick = async () => {
      try {
        await submitAnswer(problem, parsed);
        ui.toast('提交成功');
        showAutoAnswerPopup(problem, typeof aiContent === 'string' ? aiContent : JSON.stringify(aiContent, null, 2));
      } catch (e) {
        ui.toast(`提交失败: ${e.message}`);
      }
    };
    $('#ykt-ai-answer').appendChild(document.createElement('br'));
    $('#ykt-ai-answer').appendChild(submitBtn);
  } catch (e) {
    setAILoading(false);
    setAIError(e.message);
  }
}
