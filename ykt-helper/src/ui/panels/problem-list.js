import tpl from './problem-list.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { actions } from '../../state/actions.js';
import { submitAnswer } from '../../tsm/answer.js';

const L = (...a) => console.log('[YKT][DBG][problem-list]', ...a);
const W = (...a) => console.warn('[YKT][WARN][problem-list]', ...a);

function $(sel) { return document.querySelector(sel); }
function create(tag, cls){ const n=document.createElement(tag); if(cls) n.className=cls; return n; }
function pretty(obj){ try{ return JSON.stringify(obj, null, 2); }catch{ return String(obj); } }

// ========== 兼容新老端点的题目详情拉取（用于“刷新题目”按钮） ==========
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

// 依次尝试多个端点，先成功先用
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

// ========== 关键修复：从 presentations/slides 懒加载灌入题目 ==========
/**
 * 将所有可见课件中的题目页灌入 repo.problems / repo.encounteredProblems
 * 目的：绕过 XHR/fetch 拦截失效，直接从现有内存结构构建题目列表
 */
function hydrateProblemsFromPresentations() {
  try {
    const beforeCnt = repo.problems?.size || 0;
    const encBefore = (repo.encounteredProblems || []).length;
    const seen = new Set((repo.encounteredProblems || []).map(e => e.problemId));

    let foundSlides = 0, filledProblems = 0, addedEvents = 0;

    for (const [, pres] of repo.presentations) {
      const slides = pres?.slides || [];
      if (!slides.length) continue;
      for (const s of slides) {
        if (!s || !s.problem) continue;
        foundSlides++;
        const pid = s.problem.problemId || s.problem.id;
        if (!pid) continue;
        const pidStr = String(pid);

        // 填充 repo.problems
        if (!repo.problems.has(pidStr)) {
          // 归一化一个最小 problem 对象
          const normalized = {
            problemId: pidStr,
            problemType: s.problem.problemType || s.problem.type || s.problem.questionType || 'unknown',
            body: s.problem.body || s.problem.title || '',
            options: s.problem.options || [],
            result: s.problem.result || null,
            status: s.problem.status || {},
            startTime: s.problem.startTime,
            endTime: s.problem.endTime,
            slideId: String(s.id),
            presentationId: String(pres.id),
          };
          repo.problems.set(pidStr, Object.assign({}, s.problem, normalized));
          filledProblems++;
        }

        // 填充 repo.encounteredProblems（供 UI 构建列表）
        if (!seen.has(pidStr)) {
          seen.add(pidStr);
          (repo.encounteredProblems || (repo.encounteredProblems = [])).push({
            problemId: pidStr,
            problemType: s.problem.problemType || s.problem.type || s.problem.questionType || 'unknown',
            body: s.problem.body || s.problem.title || '',
            presentationId: String(pres.id),
            slideId: String(s.id),
            slide: s,
            endTime: s.problem.endTime,
            startTime: s.problem.startTime,
          });
          addedEvents++;
        }
      }
    }

    // 稍微稳定一下顺序：按 presentationId+slide.index 排序
    if (repo.encounteredProblems && repo.encounteredProblems.length) {
      repo.encounteredProblems.sort((a,b)=>{
        if (a.presentationId !== b.presentationId) return String(a.presentationId).localeCompare(String(b.presentationId));
        const ax = a.slide?.index ?? 0, bx = b.slide?.index ?? 0;
        return ax - bx;
      });
    }

    const afterCnt = repo.problems?.size || 0;
    const encAfter = (repo.encounteredProblems || []).length;
    L('[hydrateProblemsFromPresentations]', {
      foundSlides, filledProblems, addedEvents,
      problemsBefore: beforeCnt, problemsAfter: afterCnt,
      encounteredBefore: encBefore, encounteredAfter: encAfter,
      sampleProblems: Array.from(repo.problems.keys()).slice(0,8),
    });
  } catch (e) {
    W('hydrateProblemsFromPresentations error:', e);
  }
}

/**
 * 在无法从 repo.problems 命中时，跨 presentations 查找并回写
 */
function crossFindProblem(problemIdStr) {
  for (const [, pres] of repo.presentations) {
    const arr = pres?.slides || [];
    for (const s of arr) {
      const pid = s?.problem?.problemId || s?.problem?.id;
      if (pid && String(pid) === problemIdStr) {
        // 回写
        const normalized = Object.assign({},
          s.problem,
          {
            problemId: problemIdStr,
            problemType: s.problem.problemType || s.problem.type || s.problem.questionType || 'unknown',
            body: s.problem.body || s.problem.title || '',
            options: s.problem.options || [],
            result: s.problem.result || null,
            status: s.problem.status || {},
            startTime: s.problem.startTime,
            endTime: s.problem.endTime,
            slideId: String(s.id),
            presentationId: String(pres.id),
          }
        );
        repo.problems.set(problemIdStr, normalized);
        return { problem: normalized, slide: s, presentationId: String(pres.id) };
      }
    }
  }
  return null;
}

