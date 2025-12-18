import tpl from './presentation.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { actions } from '../../state/actions.js';
import { ensureHtml2Canvas, ensureJsPDF } from '../../core/env.js';

let mounted = false;
let host;
let staticReportReady = false; //已结束课程
const selectedSlideIds = new Set();
function findSlideAcrossPresentations(idStr) {
  for (const [, pres] of repo.presentations) { const arr = pres?.slides || []; const hit = arr.find(s => String(s.id) === idStr); if (hit) return hit; }
  return null;
}

const L = (...a) => console.log('[雨课堂助手][DBG][presentation]', ...a);
const W = (...a) => console.warn('[雨课堂助手][WARN][presentation]', ...a);

function $(sel) { return document.querySelector(sel); }

/** —— 运行时自愈：把 repo.slides 的数字键迁移为字符串键 —— */
function normalizeRepoSlidesKeys(tag = 'presentation.mount') {
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
      // 保留旧键以防其他模块还在用数字键；仅打印提示
    }
    const afterSample = Array.from(repo.slides.keys()).slice(0, 8);
    L(`[normalizeRepoSlidesKeys@${tag}] 总键=${beforeKeys.length}，数字键=${nums.length}，迁移为字符串=${moved}，sample=`, afterSample);
  } catch (e) {
    W('normalizeRepoSlidesKeys error:', e);
  }
}

// Map 查找
function getSlideByAny(id) {
  const sid = id == null ? null : String(id);
  if (!sid) return { slide: null, hit: 'none' };
  if (repo.slides.has(sid)) return { slide: repo.slides.get(sid), hit: 'string' };
  const cross = findSlideAcrossPresentations(sid);
  if (cross) { repo.slides.set(sid, cross); return { slide: cross, hit: 'cross-fill' }; }
  return { slide: null, hit: 'miss' };
}

// fetch静态PPT
function isStudentLessonReportPage() {
  return /\/v2\/web\/student-lesson-report\//.test(window.location.pathname);
}

