import tpl from './ai.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { queryKimi, queryKimiVision } from '../../ai/kimi.js';
import { submitAnswer } from '../../tsm/answer.js';
import { showAutoAnswerPopup } from '../panels/auto-answer-popup.js';
import { captureProblemForVision, captureSlideImage } from '../../capture/screenshoot.js';
import { formatProblemForAI, formatProblemForDisplay, formatProblemForVision, parseAIAnswer } from '../../tsm/ai-format.js';
import { getCurrentMainPageSlideId, waitForVueReady, watchMainPageChange } from '../../core/vuex-helper.js';

let mounted = false;
let root;
// 来自 presentation 的优先提示（一次性优先使用）
let preferredSlideFromPresentation = null;
const getPickPriority = () => (ui?.config?.aiSlidePickPriority || 'main'); // 'main' | 'presentation'

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

  // ✅ 新增：启动主界面页面切换监听
  waitForVueReady().then(() => {
    watchMainPageChange((slideId, slideInfo) => {
      console.log('[AI Panel] 主界面页面切换到:', slideId);
      // 自动更新显示
      renderQuestion();
    });
  }).catch(e => {
    console.warn('[AI Panel] Vue 实例初始化失败，将使用备用方案:', e);
  });

  mounted = true;
  return root;
}

window.addEventListener('ykt:open-ai', () => {
  showAIPanel(true);
});

