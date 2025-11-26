import tpl from './active-problems.html';
import { repo } from '../../state/repo.js';
import { actions } from '../../state/actions.js';

let mounted = false;
let root;

function $(sel) {
  return document.querySelector(sel);
}

export function mountActiveProblemsPanel() {
  if (mounted) return root;
  const wrap = document.createElement('div');
  wrap.innerHTML = tpl;
  document.body.appendChild(wrap.firstElementChild);
  root = document.getElementById('ykt-active-problems-panel');
  mounted = true;

  // 轻量刷新计时器
  setInterval(() => updateActiveProblems(), 1000);
  return root;
}

export function updateActiveProblems() {
  mountActiveProblemsPanel();
  const box = $('#ykt-active-problems');
  box.innerHTML = '';

  const now = Date.now();
  let hasActiveProblems = false; // 跟踪是否有活跃题目

  repo.problemStatus.forEach((status, pid) => {
    const p = repo.problems.get(pid);
    if (!p || p.result) return;

    const remain = Math.max(0, Math.floor((status.endTime - now) / 1000));
    
    // 如果倒计时结束（剩余时间为0），跳过显示这个卡片
    if (remain <= 0) {
      console.log(`[雨课堂助手][INFO][ActiveProblems] 题目 ${pid} 倒计时已结束，移除卡片`);
      return;
    }

    // 有至少一个活跃题目
    hasActiveProblems = true;

    const card = document.createElement('div');
    card.className = 'active-problem-card';

    const title = document.createElement('div');
    title.className = 'ap-title';
    title.textContent = (p.body || `题目 ${pid}`).slice(0, 80);
    card.appendChild(title);

    const info = document.createElement('div');
    info.className = 'ap-info';
    info.textContent = `剩余 ${remain}s`;
    card.appendChild(info);

    const bar = document.createElement('div');
    bar.className = 'ap-actions';

    const go = document.createElement('button');
    go.textContent = '查看';
    go.onclick = () => actions.navigateTo(status.presentationId, status.slideId);
    bar.appendChild(go);

    const ai = document.createElement('button');
    ai.textContent = 'AI 解答';
    ai.onclick = () => window.dispatchEvent(new CustomEvent('ykt:open-ai'));
    bar.appendChild(ai);

    card.appendChild(bar);
    box.appendChild(card);
  });

  // 如果没有活跃题目，隐藏整个面板容器
  if (!hasActiveProblems) {
    root.style.display = 'none';
  } else {
    root.style.display = '';
  }
}