function extractCoverIndex(url) {
  try {
    const m = decodeURIComponent(url).match(/cover(\d+)[_.]/i);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return null;
}

function getSlidesDocument() {
  if (document.querySelector('#content-page-wrap')) {
    return document;
  }
  for (let i = 0; i < window.frames.length; i++) {
    try {
      const d = window.frames[i].document;
      if (d && d.querySelector('#content-page-wrap')) {
        console.log('[雨课堂助手][DBG][presentation][static-report] 在子 frame 中找到了 content-page-wrap');
        return d;
      }
    } catch (e) {
    }
  }

  console.log('[雨课堂助手][DBG][presentation][static-report] 所有 frame 中都没有 content-page-wrap，退回顶层 document');
  return document;
}

function debugCheckSingleSlideImg() {
  const selector = "#content-page-wrap > div > aside > div.left-panel-scroll > div.left-panel-tab-content > div > section.slides-list > div.slide-item.f13.active-slide-item > div > img";
  const doc = getSlidesDocument();
  const img = doc.querySelector(selector);
  console.log('[雨课堂助手][DBG][presentation][static-report][debugCheck]', {
    href: window.location.href,
    hasContentPageWrap: !!document.querySelector('#content-page-wrap'),
    imgFound: !!img,
    selector
  });
  if (img) {
    console.log('[雨课堂助手][DBG][presentation][static-report][debugCheck] img.outerHTML =', img.outerHTML);
    console.log('[雨课堂助手][DBG][presentation][static-report][debugCheck] img.src =', img.currentSrc || img.src || img.getAttribute('src'));
  }
  return img;
}

function collectStaticSlideURLsFromDom() {
  const urls = new Set();

  // 先跑一遍最精确的 path 来看看当前 frame 到底有没有这张图
  const debugImg = debugCheckSingleSlideImg();
  if (debugImg) {
    const src = debugImg.currentSrc || debugImg.src || debugImg.getAttribute('src') || '';
    if (src &&
        /thu-private-qn\.yuketang\.cn\/slide\/\d+\//.test(src) &&
        /\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(src)) {
      urls.add(src);
    }
  }

  const doc = getSlidesDocument();
  const candidates = doc.querySelectorAll(
    'section.slides-list img, .slides-list img,' +
    'div.slide-item img,' +
    'img[alt="cover"]'
  );

  console.log('[雨课堂助手][DBG][presentation][static-report] DOM 候选 img 数量 =', candidates.length);

  candidates.forEach((img, idx) => {
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';

    console.log('[雨课堂助手][DBG][presentation][static-report] 检查 img#' + idx, {
      className: img.className,
      outerHTML: img.outerHTML.slice(0, 200) + (img.outerHTML.length > 200 ? '…' : ''),
      src
    });

    if (!src) return;

    if (/thu-private-qn\.yuketang\.cn\/slide\/\d+\//.test(src) &&
        /\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(src)) {
      urls.add(src);
    }
  });

  const arr = [...urls];
  console.log('[雨课堂助手][DBG][presentation][static-report] DOM 收集到 slide URL：', arr);
  return arr;
}


function ensureStaticReportPresentation() {
  if (!isStudentLessonReportPage()) return false;

  const pid = `static:${window.location.pathname}`;

  // 如果已经注入过，就不再重复扫描 & 打印日志，直接返回 false
  if (staticReportReady && repo.presentations.has(pid)) {
    return false;
  }

  const urlsFromDom = collectStaticSlideURLsFromDom();
  const urls = Array.from(new Set([...urlsFromDom]));

  if (!urls.length) {
    console.log('[雨课堂助手][DBG][presentation][static-report] 依然没有发现任何 slide URL');
    return false;
  }

  const withIndex = urls.map((u, i) => ({ u, idx: extractCoverIndex(u) ?? (i + 1) }));
  withIndex.sort((a, b) => a.idx - b.idx);

  const slides = withIndex.map(({ u, idx }) => {
    const id = `static-${idx}`;
    return { id, index: idx, title: `第 ${idx} 页`, thumbnail: u, image: u, problem: null };
  });

  const titleFromPage =
    document.querySelector('.lesson-title, .title, h1, .header-title')?.textContent?.trim() ||
    '静态课件（报告页）';

  const presentation = { id: pid, title: titleFromPage, slides };
  const existed = repo.presentations.has(pid);
  repo.presentations.set(pid, presentation);

  let filled = 0;
  for (const s of slides) {
    const sid = String(s.id);
    if (!repo.slides.has(sid)) {
      repo.slides.set(sid, s);
      filled++;
    }
  }
  if (!repo.currentPresentationId) repo.currentPresentationId = pid;

  staticReportReady = true; // ★ 标记为已完成

  console.log('[雨课堂助手][DBG][presentation][static-report] 已注入/更新 presentation', {
    pid,
    title: presentation.title,
    slideCount: slides.length,
    newSlidesFilled: filled,
    existed,
    sample: slides.slice(0, 3).map(s => s.image)
  });

  return true;
}


export function mountPresentationPanel() {
  if (mounted) return host;

  normalizeRepoSlidesKeys('presentation.mount');

  const wrapper = document.createElement('div');
  wrapper.innerHTML = tpl;
  document.body.appendChild(wrapper.firstElementChild);
  host = document.getElementById('ykt-presentation-panel');

  $('#ykt-presentation-close')?.addEventListener('click', () => showPresentationPanel(false));
  $('#ykt-open-problem-list')?.addEventListener('click', () => {
    showPresentationPanel(false);
    window.dispatchEvent(new CustomEvent('ykt:open-problem-list'));
  });

  $('#ykt-ask-current')?.addEventListener('click', () => {
    if (selectedSlideIds.size > 0) {
      const slides = [];
      for (const sid of selectedSlideIds) {
        const lookup = getSlideByAny(sid);
        const imageUrl = lookup.slide?.image || lookup.slide?.thumbnail || '';
        if (imageUrl) slides.push({ slideId: sid, imageUrl });
      }
      L('点击“提问当前PPT”(多选)', { selectedCount: selectedSlideIds.size, slidesCount: slides.length });
      if (slides.length === 0) return ui.toast('所选页面无可用图片', 2500);
      window.dispatchEvent(new CustomEvent('ykt:ask-ai-for-slides', {
        detail: { slides, source: 'manual' }
      }));
      window.dispatchEvent(new CustomEvent('ykt:open-ai'));
      return;
    }

    // ===== 否则走旧逻辑：单页 =====
    const sid = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
    const lookup = getSlideByAny(sid);
    L('点击“提问当前PPT”', { currentSlideId: sid, lookupHit: lookup.hit, hasSlide: !!lookup.slide });
    if (!sid) return ui.toast('请先在左侧选择一页PPT', 2500);
    const imageUrl = lookup.slide?.image || lookup.slide?.thumbnail || '';
    window.dispatchEvent(new CustomEvent('ykt:ask-ai-for-slide', {
      detail: { slideId: sid, imageUrl }
    }));
    window.dispatchEvent(new CustomEvent('ykt:open-ai'));
  });

  $('#ykt-download-current')?.addEventListener('click', downloadCurrentSlide);
  $('#ykt-download-pdf')?.addEventListener('click', downloadPresentationPDF);

  const cb = $('#ykt-show-all-slides');
  cb.checked = !!ui.config.showAllSlides;
  cb.addEventListener('change', () => {
    ui.config.showAllSlides = !!cb.checked;
    ui.saveConfig();
    L('切换 showAllSlides =', ui.config.showAllSlides);
    updatePresentationList();
  });

  mounted = true;
  L('mountPresentationPanel 完成');
  return host;
}

export function showPresentationPanel(visible = true) {
  mountPresentationPanel();
  host.classList.toggle('visible', !!visible);
  if (visible) {
    updatePresentationList();}

  const presBtn = document.getElementById('ykt-btn-pres');
  if (presBtn) presBtn.classList.toggle('active', !!visible);
  L('showPresentationPanel', { visible });
}

export function updatePresentationList() {
  mountPresentationPanel();

  try {
    if (isStudentLessonReportPage()) {
      ensureStaticReportPresentation();
    }
  } catch (e) {
    W('[static-report] 检测/注入失败：', e);
  }

  if (!window.__ykt_static_dom_mo) {
    window.__ykt_static_dom_mo = true;
    let times = 0;

    const mo = new MutationObserver(() => {
      if (!isStudentLessonReportPage()) return;
      if (++times > 20) return; 

      console.log('[雨课堂助手][DBG][presentation][static-report] DOM 变更，尝试重新收集 slide URL (times =', times, ')');
      const injected = ensureStaticReportPresentation();
      if (injected) {
        console.log('[雨课堂助手][DBG][presentation][static-report] DOM 中已找到 slide，停止监听并刷新面板');
        try { mo.disconnect(); } catch (e) {}
        updatePresentationList();
      }
    });

    const rootSelector = "#content-page-wrap > div > aside > div.left-panel-scroll > div.left-panel-tab-content > div > section.slides-list";
    let target = document.querySelector(rootSelector) || document.querySelector('section.slides-list') || document.body;

    console.log('[雨课堂助手][DBG][presentation][static-report] MutationObserver 监听目标：', {
      useBody: target === document.body,
      hasSlidesList: target !== document.body
    });

    mo.observe(target, { childList: true, subtree: true });
  }

  const listEl = document.getElementById('ykt-presentation-list');
  if (!listEl) { W('updatePresentationList: 缺少容器'); return; }

  listEl.innerHTML = '';

  if (repo.presentations.size === 0) {
    listEl.innerHTML = '<p class="no-presentations">暂无课件记录</p>';
    W('无 presentations');
    return;
  }

  const currentPath = window.location.pathname;
  const m = currentPath.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
  const currentLessonFromURL = m ? m[1] : null;
  L('过滤课件', { currentLessonFromURL, repoCurrentLessonId: repo.currentLessonId });

  const filtered = new Map();
  for (const [id, p] of repo.presentations) {
    if (currentLessonFromURL && repo.currentLessonId && currentLessonFromURL === repo.currentLessonId) {
      filtered.set(id, p);
    } else if (!currentLessonFromURL) {
      filtered.set(id, p);
    } else if (currentLessonFromURL === repo.currentLessonId) {
      filtered.set(id, p);
    }
  }

  const presentationsToShow = filtered.size > 0 ? filtered : repo.presentations;
  L('展示课件数量=', presentationsToShow.size);

  try {
    let filled = 0, total = 0;
    for (const [, pres] of presentationsToShow) {
      const arr = pres?.slides || [];
      total += arr.length;
      for (const s of arr) {
        const sid = String(s.id);
        if (!repo.slides.has(sid)) { repo.slides.set(sid, s); filled++; }
      }
    }
    const sample = Array.from(repo.slides.keys()).slice(0, 8);
    L('[hydrate slides → repo.slides]', { filled, totalVisibleSlides: total, sampleKeys: sample });
  } catch (e) {
    W('hydrate repo.slides 失败：', e);
  }

  for (const [id, presentation] of presentationsToShow) {
    const cont = document.createElement('div');
    cont.className = 'presentation-container';

    const titleEl = document.createElement('div');
    titleEl.className = 'presentation-title';
    titleEl.innerHTML = `
      <span>${presentation.title || `课件 ${id}`}</span>
      <i class="fas fa-download download-btn" title="下载课件"></i>
    `;
    cont.appendChild(titleEl);

    titleEl.querySelector('.download-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      L('点击下载课件', { presId: String(presentation.id) });
      downloadPresentation(presentation);
    });

    const slidesWrap = document.createElement('div');
    slidesWrap.className = 'slide-thumb-list';

    const showAll = !!ui.config.showAllSlides;
    const slides = (presentation.slides || []);
    const slidesToShow = showAll ? slides : slides.filter(s => s.problem);

    const currentIdStr = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
    L('渲染课件缩略图', {
      presId: String(presentation.id),
      slidesTotal: slides.length,
      slidesShown: slidesToShow.length,
      currentSlideId: currentIdStr
    });

    for (const s of slidesToShow) {
      const presIdStr = String(presentation.id);
      const slideIdStr = String(s.id);

      const thumb = document.createElement('div');
      thumb.className = 'slide-thumb';
      thumb.dataset.slideId = slideIdStr;

      if (currentIdStr && slideIdStr === currentIdStr) thumb.classList.add('active');

      if (s.problem) {
        const pid = s.problem.problemId;
        const status = repo.problemStatus.get(pid);
        if (status) thumb.classList.add('unlocked');
        if (s.problem.result) thumb.classList.add('answered');
      }

      thumb.addEventListener('click', (ev) => {
        // ===== Ctrl/Cmd 多选：不改变 currentSlideId，不触发导航，仅切换 selected =====
        if (ev && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          if (selectedSlideIds.has(slideIdStr)) {
            selectedSlideIds.delete(slideIdStr);
            thumb.classList.remove('selected');
          } else {
            selectedSlideIds.add(slideIdStr);
            thumb.classList.add('selected');
          }
          L('缩略图多选切换', { slideIdStr, selectedCount: selectedSlideIds.size });
          return;
        }

        // ===== 普通点击：沿用原逻辑，并清空多选 =====
        selectedSlideIds.clear();
        slidesWrap.querySelectorAll('.slide-thumb.selected').forEach(el => el.classList.remove('selected'));

        repo.currentPresentationId = presIdStr;
        repo.currentSlideId = slideIdStr;

        slidesWrap.querySelectorAll('.slide-thumb.active').forEach(el => el.classList.remove('active'));
        thumb.classList.add('active');
        const actives = slidesWrap.querySelectorAll('.slide-thumb.active');
        const allIds = Array.from(slidesWrap.querySelectorAll('.slide-thumb')).map(x => x.dataset.slideId);
        L('高亮状态', { activeCount: actives.length, activeId: thumb.dataset.slideId, allIdsSample: allIds.slice(0, 10) });

        updateSlideView();

        if (!repo.slides.has(slideIdStr)) {
          const cross = findSlideAcrossPresentations(slideIdStr); if (cross) { repo.slides.set(slideIdStr, cross); L('click-fill repo.slides <- cross', { slideIdStr }); }
        }

        try {
          const keysSample = Array.from(repo.slides.keys()).slice(0, 8);
          const typeDist = keysSample.reduce((m, k) => (m[typeof k] = (m[typeof k] || 0) + 1, m), {});
          L('repo.slides keys sample:', keysSample, 'typeDist:', typeDist);
        } catch {}

        const detail = { slideId: slideIdStr, presentationId: presIdStr };
        L('派发事件 ykt:presentation:slide-selected', detail);
        window.dispatchEvent(new CustomEvent('ykt:presentation:slide-selected', { detail }));

        L('调用 actions.navigateTo ->', { presIdStr, slideIdStr });
        actions.navigateTo(presIdStr, slideIdStr);
      });

      const img = document.createElement('img');
      if (presentation.width && presentation.height) {
        img.style.aspectRatio = `${presentation.width}/${presentation.height}`;
      }
      img.src = s.thumbnail || '';
      img.alt = s.title || `第 ${s.page ?? ''} 页`;
      img.onerror = function () {
        W('缩略图加载失败，移除该项', { slideIdStr, src: img.src });
        if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
      };

      const idx = document.createElement('span');
      idx.className = 'slide-index';
      idx.textContent = s.index ?? '';

      thumb.appendChild(img);
      thumb.appendChild(idx);
      slidesWrap.appendChild(thumb);
    }

    cont.appendChild(slidesWrap);
    listEl.appendChild(cont);
  }
}

