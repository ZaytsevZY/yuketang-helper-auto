import tpl from './problem-list.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { actions } from '../../state/actions.js';

let mounted = false;
let root;

function $(sel) {
  return document.querySelector(sel);
}

export function mountProblemListPanel() {
  if (mounted) return root;
  const wrap = document.createElement('div');
  wrap.innerHTML = tpl;
  document.body.appendChild(wrap.firstElementChild);
  root = document.getElementById('ykt-problem-list-panel');

  $('#ykt-problem-list-close')?.addEventListener('click', () => showProblemListPanel(false));
  window.addEventListener('ykt:open-problem-list', () => showProblemListPanel(true));

  mounted = true;
  updateProblemList();
  return root;
}

export function showProblemListPanel(visible = true) {
  mountProblemListPanel();
  root.classList.toggle('visible', !!visible);
  if (visible) updateProblemList();
}

export function updateProblemList() {
  mountProblemListPanel();
  const container = $('#ykt-problem-list');
  container.innerHTML = '';

  repo.encounteredProblems.forEach((e) => {
    const prob = repo.problems.get(e.problemId);
    const row = document.createElement('div');
    row.className = 'problem-row';

    const title = document.createElement('div');
    title.className = 'problem-title';
    title.textContent = (prob?.body || e.body || `题目 ${e.problemId}`).slice(0, 120);
    row.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'problem-meta';
    meta.textContent = `PID: ${e.problemId} / 类型: ${e.problemType}`;
    row.appendChild(meta);

    const actionsBar = document.createElement('div');
    actionsBar.className = 'problem-actions';

    const btnGo = document.createElement('button');
    btnGo.textContent = '查看';
    btnGo.onclick = () => actions.navigateTo(e.presentationId, e.slide?.id || e.slideId);
    actionsBar.appendChild(btnGo);

    const btnAI = document.createElement('button');
    btnAI.textContent = 'AI解答';
    btnAI.onclick = () => window.dispatchEvent(new CustomEvent('ykt:open-ai'));
    actionsBar.appendChild(btnAI);

    if (prob?.result) {
      const ok = document.createElement('span');
      ok.className = 'problem-done';
      ok.textContent = '已作答';
      actionsBar.appendChild(ok);
    }

    row.appendChild(actionsBar);
    container.appendChild(row);
  });
}
