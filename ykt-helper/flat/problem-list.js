import tpl from './problem-list.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { actions } from '../../state/actions.js';

// ==== [ADD] 工具方法 & 取题接口（兼容旧版多端点） ====
function create(tag, cls){ const n=document.createElement(tag); if(cls) n.className=cls; return n; }

const HEADERS = () => ({
  'Content-Type': 'application/json',
  'xtbz': 'ykt',
  'X-Client': 'h5',
  'Authorization': 'Bearer ' + (typeof localStorage!=='undefined' ? (localStorage.getItem('Authorization')||'') : '')
});

async function httpGet(url){
  return new Promise((resolve,reject)=>{
    try{
      const xhr=new XMLHttpRequest();
      xhr.open('GET', url, true);
      const h=HEADERS(); for(const k in h) xhr.setRequestHeader(k,h[k]);
      xhr.onload=()=>{ try{ resolve(JSON.parse(xhr.responseText)); }catch{ reject(new Error('解析响应失败')); } };
      xhr.onerror=()=>reject(new Error('网络失败'));
      xhr.send();
    }catch(e){ reject(e); }
  });
}

// 兼容旧版：依次尝试多个端点，先成功先用
async function fetchProblemDetail(problemId){
  const candidates = [
    `/api/v3/lesson/problem/detail?problemId=${problemId}`,
    `/api/v3/lesson/problem/get?problemId=${problemId}`,
    `/mooc-api/v1/lms/problem/detail?problem_id=${problemId}`,
  ];
  for (const url of candidates){
    try{
      const resp = await httpGet(url);
      if (resp && typeof resp === 'object' && (resp.code === 0 || resp.success === true)){
        return resp;
      }
    }catch(_){ /* try next */ }
  }
  throw new Error('无法获取题目信息');
}

function pretty(obj){ try{ return JSON.stringify(obj, null, 2); }catch{ return String(obj); } }

// ==== [ADD] 渲染行上的按钮（查看 / AI解答 / 刷新题目） ====
function bindRowActions(row, e, prob){
  const actionsBar = row.querySelector('.problem-actions');

  const btnGo = create('button'); btnGo.textContent = '查看';
  btnGo.onclick = () => actions.navigateTo(e.presentationId, e.slide?.id || e.slideId);
  actionsBar.appendChild(btnGo);

  const btnAI = create('button'); btnAI.textContent = 'AI解答';
  btnAI.onclick = () => window.dispatchEvent(new CustomEvent('ykt:open-ai', { detail:{ problemId: e.problemId } }));
  actionsBar.appendChild(btnAI);

  const btnRefresh = create('button'); btnRefresh.textContent = '刷新题目';
  btnRefresh.onclick = async () => {
    row.classList.add('loading');
    try{
      const resp = await fetchProblemDetail(e.problemId);
      const detail = resp.data?.problem || resp.data || resp.result || {};
      const merged = Object.assign({}, prob||{}, detail, { problemId: e.problemId, problemType: e.problemType });
      repo.problems.set(e.problemId, merged);
      updateRow(row, e, merged);
      ui.toast('已刷新题目');
    }catch(err){
      ui.toast('刷新失败：' + (err?.message || err));
    }finally{
      row.classList.remove('loading');
    }
  };
  actionsBar.appendChild(btnRefresh);
}

// ==== [ADD] 渲染“题目信息 + 已作答答案 + 手动答题（含补交）” ====
import { submitAnswer } from '../../tsm/answer.js'; // 若已在顶部 import，忽略此行

