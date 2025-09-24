import tpl from './ai.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { formatProblemForAI, formatProblemForDisplay, parseAIAnswer } from '../../tsm/ai-format.js';
import { queryKimi, queryKimiVision } from '../../ai/kimi.js';
import { submitAnswer } from '../../tsm/answer.js';
import { showAutoAnswerPopup } from '../panels/auto-answer-popup.js';
import { captureProblemForVision } from '../../capture/screenshoot.js'; // ✅ 静态导入

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

  // 关闭面板
  $('#ykt-ai-close')?.addEventListener('click', () => showAIPanel(false));
  // 手动点击按钮触发 AI 分析
  $('#ykt-ai-ask')?.addEventListener('click', askAIForCurrent);
  // Vision 模式按钮
  $('#ykt-ai-ask-vision')?.addEventListener('click', askAIVisionForCurrent);

  mounted = true;
  return root;
}

window.addEventListener('ykt:open-ai', () => {
  showAIPanel(true);          // 打开面板
});

export function showAIPanel(visible = true) {
  mountAIPanel();
  root.classList.toggle('visible', !!visible);

  if (visible) {
    renderQuestion();
    // 自动分析：只有开关打开时才调用
    if (ui.config.aiAutoAnalyze) {
      queueMicrotask(() => { askAIForCurrent(); });
    }
  }

  // 同步工具栏按钮状态
  const aiBtn = document.getElementById('ykt-btn-ai');
  if (aiBtn) aiBtn.classList.toggle('active', !!visible);
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

  const el = document.querySelector('#ykt-ai-question-input');
  if (el) {
    // 若用户已经编辑过则不覆盖；首次为空时才灌入默认题面
    if (!el.value.trim()) el.value = text;
  }
}

function getEditedQuestion() {
  const el = document.querySelector('#ykt-ai-question-input');
  const v = el ? el.value.trim() : '';
  return v;
}

// 新增：使用Vision模式询问AI
// 在 askAIVisionForCurrent 函数中添加更多调试信息
export async function askAIVisionForCurrent() {
  const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
  const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);

  setAIError('');
  setAILoading(true);
  setAIAnswer('');

  try {
    // 1. 检查 API Key
    if (!ui.config.ai.kimiApiKey) {
      throw new Error('请先在设置中配置 Kimi API Key');
    }

    // 2. 截取当前页面图像
    ui.toast('正在截取页面图像...', 2000);
    console.log('[Vision] 开始截图...');
    
    const imageBase64 = await captureProblemForVision();
    if (!imageBase64) {
      throw new Error('无法截取页面图像，请确保页面内容已加载完成');
    }
    
    console.log('[Vision] 截图完成，图像大小:', imageBase64.length);

    // 3. 准备文本提示
    const edited = getEditedQuestion();
    let textPrompt = edited && edited.length > 0
      ? `请分析图片并结合以下用户输入的题目信息作答。用户输入的题目信息是：\n\n${edited}\n\n请按“答案/解释”的格式返回。`
      : '请分析图片中的题目并给出答案。按照以下格式回答：\n答案: [你的答案]\n解释: [详细解释]';

    if (!edited && problem && problem.body) {
      const problemText = formatProblemForAI(problem, ui.config.TYPE_MAP || {});
      textPrompt = `请结合以下题目信息分析图片：\n\n${problemText}\n\n请仔细观察图片内容，给出准确答案。`;
    }

    // 4. 调用Vision API
    ui.toast('正在使用Vision模式分析...', 3000);
    console.log('[Vision] 调用API...');
    
    const aiContent = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
    
    setAILoading(false);
    console.log('[Vision] API调用成功');
    setAIAnswer(`Vision模式回答：\n${aiContent}`);

    // 5. 如果有题目对象，尝试解析答案并提供提交按钮
    if (problem) {
      const parsed = parseAIAnswer(problem, aiContent);
      if (parsed) {
        setAIAnswer(`Vision模式回答：\n${aiContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
        
        const submitBtn = document.createElement('button');
        submitBtn.textContent = '提交答案';
        submitBtn.onclick = async () => {
          try {
            await submitAnswer(problem, parsed);
            ui.toast('提交成功');
            showAutoAnswerPopup(problem, aiContent);
          } catch (e) {
            ui.toast(`提交失败: ${e.message}`);
          }
        };
        $('#ykt-ai-answer').appendChild(document.createElement('br'));
        $('#ykt-ai-answer').appendChild(submitBtn);
      } else {
        setAIAnswer(`Vision模式回答：\n${aiContent}\n\n注意：无法自动解析答案格式，请手动查看上述回答。`);
      }
    }

  } catch (e) {
    setAILoading(false);
    console.error('[Vision] 完整错误信息:', e);
    
    // ✅ 提供降级建议
    let errorMsg = `Vision模式失败: ${e.message}`;
    if (e.message.includes('400')) {
      errorMsg += '\n\n可能的解决方案：\n1. 检查 API Key 是否正确\n2. 尝试刷新页面后重试\n3. 使用普通文本模式';
    }
    
    setAIError(errorMsg);
  }
}

// 修改原有的askAIForCurrent，保持兼容
export async function askAIForCurrent() {
  const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
  const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);

  const edited = getEditedQuestion(); // ← 读取用户编辑内容

  // 若没有题面文本（用户也没编辑）且无法拿到 problem，则自动切到 Vision 模式
  if (!edited && (!problem || !problem.body)) {
    ui.toast('未检测到题目文本，自动使用Vision模式', 2000);
    return askAIVisionForCurrent();
  }

  setAIError('');
  setAILoading(true);
  setAIAnswer('');

  try {
    // 1) 构造要问 AI 的文本：优先使用“用户编辑”的题面
    const q = edited || formatProblemForAI(problem, ui.config.TYPE_MAP || {});
    // 2) 请求
    const aiContent = await queryKimi(q, ui.config.ai);

    // 3) 若有 problem，尝试解析并提供“提交答案”
    let parsed = null;
    if (problem) parsed = parseAIAnswer(problem, aiContent);

    setAILoading(false);

    if (parsed) {
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
      document.querySelector('#ykt-ai-answer').appendChild(document.createElement('br'));
      document.querySelector('#ykt-ai-answer').appendChild(submitBtn);
    } else {
      // 无法解析就直接把原文显示给用户
      setAIAnswer(typeof aiContent === 'string' ? aiContent : JSON.stringify(aiContent, null, 2));
    }
  } catch (e) {
    setAILoading(false);
    setAIError(e.message);
  }
}
