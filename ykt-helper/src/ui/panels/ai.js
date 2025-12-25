import tpl from './ai.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { queryAI, queryAIVision} from '../../ai/openai.js';
import { captureSlideImage } from '../../capture/screenshoot.js';
import { parseAIAnswer } from '../../tsm/ai-format.js';
import { hasActiveAIProfile} from '../../state/actions.js'
import { getCurrentMainPageSlideId, waitForVueReady, watchMainPageChange } from '../../core/vuex-helper.js';

const L = (...a) => console.log('[雨课堂助手][DBG][ai]', ...a);
const W = (...a) => console.warn('[雨课堂助手][WARN][ai]', ...a);

let mounted = false;
let root;
let preferredSlideFromPresentation = null; // 启用来自presentation的页面
let preferredSlidesFromPresentation = []; // 手动多页（仅用于“提问当前PPT”的多选）
let manualMultiSlidesArmed = false; // 只有手动触发时才允许多图

function renderSelectedPPTPreview() {
  const box = document.getElementById('ykt-ai-selected');
  const singleImg = document.getElementById('ykt-ai-selected-thumb');
  const thumbs = document.getElementById('ykt-ai-selected-thumbs');
  if (!box || !singleImg || !thumbs) return;

  // 清空多图容器
  thumbs.innerHTML = '';

  // 多页优先显示（来自手动多选）
  if (Array.isArray(preferredSlidesFromPresentation) && preferredSlidesFromPresentation.length > 0) {
    const items = preferredSlidesFromPresentation
      .map(s => ({ slideId: asIdStr(s.slideId), imageUrl: s.imageUrl || '' }))
      .filter(x => !!x.imageUrl);

    if (items.length > 0) {
      singleImg.style.display = 'none';
      for (const it of items) {
        const img = document.createElement('img');
        img.src = it.imageUrl;
        img.alt = `PPT ${it.slideId || ''}`;
        img.style.cssText = 'max-width:120px; max-height:80px; display:block; border-radius:4px;';
        thumbs.appendChild(img);
      }
      box.style.display = '';
      return;
    }
  }

  // 单页回退
  const url = preferredSlideFromPresentation?.imageUrl || '';
  if (url) {
    singleImg.src = url;
    singleImg.style.display = '';
    box.style.display = '';
  } else {
    singleImg.style.display = 'none';
    box.style.display = 'none';
  }
}

function ensureMathJax() {
  const mj = window.MathJax;
  const ok = !!(mj && mj.typesetPromise);
  if (!ok) console.warn('[雨课堂助手][WARN][ai] MathJax 未就绪（未通过 @require 预置？）');
  return Promise.resolve(ok);
}

