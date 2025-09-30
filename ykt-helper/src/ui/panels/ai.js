import tpl from './ai.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { queryKimi, queryKimiVision } from '../../ai/kimi.js';
import { submitAnswer } from '../../tsm/answer.js';
import { showAutoAnswerPopup } from '../panels/auto-answer-popup.js';
import { captureProblemForVision } from '../../capture/screenshoot.js';
import { formatProblemForAI, formatProblemForDisplay, formatProblemForVision, parseAIAnswer } from '../../tsm/ai-format.js';

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
  // 使用融合模式
  $('#ykt-ai-ask')?.addEventListener('click', askAIFusionMode);

  mounted = true;
  return root;
}

window.addEventListener('ykt:open-ai', () => {
  showAIPanel(true);
});

export function showAIPanel(visible = true) {
  mountAIPanel();
  root.classList.toggle('visible', !!visible);

  if (visible) {
    renderQuestion();
    if (ui.config.aiAutoAnalyze) {
      queueMicrotask(() => { askAIFusionMode(); });
    }
  }

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

// 新增：获取用户自定义prompt
function getCustomPrompt() {
  const customPromptEl = $('#ykt-ai-custom-prompt');
  if (customPromptEl) {
    const customText = customPromptEl.value.trim();
    return customText || '';
  }
  return '';
}

function renderQuestion() {
  const p = repo.currentSlideId ? repo.slides.get(repo.currentSlideId)?.problem : null;
  const problem = p || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);
  
  let displayText = '当前页面题目';
  let hasTextInfo = false;
  
  if (problem) {
    const text = formatProblemForDisplay(problem, ui.config.TYPE_MAP || {});
    if (problem.body && problem.body.trim()) {
      displayText = text;
      hasTextInfo = true;
    } else {
      displayText = '未检测到题目文本，将使用图像识别';
    }
  }

  const el = document.querySelector('#ykt-ai-question-display');
  if (el) {
    el.textContent = displayText;
  }
  
  const statusEl = document.querySelector('#ykt-ai-text-status');
  if (statusEl) {
    statusEl.textContent = hasTextInfo ? '✓ 已检测到题目文本' : '⚠ 未检测到题目文本，将完全依靠图像识别';
    statusEl.className = hasTextInfo ? 'text-status success' : 'text-status warning';
  }
}

// 融合模式AI询问函数（文本+图像）- 支持自定义prompt
export async function askAIFusionMode() {
  const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
  const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);

  setAIError('');
  setAILoading(true);
  setAIAnswer('');

  try {
    if (!ui.config.ai.kimiApiKey) {
      throw new Error('请先在设置中配置 Kimi API Key');
    }

    ui.toast('正在截取页面图像...', 2000);
    console.log('[AI Panel] 使用融合模式分析（文本+图像）...');
    
    const imageBase64 = await captureProblemForVision();
    if (!imageBase64) {
      throw new Error('无法截取页面图像，请确保页面内容已加载完成');
    }
    
    console.log('[AI Panel] 截图完成，图像大小:', imageBase64.length);

    // 使用新的 formatProblemForVision 函数构建基础提示
    const hasTextInfo = problem && problem.body && problem.body.trim();
    let textPrompt = formatProblemForVision(problem, ui.config.TYPE_MAP || {}, hasTextInfo);

    // 获取用户自定义prompt并追加
    const customPrompt = getCustomPrompt();
    if (customPrompt) {
      textPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
      console.log('[AI Panel] 用户添加了自定义prompt:', customPrompt);
    }

    ui.toast('正在使用融合模式分析...', 3000);
    console.log('[AI Panel] 调用Vision API...');
    console.log('[AI Panel] 最终使用的提示:', textPrompt);
    
    const aiContent = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
    
    setAILoading(false);
    console.log('[AI Panel] 融合模式API调用成功');
    console.log('[AI Panel] AI回答:', aiContent);

    // 尝试解析答案
    let parsed = null;
    if (problem) {
      parsed = parseAIAnswer(problem, aiContent);
      console.log('[AI Panel] 解析结果:', parsed);
    }

    // 构建显示内容，包含自定义prompt信息
    let displayContent = `融合模式分析结果：\n${aiContent}`;
    if (customPrompt) {
      displayContent = `融合模式分析结果（包含自定义要求）：\n${aiContent}`;
    }

    if (parsed) {
      setAIAnswer(`${displayContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
      
      const submitBtn = document.createElement('button');
      submitBtn.textContent = '提交答案';
      submitBtn.className = 'ykt-btn ykt-btn-primary';
      submitBtn.onclick = async () => {
        try {
          if (!problem || !problem.problemId) {
            ui.toast('题目信息丢失，请刷新页面重试');
            return;
          }
          
          // ✅ 添加详细日志
          console.log('[AI Panel] 准备提交答案');
          console.log('[AI Panel] Problem:', problem);
          console.log('[AI Panel] Parsed:', parsed);
          
          await submitAnswer(problem, parsed);
          ui.toast('提交成功');
          showAutoAnswerPopup(problem, aiContent);
        } catch (e) {
          console.error('[AI Panel] 提交失败:', e);
          ui.toast(`提交失败: ${e.message}`);
        }
      };
      $('#ykt-ai-answer').appendChild(document.createElement('br'));
      $('#ykt-ai-answer').appendChild(submitBtn);
    } else {
      setAIAnswer(`${displayContent}\n\n⚠️ 无法自动解析答案格式，请检查AI回答是否符合要求格式。`);
    }

  } catch (e) {
    setAILoading(false);
    console.error('[AI Panel] 融合模式失败:', e);
    
    let errorMsg = `融合模式分析失败: ${e.message}`;
    if (e.message.includes('400')) {
      errorMsg += '\n\n可能的解决方案：\n1. 检查 API Key 是否正确\n2. 尝试刷新页面后重试\n3. 确保页面已完全加载';
    }
    
    setAIError(errorMsg);
  }
}

// 保留其他函数以向后兼容，但现在都指向融合模式
export async function askAIForCurrent() {
  return askAIFusionMode();
}

export async function askAIVisionForCurrent() {
  return askAIFusionMode();
}

// 保留纯文本模式函数但不在UI中使用
export async function askAITextOnly() {
  const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
  const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);

  if (!problem || !problem.body) {
    throw new Error('文本模式需要题目文本');
  }

  setAIError('');
  setAILoading(true);
  setAIAnswer('');

  try {
    const q = formatProblemForAI(problem, ui.config.TYPE_MAP || {});
    const aiContent = await queryKimi(q, ui.config.ai);

    let parsed = null;
    if (problem) parsed = parseAIAnswer(problem, aiContent);

    setAILoading(false);

    if (parsed) {
      setAIAnswer(`文本模式回答：\n${aiContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
    } else {
      setAIAnswer(`文本模式回答：\n${aiContent}`);
    }
  } catch (e) {
    setAILoading(false);
    setAIError(`文本模式失败: ${e.message}`);
  }
}