function updateRow(row, e, prob){
  // 标题
  const title = row.querySelector('.problem-title');
  title.textContent = (prob?.body || e.body || prob?.title || `题目 ${e.problemId}`).slice(0, 120);

  // 元信息（含截止时间）
  const meta = row.querySelector('.problem-meta');
  const status = prob?.status || e.status || {};
  const answered = !!(prob?.result || status?.answered || status?.myAnswer);
  const endTime = Number(status?.endTime || prob?.endTime || e.endTime || 0) || undefined;
  meta.textContent = `PID: ${e.problemId} / 类型: ${e.problemType} / 状态: ${answered ? '已作答' : '未作答'} / 截止: ${endTime ? new Date(endTime).toLocaleString() : '未知'}`;

  // 容器
  let detail = row.querySelector('.problem-detail');
  if (!detail){ detail = create('div','problem-detail'); row.appendChild(detail); }
  detail.innerHTML = '';

  // ===== 显示“已作答答案” =====
  const answeredBox = create('div','answered-box');
  const ansLabel = create('div','label'); ansLabel.textContent = '已作答答案';
  const ansPre = create('pre'); ansPre.textContent = pretty(prob?.result || status?.myAnswer || {});
  answeredBox.appendChild(ansLabel); answeredBox.appendChild(ansPre);
  detail.appendChild(answeredBox);

  // ===== 手动答题（含补交） =====
  const editorBox = create('div','editor-box');
  const editLabel = create('div','label'); editLabel.textContent = '手动答题（JSON）';
  const textarea = create('textarea'); textarea.rows = 6; textarea.placeholder='{"answers":[...]}';
  textarea.value = pretty(prob?.result || status?.myAnswer || prob?.suggested || {});
  editorBox.appendChild(editLabel); editorBox.appendChild(textarea);

  const submitBar = create('div','submit-bar');

  // 保存（仅本地）
  const btnSaveLocal = create('button'); btnSaveLocal.textContent = '保存(本地)';
  btnSaveLocal.onclick = () => {
    try{
      const parsed = JSON.parse(textarea.value || '{}');
      const merged = Object.assign({}, prob||{}, { result: parsed });
      repo.problems.set(e.problemId, merged);
      ui.toast('已保存到本地列表');
      updateRow(row, e, merged);
    }catch(err){ ui.toast('JSON 解析失败：' + (err?.message || err)); }
  };
  submitBar.appendChild(btnSaveLocal);

  // 正常提交（过期则提示是否补交）
  const startTime = Number(status?.startTime || prob?.startTime || e.startTime || 0) || undefined;
  const btnSubmit = create('button'); btnSubmit.textContent = '提交';
  btnSubmit.onclick = async () => {
    try{
      const result = JSON.parse(textarea.value || '{}');
      row.classList.add('loading');
      const { route } = await submitAnswer(
        { problemId: e.problemId, problemType: e.problemType },
        result,
        { startTime, endTime }
      );
      ui.toast(route==='answer' ? '提交成功' : '补交成功');
      const merged = Object.assign({}, prob||{}, { result }, { status: { ...(prob?.status||{}), answered: true } });
      repo.problems.set(e.problemId, merged);
      updateRow(row, e, merged);
    }catch(err){
      if (err?.name === 'DeadlineError'){
        ui.confirm('已过截止，是否执行补交？').then(async ok => {
          if (!ok) return;
          try{
            const result = JSON.parse(textarea.value || '{}');
            row.classList.add('loading');
            await submitAnswer(
              { problemId: e.problemId, problemType: e.problemType },
              result,
              { startTime, endTime, forceRetry: true }
            );
            ui.toast('补交成功');
            const merged = Object.assign({}, prob||{}, { result }, { status: { ...(prob?.status||{}), answered: true } });
            repo.problems.set(e.problemId, merged);
            updateRow(row, e, merged);
          }catch(e2){ ui.toast('补交失败：' + (e2?.message||e2)); }
          finally{ row.classList.remove('loading'); }
        });
      }else{
        ui.toast('提交失败：' + (err?.message || err));
      }
    }finally{
      row.classList.remove('loading');
    }
  };
  submitBar.appendChild(btnSubmit);

  // 强制补交
  const btnForceRetry = create('button'); btnForceRetry.textContent = '强制补交';
  btnForceRetry.onclick = async () => {
    try{
      const result = JSON.parse(textarea.value || '{}');
      row.classList.add('loading');
      await submitAnswer(
        { problemId: e.problemId, problemType: e.problemType },
        result,
        { startTime, endTime, forceRetry: true }
      );
      ui.toast('补交成功');
      const merged = Object.assign({}, prob||{}, { result }, { status: { ...(prob?.status||{}), answered: true } });
      repo.problems.set(e.problemId, merged);
      updateRow(row, e, merged);
    }catch(err){ ui.toast('补交失败：' + (err?.message || err)); }
    finally{ row.classList.remove('loading'); }
  };
  submitBar.appendChild(btnForceRetry);

  editorBox.appendChild(submitBar);
  detail.appendChild(editorBox);
}


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

(repo.encounteredProblems || []).forEach((e) => {
  const prob = repo.problems.get(e.problemId) || {};
  const row = document.createElement('div');
  row.className = 'problem-row';

  // 标题和元信息容器，内容由 updateRow 填充
  const title = document.createElement('div');
  title.className = 'problem-title';
  row.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'problem-meta';
  row.appendChild(meta);

  const actionsBar = document.createElement('div');
  actionsBar.className = 'problem-actions';
  row.appendChild(actionsBar);

  // 绑定按钮（查看 / AI解答 / 刷新题目）
  bindRowActions(row, e, prob);

  // 渲染题目信息 + 已作答答案 + 手动提交/补交 UI
  updateRow(row, e, prob);

  container.appendChild(row);
});

}