function typesetTexIn(el) {
  const mj = window.MathJax;
  if (!el || !mj || typeof mj.typesetPromise !== 'function') return Promise.resolve(false);
  // 等待 MathJax 自己的启动就绪
  const ready = mj.startup && mj.startup.promise ? mj.startup.promise : Promise.resolve();
  return ready.then(() => mj.typesetPromise([el]).then(() => true).catch(() => false));
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLink(url = '') {
  try {
    const u = new URL(url, location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (_) {}
  return null; // 非 http/https 直接丢弃，避免 javascript: 等协议
}

function mdToHtml(mdRaw = '') {
  // 先整体转义，确保默认无 HTML 注入
  let md = escapeHtml(mdRaw).replace(/\r\n?/g, '\n');

  // 代码块（fenced）
  // ```lang\ncode\n```
  md = md.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const l = lang ? ` data-lang="${lang}"` : '';
    return `<pre class="ykt-md-code"><code${l}>${code}</code></pre>`;
  });

  // 行内代码 `
  md = md.replace(/`([^`]+?)`/g, (_, code) => `<code class="ykt-md-inline">${code}</code>`);

  // 标题 #, ##, ###, ####, #####, ######
  md = md
    .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // 引用块 >
  md = md.replace(/^(?:&gt;\s?.+(\n(?!\n).+)*)/gm, (block) => {
    const inner = block.replace(/^&gt;\s?/gm, '');
    return `<blockquote>${inner}</blockquote>`;
  });

  // 无序列表 
  md = md.replace(
    /(^(-|\*|\+)\s+.+(\n(?!\n).+)*)/gm,
    (block) => {
      const items = block
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^(-|\*|\+)\s+/.test(l))
        .map((l) => `<li>${l.replace(/^(-|\*|\+)\s+/, '')}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }
  );

  // 有序列表
  md = md.replace(
    /(^\d+\.\s+.+(\n(?!\n).+)*)/gm,
    (block) => {
      const items = block
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^\d+\.\s+/.test(l))
        .map((l) => `<li>${l.replace(/^\d+\.\s+/, '')}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }
  );

  // 粗体/斜体
  md = md.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  md = md.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  md = md.replace(/_([^_]+?)_/g, '<em>$1</em>');

  // 水平线
  md = md.replace(/^\s*([-*_]){3,}\s*$/gm, '<hr/>');

  // 链接 [text](url)
  md = md.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_, text, url) => {
    const safe = safeLink(url);
    if (!safe) return text; // 不安全则降级为纯文本
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // 段落：把非块级标签之外的连续文字块包成 <p>
  const lines = md.split('\n');
  const out = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    out.push(`<p>${buf.join('<br/>')}</p>`);
    buf = [];
  };
  const isBlock = (s) => /^(<h[1-6]|<ul>|<ol>|<pre |<blockquote>|<hr\/>|<p>|<table|<div)/.test(s);
  for (const ln of lines) {
    if (!ln.trim()) { flush(); continue; }
    if (isBlock(ln)) { flush(); out.push(ln); }
    else { buf.push(ln); }
  }
  flush();
  return out.join('\n');
}

function findSlideAcrossPresentations(idStr) {
  for (const [, pres] of repo.presentations) { const arr = pres?.slides || []; const hit = arr.find(s => String(s.id) === idStr); if (hit) return hit; }
  return null;
}

// —— 运行时自愈：把 repo.slides 的数字键迁移为字符串键
function normalizeRepoSlidesKeys(tag = 'ai.mount') {
  try {
    if (!repo || !repo.slides || !(repo.slides instanceof Map)) {
      W('normalizeRepoSlidesKeys: repo.slides 不是 Map');
      return;
    }
    const beforeKeys = Array.from(repo.slides.keys());
    const nums = beforeKeys.filter(k => typeof k === 'number');
    let moved = 0;
    for (const k of nums) {
      const v = repo.slides.get(k);
      const ks = String(k);
      if (!repo.slides.has(ks)) {
        repo.slides.set(ks, v);
        moved++;
      }
    }
    const afterSample = Array.from(repo.slides.keys()).slice(0, 8);
    L(`[normalizeRepoSlidesKeys@${tag}] 总键=${beforeKeys.length}，数字键=${nums.length}，迁移为字符串=${moved}，sample=`, afterSample);
  } catch (e) {
    W('normalizeRepoSlidesKeys error:', e);
  }
}

function asIdStr(v) { return v == null ? null : String(v); }
function isMainPriority() {
  const v = ui?.config?.aiSlidePickPriority;
  const ret = !(v === 'presentation');
  L('isMainPriority?', { cfg: v, result: ret });
  return ret;
}
function fallbackSlideIdFromRecent() {
  try {
    if (repo.encounteredProblems?.length > 0) {
      const latest = repo.encounteredProblems.at(-1);
      const st = repo.problemStatus.get(latest.problemId);
      const sid = st?.slideId ? String(st.slideId) : null;
      L('fallbackSlideIdFromRecent', { latestProblemId: latest.problemId, sid });
      return sid;
    }
  } catch (e) { W('fallbackSlideIdFromRecent error:', e); }
  return null;
}
function $(sel) { return document.querySelector(sel); }

function getSlideByAny(id) {
  const sid = id == null ? null : String(id);
  if (!sid) return { slide: null, hit: 'none' };
  if (repo.slides.has(sid)) return { slide: repo.slides.get(sid), hit: 'string' };
  const cross = findSlideAcrossPresentations(sid);
  if (cross) { repo.slides.set(sid, cross); return { slide: cross, hit: 'cross-fill' }; }
  const asNum = Number.isNaN(Number(sid)) ? null : Number(sid);
  if (asNum != null && repo.slides.has(asNum)) {
    const v = repo.slides.get(asNum); repo.slides.set(sid, v);
    return { slide: v, hit: 'number→string-migrate' };
  }
  return { slide: null, hit: 'miss' };
}

export function mountAIPanel() {
  if (mounted) return root;

  normalizeRepoSlidesKeys('ai.mount');

  const host = document.createElement('div');
  host.innerHTML = tpl;
  document.body.appendChild(host.firstElementChild);
  root = document.getElementById('ykt-ai-answer-panel');

  $('#ykt-ai-close')?.addEventListener('click', () => showAIPanel(false));
  $('#ykt-ai-ask')?.addEventListener('click', askAIFusionMode);

  waitForVueReady().then(() => {
    watchMainPageChange((slideId, slideInfo) => {
      L('主界面页面切换事件', { slideId, slideInfoType: slideInfo?.type, problemID: slideInfo?.problemID, index: slideInfo?.index });
      preferredSlideFromPresentation = null;
      renderQuestion();
    });
  }).catch(e => {
    W('Vue 实例初始化失败，将使用备用方案:', e);
  });

  window.addEventListener('ykt:presentation:slide-selected', (ev) => {
    L('收到小窗选页事件', ev?.detail);
    const sid = asIdStr(ev?.detail?.slideId);
    const imageUrl = ev?.detail?.imageUrl || null;
    if (sid) preferredSlideFromPresentation = { slideId: sid, imageUrl };
    // 普通选页不应该保留手动多选
    preferredSlidesFromPresentation = [];
    manualMultiSlidesArmed = false;
    renderQuestion();
  });

  window.addEventListener('ykt:open-ai', () => {
    L('收到打开 AI 面板事件');
    showAIPanel(true);
  });

  window.addEventListener('ykt:ask-ai-for-slide', (ev) => {
    const detail = ev?.detail || {};
    const slideId = asIdStr(detail.slideId);
    const imageUrl = detail.imageUrl || '';
    L('收到“提问当前PPT”事件', { slideId, imageLen: imageUrl?.length || 0 });
    if (slideId) {
      preferredSlideFromPresentation = { slideId, imageUrl };
      // 单页提问不应该触发多选逻辑
      preferredSlidesFromPresentation = [];
      manualMultiSlidesArmed = false;
      const look = getSlideByAny(slideId);
      if (look.slide && imageUrl) look.slide.image = imageUrl;
      L('提问当前PPT: lookupHit=', look.hit, 'hasSlide=', !!look.slide);
    }
    showAIPanel(true);
    renderQuestion();
    renderSelectedPPTPreview();
  });

  // ===== 手动多页提问（来自课件面板多选）=====
  window.addEventListener('ykt:ask-ai-for-slides', (ev) => {
    const detail = ev?.detail || {};
    const slides = Array.isArray(detail.slides) ? detail.slides : [];
    if (!slides.length) return;
    if (detail.source !== 'manual') return; // 只允许手动路径进入

    preferredSlidesFromPresentation = slides
      .map(s => ({ slideId: asIdStr(s.slideId), imageUrl: s.imageUrl || '' }))
      .filter(s => !!s.slideId);
    manualMultiSlidesArmed = preferredSlidesFromPresentation.length > 0;

    // 预览仍保持单页逻辑：用第一张作为“已选择页面”的展示（不强制要求改 UI）
    const first = preferredSlidesFromPresentation[0];
    if (first?.slideId) {
      preferredSlideFromPresentation = { slideId: first.slideId, imageUrl: first.imageUrl || '' };
      const look = getSlideByAny(first.slideId);
      if (look.slide && first.imageUrl) look.slide.image = first.imageUrl;
    }

    L('收到手动多页提问事件', { count: preferredSlidesFromPresentation.length, armed: manualMultiSlidesArmed });
    showAIPanel(true);
    renderQuestion();
    renderSelectedPPTPreview();
  });

  mounted = true;
  L('mountAIPanel 完成, cfg.aiSlidePickPriority=', ui?.config?.aiSlidePickPriority);
  return root;
}

export function showAIPanel(v = true) {
  mountAIPanel();
  root.classList.toggle('visible', !!v);
  if (v) {
    renderQuestion();
    if (ui.config.aiAutoAnalyze) queueMicrotask(() => { askAIFusionMode(); });
  }
  const aiBtn = document.getElementById('ykt-btn-ai');
  if (aiBtn) aiBtn.classList.toggle('active', !!v);
  L('showAIPanel', { visible: v });
}

export function setAILoading(v) { $('#ykt-ai-loading').style.display = v ? '' : 'none'; }
export function setAIError(msg = '') {
  const el = $('#ykt-ai-error'); el.style.display = msg ? '' : 'none'; el.textContent = msg || '';
}
export function setAIAnswer(content = '') {
  const el = $('#ykt-ai-answer');
  if (!el) return;
  if (window.MathJax && window.MathJax.config == null) window.MathJax.config = {};
  window.MathJax = Object.assign(window.MathJax || {}, {
    tex: { inlineMath: [['$', '$'], ['\\(', '\\)']] }
  });
  el.innerHTML = content ? mdToHtml(content) : '';
  try {
    if (ui?.config?.iftex) {
      ensureMathJax().then((ok) => {
        if (!ok) { console.warn('[雨课堂助手][WARN][ai] MathJax 未就绪，跳过 typeset'); return; } 
        el.classList.add('tex-enabled');
        typesetTexIn(el).then(() => console.log('[雨课堂助手][DBG][ai] MathJax typeset 完成'));
      });
    } else {
      el.classList.remove('tex-enabled');
    }
  } catch (e) { /* 静默降级 */ }
}

function getCustomPrompt() {
  const el = $('#ykt-ai-custom-prompt'); return el ? (el.value.trim() || '') : '';
}

function _logMapLookup(where, id) {
  const sid = id == null ? null : String(id);
  const hasS = sid ? repo.slides.has(sid) : false;
  const nid = sid != null && !Number.isNaN(Number(sid)) ? Number(sid) : null;
  const hasN = nid != null ? repo.slides.has(nid) : false;
  const sample = (() => { try { return Array.from(repo.slides.keys()).slice(0, 8); } catch { return []; }})();
  L(`${where} -> lookup`, { id: sid, hasString: hasS, hasNumber: hasN, sampleKeys: sample });
}

function renderQuestion() {
  let displayText = '';
  let hasPageSelected = false;
  let selectionSource = '';
  let slide = null;

  if (preferredSlideFromPresentation?.slideId) {
    const sid = asIdStr(preferredSlideFromPresentation.slideId);
    _logMapLookup('renderQuestion(preferred from presentation)', sid);
    const look = getSlideByAny(sid);
    slide = look.slide;
    if (slide) {
      displayText = `来自课件面板：${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
      selectionSource = `课件浏览（传入/${look.hit}键命中）`;
      hasPageSelected = true;
    }
  }

  if (!slide) {
    const prio = isMainPriority();
    if (prio) {
      const mainSid = asIdStr(getCurrentMainPageSlideId());
      _logMapLookup('renderQuestion(main priority)', mainSid);
      const look = getSlideByAny(mainSid);
      slide = look.slide;
      if (slide) {
        displayText = `主界面当前页: ${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
        selectionSource = `主界面检测（${look.hit}键命中）`;
        displayText += slide.problem ? '\n📝 此页面包含题目' : '\n📄 此页面为普通内容页';
        hasPageSelected = true;
      }
    } else {
      const presentationPanel = document.getElementById('ykt-presentation-panel');
      const isOpen = presentationPanel && presentationPanel.classList.contains('visible');
      const curSid = asIdStr(repo.currentSlideId);
      L('renderQuestion(presentation priority)', { isOpen, curSid });
      if (isOpen && curSid) {
        _logMapLookup('renderQuestion(pres open, curSid)', curSid);
        const look = getSlideByAny(curSid);
        slide = look.slide;
        if (slide) {
          displayText = `课件面板选中: ${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
          selectionSource = `课件浏览面板（${look.hit}键命中）`;
          displayText += slide.problem ? '\n📝 此页面包含题目' : '\n📄 此页面为普通内容页';
          hasPageSelected = true;
        }
      } else {
        if (!slide && curSid) {
          _logMapLookup('renderQuestion(pres fallback curSid)', curSid);
          const look = getSlideByAny(curSid);
          slide = look.slide;
          if (slide) {
            displayText = `课件面板最近选中: ${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
            selectionSource = `课件浏览（兜底/${look.hit}键命中）`;
            hasPageSelected = true;
          }
        }
        if (!slide) {
          const fb = fallbackSlideIdFromRecent();
          if (fb) {
            _logMapLookup('renderQuestion(fallback recent)', fb);
            const look = getSlideByAny(fb);
            slide = look.slide;
            if (slide) {
              displayText = `最近题目关联页: ${slide.title || `第 ${slide.page || slide.index || ''} 页`}`;
              selectionSource = `最近题目（兜底/${look.hit}键命中）`;
              hasPageSelected = true;
            }
          }
        }
        if (!slide) {
          displayText = '未检测到当前页面\n💡 请在主界面或课件面板中选择页面。';
          selectionSource = '无';
        }
      }
    }
  }

  const el = document.querySelector('#ykt-ai-question-display');
  if (el) el.textContent = displayText;

  const img = document.getElementById('ykt-ai-selected-thumb');
  const box = document.getElementById('ykt-ai-selected');
  if (img && box) {
    renderSelectedPPTPreview();
  }
  const statusEl = document.querySelector('#ykt-ai-text-status');
  if (statusEl) {
    statusEl.textContent = hasPageSelected 
      ? `✓ 已选择页面（来源：${selectionSource}），可进行图像分析` 
      : '⚠ 请选择要分析的页面';
    statusEl.className = hasPageSelected ? 'text-status success' : 'text-status warning';
  }
}

export async function askAIFusionMode() {
  setAIError(''); setAILoading(true); setAIAnswer('');
  try {
    if (!hasActiveAIProfile(ui.config.ai)) throw new Error('请先在设置中配置 API Key');

    let currentSlideId = null;
    let slide = null;
    let selectionSource = '';
    let forcedImageUrl = null;

    if (preferredSlideFromPresentation?.slideId) {
      currentSlideId = asIdStr(preferredSlideFromPresentation.slideId);
      const look = getSlideByAny(currentSlideId);
      slide = look.slide;
      forcedImageUrl = preferredSlideFromPresentation.imageUrl || null;
      selectionSource = `课件浏览（传入/${look.hit}键命中）`;
      L('[ask] 使用presentation传入的页面:', { currentSlideId, lookupHit: look.hit, hasSlide: !!slide });
    }

    if (!slide) {
      const prio = isMainPriority();
      if (prio) {
        const mainSlideId = asIdStr(getCurrentMainPageSlideId());
        if (mainSlideId) {
          currentSlideId = mainSlideId;
          const look = getSlideByAny(currentSlideId);
          slide = look.slide;
          selectionSource = `主界面当前页面（${look.hit}键命中）`;
          L('[ask] 使用主界面当前页面:', { currentSlideId, lookupHit: look.hit, hasSlide: !!slide });
        }
      } else {
        const presentationPanel = document.getElementById('ykt-presentation-panel');
        const isOpen = presentationPanel && presentationPanel.classList.contains('visible');
        if (isOpen && repo.currentSlideId != null) {
          currentSlideId = asIdStr(repo.currentSlideId);
          const look = getSlideByAny(currentSlideId);
          slide = look.slide;
          selectionSource = `课件浏览面板（${look.hit}键命中）`;
          L('[ask] 使用课件面板选中的页面:', { currentSlideId, lookupHit: look.hit, hasSlide: !!slide });
        }
      }
    }

    if (!slide && repo.currentSlideId != null) {
      currentSlideId = asIdStr(repo.currentSlideId);
      const look = getSlideByAny(currentSlideId);
      slide = look.slide;
      selectionSource = selectionSource || `课件浏览（兜底/${look.hit}键命中）`;
      L('[ask] Fallback 使用 repo.currentSlideId:', { currentSlideId, lookupHit: look.hit, hasSlide: !!slide });
    }
    if (!slide) {
      const fb = fallbackSlideIdFromRecent();
      if (fb) {
        currentSlideId = asIdStr(fb);
        const look = getSlideByAny(currentSlideId);
        slide = look.slide;
        selectionSource = selectionSource || `最近题目（兜底/${look.hit}键命中）`;
        L('[ask] Fallback 使用 最近题目 slideId:', { currentSlideId, lookupHit: look.hit, hasSlide: !!slide });
      }
    }

    if (!currentSlideId || !slide) {
      throw new Error('无法确定要分析的页面。请在主界面打开一个页面，或在课件浏览中选择页面。');
    }

    L('[ask] 页面选择来源:', selectionSource, '页面ID:', currentSlideId, '页面信息:', slide);

    if (forcedImageUrl) {
      slide.image = forcedImageUrl; // 强制指定
      L('[ask] 使用传入 imageUrl');
    }

     // ===== 获取图片：仅手动多选时走多图；否则保持单图 =====
    let imageBase64OrList = null;
    if (manualMultiSlidesArmed && Array.isArray(preferredSlidesFromPresentation) && preferredSlidesFromPresentation.length > 0) {
      const ids = preferredSlidesFromPresentation.map(s => asIdStr(s.slideId)).filter(Boolean);
      ui.toast(`正在获取课件多页图片（共 ${ids.length} 页）...`, 2500);
      L('[ask] 手动多页截图开始', { ids });
      const images = [];
      for (const sid of ids) {
        const b64 = await captureSlideImage(sid);
        if (b64) images.push(b64);
      }
      if (images.length === 0) throw new Error('无法获取所选页面图片，请确保页面已加载完成');
      imageBase64OrList = images;
      // 消费一次：避免 aiAutoAnalyze 或后续调用误用多图
      manualMultiSlidesArmed = false;
      preferredSlidesFromPresentation = [];
      L('[ask] ✅ 手动多页截图完成', { got: images.length });
    } else {
      L('[ask] 获取页面图片...');
      ui.toast(`正在获取${selectionSource}图片...`, 2000);
      const imageBase64 = await captureSlideImage(currentSlideId);
      if (!imageBase64) throw new Error('无法获取页面图片，请确保页面已加载完成');
      imageBase64OrList = imageBase64;
      L('[ask] ✅ 页面图片获取成功，大小(KB)=', Math.round(imageBase64.length / 1024));
    }

    let textPrompt = `【页面说明】当前页面可能不是题目页；请结合用户提示作答。`;
    const customPrompt = getCustomPrompt();
    if (customPrompt) {
      textPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
      L('[ask] 用户自定义prompt:', customPrompt);
    }

    // ===== 题型 hint：仅当当前页面是题目时提供 =====
    let problemType = null;
    const problem = slide?.problem;
    if (problem && typeof problem.problemType !== 'undefined') {
      problemType = problem.problemType;
    }

    L('[ask] problemType hint:', problemType);

    ui.toast(`正在分析${selectionSource}内容...`, 3000);
    L('[ask] 调用 Vision API...');
    const aiContent = await queryAIVision(imageBase64OrList, textPrompt, ui.config.ai, {problemType,});

    setAILoading(false);
    L('[ask] Vision API调用成功, 内容长度=', aiContent?.length);

    // 若当前页有题目，尝试解析
    let parsed = null;
    if (problem) {
      parsed = parseAIAnswer(problem, aiContent);
      L('[ask] 解析结果:', parsed);
    }

    let displayContent = `${selectionSource}图像分析结果：\n${aiContent}`;
    if (customPrompt) {
      displayContent = `${selectionSource}图像分析结果（包含自定义要求）：\n${aiContent}`;
    }
    if (parsed && problem) {
      setAIAnswer(`${displayContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
    } else {
      if (!problem) displayContent += '\n\n💡 当前页面不是题目页面（或未识别到题目）。';
      setAIAnswer(displayContent);
    }
  } catch (e) {
    setAILoading(false);
    W('[ask] 页面分析失败:', e);
    setAIError(`页面分析失败: ${e.message}`);
  }
}

export async function askAIForCurrent() { return askAIFusionMode(); }
export async function askAIVisionForCurrent() { return askAIFusionMode(); }
export async function askAITextOnly() { return askAIFusionMode(); } // 暂时复用