// ========== 行渲染与交互 ==========
function bindRowActions(row, e, prob){
  const actionsBar = row.querySelector('.problem-actions');

  // 查看：跳到对应的课件页
  const btnGo = create('button'); btnGo.textContent = '查看';
  btnGo.onclick = () => {
    const presId = e.presentationId || prob?.presentationId;
    const slideId = (e.slide?.id || e.slideId || prob?.slideId);
    L('查看题目 -> navigateTo', { presId, slideId });
    if (presId && slideId) actions.navigateTo(String(presId), String(slideId));
    else ui.toast('缺少跳转信息');
  };
  actionsBar.appendChild(btnGo);

  // AI 解答：打开 AI 面板并优先使用该题所在页（若拿得到）
  const btnAI = create('button'); btnAI.textContent = 'AI解答';
  btnAI.onclick = () => {
    const presId = e.presentationId || prob?.presentationId;
    const slideId = (e.slide?.id || e.slideId || prob?.slideId);
    if (slideId) {
      // 派发“提问当前PPT”以便 AI 面板优先识别该页
      window.dispatchEvent(new CustomEvent('ykt:ask-ai-for-slide', {
        detail: {
          slideId: String(slideId),
          imageUrl: repo.slides.get(String(slideId))?.image || repo.slides.get(String(slideId))?.thumbnail || ''
        }
      }));
    }
    window.dispatchEvent(new CustomEvent('ykt:open-ai', { detail:{ problemId: e.problemId } }));
  };
  actionsBar.appendChild(btnAI);

  // 刷新题目：从接口拉一次（用于补齐详情/答案状态）
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

function updateRow(row, e, prob){
  // 标题
  const title = row.querySelector('.problem-title');
  title.textContent = (prob?.body || e.body || prob?.title || `题目 ${e.problemId}`).slice(0, 120);

  // 元信息（含截止时间）
  const meta = row.querySelector('.problem-meta');
  const status = prob?.status || e.status || {};
  const answered = !!(prob?.result || status?.answered || status?.myAnswer);
  meta.textContent = `PID: ${e.problemId} / 类型: ${e.problemType} / 状态: ${answered ? '已作答' : '未作答'} / 截止: ${endTime ? new Date(endTime).toLocaleString() : '未知'}`;

  // 容器
  let detail = row.querySelector('.problem-detail');
  if (!detail){ detail = create('div','problem-detail'); row.appendChild(detail); }
  detail.innerHTML = '';

  // 已作答答案
  const answeredBox = create('div','answered-box');
  const ansLabel = create('div','label'); ansLabel.textContent = '已作答答案';
  const ansPre = create('pre'); ansPre.textContent = pretty(prob?.result || status?.myAnswer || {});
  answeredBox.appendChild(ansLabel); answeredBox.appendChild(ansPre);
  detail.appendChild(answeredBox);

  // 手动答题（含补交）
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
  const ps = repo.problemStatus?.get?.(e.problemId);
  const startTime = Number(
    status?.startTime ?? prob?.startTime ?? e.startTime ?? ps?.startTime ?? 0
  ) || undefined;
  const endTime = Number(
    status?.endTime   ?? prob?.endTime   ?? e.endTime   ?? ps?.endTime   ?? 0
  ) || undefined;
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

// ========== 面板生命周期 ==========
let mounted = false;
let root;

export function mountProblemListPanel() {
  if (mounted) return root;
  const wrap = document.createElement('div');
  wrap.innerHTML = tpl;
  document.body.appendChild(wrap.firstElementChild);
  root = document.getElementById('ykt-problem-list-panel');

  $('#ykt-problem-list-close')?.addEventListener('click', () => showProblemListPanel(false));
  window.addEventListener('ykt:open-problem-list', () => showProblemListPanel(true));

  mounted = true;

  // ★ 关键：首次挂载时就做一次灌入
  hydrateProblemsFromPresentations();
  updateProblemList();
  return root;
}

export function showProblemListPanel(visible = true) {
  mountProblemListPanel();
  root.classList.toggle('visible', !!visible);
  if (visible) {
    // 面板打开时再做一次灌入（确保课程切换后也能补齐）
    hydrateProblemsFromPresentations();
    updateProblemList();
  }
}

export function updateProblemList() {
  mountProblemListPanel();
  const container = $('#ykt-problem-list');
  container.innerHTML = '';

  // 如果还是空，再兜一次（以防外层刚刚把 presentations 更新完）
  if (!repo.encounteredProblems || repo.encounteredProblems.length === 0) {
    hydrateProblemsFromPresentations();
  }

  const list = (repo.encounteredProblems || []);
  L('updateProblemList', { count: list.length });

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'problem-empty';
    empty.textContent = '暂无题目（可尝试切换章节或刷新页面）';
    container.appendChild(empty);
    return;
  }

  list.forEach((e) => {
    // 若 repo.problems 没有，跨课件兜底找一次并回写
    let prob = repo.problems.get(e.problemId) || null;
    if (!prob) {
      const cross = crossFindProblem(String(e.problemId));
      if (cross) {
        prob = cross.problem;
        // 同步补全跳转信息
        e.presentationId = e.presentationId || cross.presentationId;
        e.slide = e.slide || cross.slide;
        e.slideId = e.slideId || cross.slide?.id;
        L('cross-fill problem', { pid: e.problemId, pres: e.presentationId, slideId: e.slideId });
      }
    }

    const row = document.createElement('div');
    row.className = 'problem-row';

    const title = document.createElement('div');
    title.className = 'problem-title';
    row.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'problem-meta';
    row.appendChild(meta);

    const actionsBar = document.createElement('div');
    actionsBar.className = 'problem-actions';
    row.appendChild(actionsBar);

    bindRowActions(row, e, prob || {});
    updateRow(row, e, prob || {});
    container.appendChild(row);
  });
}