function downloadPresentation(presentation) {
  repo.currentPresentationId = String(presentation.id);
  L('downloadPresentation -> 设置 currentPresentationId', repo.currentPresentationId);
  downloadPresentationPDF();
}

export function updateSlideView() {
  mountPresentationPanel();
  const slideView = $('#ykt-slide-view');
  const problemView = $('#ykt-problem-view');
  slideView.querySelector('.slide-cover')?.classList.add('hidden');
  problemView.innerHTML = '';

  const curId = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
  const lookup = getSlideByAny(curId);
  L('updateSlideView', { curId, lookupHit: lookup.hit, hasInMap: !!lookup.slide });

  if (!curId) {
    slideView.querySelector('.slide-cover')?.classList.remove('hidden');
    return;
  }
  const slide = lookup.slide;
  if (!slide) {
    W('updateSlideView: 根据 curId 未取到 slide', { curId });
    return;
  }

  const cover = document.createElement('div');
  cover.className = 'slide-cover';
  const img = document.createElement('img');
  img.crossOrigin = 'anonymous';
  img.src = slide.image || slide.thumbnail || '';
  img.alt = slide.title || '';
  cover.appendChild(img);

  if (slide.problem) {
    const prob = slide.problem;
    const box = document.createElement('div');
    box.className = 'problem-box';
    const head = document.createElement('div');
    head.className = 'problem-head';
    head.textContent = prob.body || `题目 ${prob.problemId}`;
    box.appendChild(head);

    if (Array.isArray(prob.options) && prob.options.length) {
      const opts = document.createElement('div');
      opts.className = 'problem-options';
      prob.options.forEach((o) => {
        const li = document.createElement('div');
        li.className = 'problem-option';
        li.textContent = `${o.key}. ${o.value}`;
        opts.appendChild(li);
      });
      box.appendChild(opts);
    }
    problemView.appendChild(box);
  }

  slideView.innerHTML = '';
  slideView.appendChild(cover);
  slideView.appendChild(problemView);
}

