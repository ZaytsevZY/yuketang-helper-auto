import tpl from './tutorial.html';

let mounted = false;
let root;

function $(sel) { return document.querySelector(sel); }

export function mountTutorialPanel() {
  if (mounted) return root;
  const host = document.createElement('div');
  host.innerHTML = tpl;
  document.body.appendChild(host.firstElementChild);
  root = document.getElementById('ykt-tutorial-panel');

  $('#ykt-tutorial-close')?.addEventListener('click', () => showTutorialPanel(false));
  mounted = true;
  return root;
}

export function showTutorialPanel(visible = true) {
  mountTutorialPanel();
  root.classList.toggle('visible', !!visible);
}

export function toggleTutorialPanel() {
  mountTutorialPanel();
  const vis = root.classList.contains('visible');
  showTutorialPanel(!vis);

  const helpBtn = document.getElementById('ykt-btn-help');
  if (helpBtn) helpBtn.classList.toggle('active', !vis);
}