// ✅ 来自 presentation 的“提问当前PPT”事件
window.addEventListener('ykt:ask-ai-for-slide', (ev) => {
  const detail = ev?.detail || {};
  const { slideId, imageUrl } = detail;
  if (slideId) {
    preferredSlideFromPresentation = { slideId, imageUrl };
    // 若有 URL，直接覆盖 repo 内该页的 image，确保后续 capture 使用该 URL
    const s = repo.slides.get(slideId);
    if (s && imageUrl) s.image = imageUrl;
  }
  // 打开并刷新 UI + 预览
  showAIPanel(true);
  renderQuestion();
  const img = document.getElementById('ykt-ai-selected-thumb');
  const box = document.getElementById('ykt-ai-selected');
  if (img && box) {
    img.src = preferredSlideFromPresentation?.imageUrl || '';
    box.style.display = preferredSlideFromPresentation?.imageUrl ? '' : 'none';
  }
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
  // ✅ 显示当前选择逻辑的状态
  let displayText = '';
  let hasPageSelected = false;
  let selectionSource = '';
  
  // 0. 若来自 presentation 的优先提示存在，则最高优先
  let slide = null;
  if (preferredSlideFromPresentation?.slideId) {
    slide = repo.slides.get(preferredSlideFromPresentation.slideId);
    if (slide) {
      displayText = `来自课件面板：${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
      selectionSource = '课件浏览（传入）';
      hasPageSelected = true;
    }
  }
  // 1. 若未命中优先提示，检查主界面
  if (!slide) {
    const prio = !!(ui?.config?.aiSlidePickPriority ?? true);
    if(prio){
      const mainSlideId = getCurrentMainPageSlideId();
      slide = mainSlideId ? repo.slides.get(mainSlideId) : null;
      if (slide) {
        displayText = `主界面当前页: ${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
        selectionSource = '主界面检测';
        if (slide.problem) {
          displayText += '\n📝 此页面包含题目';
        } else {
          displayText += '\n📄 此页面为普通内容页';
        }
        hasPageSelected = true;
      }
    }
    
    else {
      // 2. 检查课件面板选择
      const presentationPanel = document.getElementById('ykt-presentation-panel');
      const isPresentationPanelOpen = presentationPanel && presentationPanel.classList.contains('visible');
      
      if (isPresentationPanelOpen && repo.currentSlideId) {
        slide = repo.slides.get(repo.currentSlideId);
        if (slide) {
          displayText = `课件面板选中: ${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
          selectionSource = '课件浏览面板';
          hasPageSelected = true;
          
          if (slide.problem) {
            displayText += '\n📝 此页面包含题目';
          } else {
            displayText += '\n📄 此页面为普通内容页';
          }
        }
      } else {
        displayText = `未检测到当前页面${presentationPanel}\n💡 请在课件面板（非侧边栏）中选择页面。`;
        selectionSource = '无';
      }
    }
  }

  const el = document.querySelector('#ykt-ai-question-display');
  if (el) {
    el.textContent = displayText;
  }
  // 同步预览块显示
  const img = document.getElementById('ykt-ai-selected-thumb');
  const box = document.getElementById('ykt-ai-selected');
  if (img && box) {
    if (preferredSlideFromPresentation?.imageUrl) {
      img.src = preferredSlideFromPresentation.imageUrl;
      box.style.display = '';
    } else {
      box.style.display = 'none';
    }
  }
  const statusEl = document.querySelector('#ykt-ai-text-status');
  if (statusEl) {
    statusEl.textContent = hasPageSelected 
      ? `✓ 已选择页面（来源：${selectionSource}），可进行图像分析` 
      : '⚠ 请选择要分析的页面';
    statusEl.className = hasPageSelected ? 'text-status success' : 'text-status warning';
  }
}

// 融合模式AI询问函数（仅图像分析）- 支持自定义prompt
export async function askAIFusionMode() {
  setAIError('');
  setAILoading(true);
  setAIAnswer('');

  try {
    if (!ui.config.ai.kimiApiKey) {
      throw new Error('请先在设置中配置 Kimi API Key');
    }

    // ✅ 智能选择当前页面：优先“presentation 传入”，其后主界面、最后课件面板
    let currentSlideId = null;
    let slide = null;
    let selectionSource = '';

    let forcedImageUrl = null;

    // 0) 优先使用 presentation 传入的 slide
    if (preferredSlideFromPresentation?.slideId) {
      currentSlideId = preferredSlideFromPresentation.slideId;
      slide = repo.slides.get(currentSlideId);
      forcedImageUrl = preferredSlideFromPresentation.imageUrl || null;
      selectionSource = '课件浏览（传入）';
      console.log('[AI Panel] 使用presentation传入的页面:', currentSlideId);
    }

    // 1) 其后：主界面当前页面
    if (!slide) {
      const prio = !!(ui?.config?.aiSlidePickPriority ?? true);
      if(prio){
        const mainSlideId = getCurrentMainPageSlideId();
        if (mainSlideId) {
        currentSlideId = mainSlideId;
        slide = repo.slides.get(currentSlideId);
        selectionSource = '主界面当前页面';
        console.log('[AI Panel] 使用主界面当前页面:', currentSlideId);
        }
      }
      else{
        const presentationPanel = document.getElementById('ykt-presentation-panel');
        const isPresentationPanelOpen = presentationPanel && presentationPanel.classList.contains('visible');
        
        if (isPresentationPanelOpen && repo.currentSlideId) {
          currentSlideId = repo.currentSlideId;
          slide = repo.slides.get(currentSlideId);
          selectionSource = '课件浏览面板';
          console.log('[AI Panel] 使用课件面板选中的页面:', currentSlideId);
        }
      }
    }
    else {
      // no-op: 已通过 presentation 选择
    }

    // 3. 检查是否成功获取到页面
    if (!currentSlideId || !slide) {
      throw new Error('无法确定要分析的页面。请在主界面打开一个页面，或在课件浏览中选择页面。');
    }

    console.log('[AI Panel] 页面选择来源:', selectionSource);
    console.log('[AI Panel] 分析页面ID:', currentSlideId);
    console.log('[AI Panel] 页面信息:', slide);

    // ✅ 直接使用选中页面的图片
    console.log('[AI Panel] 获取页面图片...');
    ui.toast(`正在获取${selectionSource}图片...`, 2000);
    
    let imageBase64 = null;

    // 若 presentation 传入了 URL，则优先用该 URL（captureSlideImage 会读 slide.image）
    if (forcedImageUrl) {
      // 确保 slide.image 是这张图，captureSlideImage 将基于 slideId 取图
      if (slide) slide.image = forcedImageUrl;
    }
    imageBase64 = await captureSlideImage(currentSlideId);
    
    if (!imageBase64) {
      throw new Error('无法获取页面图片，请确保页面已加载完成');
    }
    
    console.log('[AI Panel] ✅ 页面图片获取成功');
    console.log('[AI Panel] 图像大小:', Math.round(imageBase64.length / 1024), 'KB');

    // ✅ 构建纯图像分析提示（不使用题目文本）
    let textPrompt = `请仔细观察图片内容，识别并分析其中的题目：

1. 请先判断题目类型（单选题、多选题、填空题、主观题等）
2. 识别题干内容和选项（如果有）
3. 根据题目类型给出答案

答案格式要求：
- 单选题：答案: A
- 多选题：答案: A、B、C
- 填空题：答案: [填空内容]
- 主观题：答案: [完整回答]

请严格按照格式回答。`;

    // 获取用户自定义prompt并追加
    const customPrompt = getCustomPrompt();
    if (customPrompt) {
      textPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
      console.log('[AI Panel] 用户添加了自定义prompt:', customPrompt);
    }

    ui.toast(`正在分析${selectionSource}内容...`, 3000);
    console.log('[AI Panel] 调用Vision API...');
    console.log('[AI Panel] 使用的提示:', textPrompt);
    
    const aiContent = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
    
    setAILoading(false);
    console.log('[AI Panel] Vision API调用成功');
    console.log('[AI Panel] AI回答:', aiContent);

    // ✅ 尝试解析答案（如果当前页面有题目的话）
    let parsed = null;
    const problem = slide?.problem;
    if (problem) {
      parsed = parseAIAnswer(problem, aiContent);
      console.log('[AI Panel] 解析结果:', parsed);
    }

    // 构建显示内容
    let displayContent = `${selectionSource}图像分析结果：\n${aiContent}`;
    if (customPrompt) {
      displayContent = `${selectionSource}图像分析结果（包含自定义要求）：\n${aiContent}`;
    }

    if (parsed && problem) {
      setAIAnswer(`${displayContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
      
      // ✅ 只有当前页面有题目时才显示提交按钮
      const submitBtn = document.createElement('button');
      submitBtn.textContent = '提交答案';
      submitBtn.className = 'ykt-btn ykt-btn-primary';
      submitBtn.onclick = async () => {
        try {
          if (!problem || !problem.problemId) {
            ui.toast('当前页面没有可提交的题目');
            return;
          }
          
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
      // ✅ 如果当前页面没有题目，只显示分析结果
      if (!problem) {
        displayContent += '\n\n💡 当前页面不是题目页面，仅显示内容分析结果。';
      } else {
        displayContent += '\n\n⚠️ 无法自动解析答案格式，请检查AI回答是否符合要求格式。';
      }
      setAIAnswer(displayContent);
    }

  } catch (e) {
    setAILoading(false);
    console.error('[AI Panel] 页面分析失败:', e);
    // 失败后不清除 preferred，便于用户修正后重试
    let errorMsg = `页面分析失败: ${e.message}`;
    if (e.message.includes('400')) {
      errorMsg += '\n\n可能的解决方案：\n1. 检查 API Key 是否正确\n2. 尝试刷新页面后重试\n3. 确保页面已完全加载';
    }
    
    setAIError(errorMsg);
  }
}

/**
 * 获取主界面当前显示的页面ID
 * @returns {string|null} 当前页面的slideId
 */
// function getCurrentMainPageSlideId() {
//   try {
//     // 方法1：从当前最近遇到的问题获取（最可能是当前页面）
//     if (repo.encounteredProblems.length > 0) {
//       const latestProblem = repo.encounteredProblems.at(-1);
//       const problemStatus = repo.problemStatus.get(latestProblem.problemId);
//       if (problemStatus && problemStatus.slideId) {
//         console.log('[getCurrentMainPageSlideId] 从最近问题获取:', problemStatus.slideId);
//         return problemStatus.slideId;
//       }
//     }

//     // 方法2：从DOM结构尝试获取（雨课堂可能的DOM结构）
//     const slideElements = [
//       document.querySelector('[data-slide-id]'),
//       document.querySelector('.slide-wrapper.active'),
//       document.querySelector('.ppt-slide.active'),
//       document.querySelector('.current-slide')
//     ];

//     for (const el of slideElements) {
//       if (el) {
//         const slideId = el.dataset?.slideId || el.getAttribute('data-slide-id');
//         if (slideId) {
//           console.log('[getCurrentMainPageSlideId] 从DOM获取:', slideId);
//           return slideId;
//         }
//       }
//     }

//     // 方法3：如果没有找到，返回null
//     console.log('[getCurrentMainPageSlideId] 无法获取主界面当前页面');
//     return null;
    
//   } catch (e) {
//     console.error('[getCurrentMainPageSlideId] 获取失败:', e);
//     return null;
//   }
// }

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