async function downloadCurrentSlide() {
  const sid = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
  const lookup = getSlideByAny(sid);
  L('downloadCurrentSlide', { sid, lookupHit: lookup.hit, has: !!lookup.slide });
  if (!sid) return ui.toast('请先选择一页课件/题目');
  const slide = lookup.slide;
  if (!slide) return;

  try {
    const html2canvas = await ensureHtml2Canvas();
    const el = document.getElementById('ykt-slide-view');
    const canvas = await html2canvas(el, { useCORS: true, allowTaint: false });
    const a = document.createElement('a');
    a.download = `slide-${sid}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (e) {
    ui.toast(`截图失败: ${e.message}`);
  }
}

async function downloadPresentationPDF() {
  const pid = repo.currentPresentationId != null ? String(repo.currentPresentationId) : null;
  L('downloadPresentationPDF', { pid, hasPres: pid ? repo.presentations.has(pid) : false });
  if (!pid) return ui.toast('请先在左侧选择一份课件');
  const pres = repo.presentations.get(pid);
  if (!pres || !Array.isArray(pres.slides) || pres.slides.length === 0) {
    return ui.toast('未找到该课件的页面');
  }

  const showAll = !!ui.config.showAllSlides;
  const slides = pres.slides.filter(s => showAll || s.problem);
  if (slides.length === 0) return ui.toast('当前筛选下没有可导出的页面');

  try {
    await ensureJsPDF();
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('jsPDF 未加载成功');

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageW = 595, pageH = 842;
    const margin = 24;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      const url = s.image || s.thumbnail;
      if (!url) {
        if (i > 0) doc.addPage();
        continue;
      }
      const img = await loadImage(url);
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const r = Math.min(maxW / iw, maxH / ih);
      const w = Math.floor(iw * r);
      const h = Math.floor(ih * r);
      const x = Math.floor((pageW - w) / 2);
      const y = Math.floor((pageH - h) / 2);

      if (i > 0) doc.addPage();
      doc.addImage(img, 'PNG', x, y, w, h);
    }

    const name = (pres.title || `课件-${pid}`).replace(/[\\/:*?"<>|]/g, '_');
    doc.save(`${name}.pdf`);
  } catch (e) {
    ui.toast(`导出 PDF 失败：${e.message || e}`);
  }
}
