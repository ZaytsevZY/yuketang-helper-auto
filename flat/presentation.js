import tpl from './presentation.html';
import { ui } from '../ui-api.js';
import { repo } from '../../state/repo.js';
import { actions } from '../../state/actions.js';
import { ensureHtml2Canvas, ensureJsPDF } from '../../core/env.js';

let mounted = false;
let host;

function $(sel) {
  return document.querySelector(sel);
}

export function mountPresentationPanel() {
  if (mounted) return host;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = tpl;
  document.body.appendChild(wrapper.firstElementChild);
  host = document.getElementById('ykt-presentation-panel');

  $('#ykt-presentation-close')?.addEventListener('click', () => showPresentationPanel(false));
  $('#ykt-open-problem-list')?.addEventListener('click', () => {
    showPresentationPanel(false);
    window.dispatchEvent(new CustomEvent('ykt:open-problem-list'));
  });
  $('#ykt-download-current')?.addEventListener('click', downloadCurrentSlide);
  $('#ykt-download-pdf')?.addEventListener('click', downloadPresentationPDF);

  const cb = $('#ykt-show-all-slides');
  cb.checked = !!ui.config.showAllSlides;
  cb.addEventListener('change', () => {
    ui.config.showAllSlides = !!cb.checked;
    ui.saveConfig();
    updatePresentationList();
  });

  mounted = true;
  return host;
}

// 在 showPresentationPanel 函数中添加按钮状态同步
export function showPresentationPanel(visible = true) {
  mountPresentationPanel();
  host.classList.toggle('visible', !!visible);
  if (visible) updatePresentationList();
  
  // 同步工具栏按钮状态
  const presBtn = document.getElementById('ykt-btn-pres');
  if (presBtn) presBtn.classList.toggle('active', !!visible);
}

// export function updatePresentationList() {
//   mountPresentationPanel();
//   const list = $('#ykt-presentation-list');
//   list.innerHTML = '';

//   const showAll = !!ui.config.showAllSlides;
//   const presEntries = [...repo.presentations.values()].slice(-ui.config.maxPresentations);

//   presEntries.forEach((pres) => {
//     const item = document.createElement('div');
//     item.className = 'presentation-item';

//     const title = document.createElement('div');
//     title.className = 'presentation-title';
//     title.textContent = pres.title || `课件 ${pres.id}`;
//     item.appendChild(title);

//     const slidesWrap = document.createElement('div');
//     slidesWrap.className = 'slide-thumb-list';

//     (pres.slides || []).forEach((s) => {
//       if (!showAll && !s.problem) return;

//       const thumb = document.createElement('div');
//       thumb.className = 'slide-thumb';
//       thumb.title = s.title || `第 ${s.page} 页`;
//       if (s.thumbnail) {
//         const img = document.createElement('img');
//         img.src = s.thumbnail;
//         img.alt = thumb.title;
//         thumb.appendChild(img);
//       } else {
//         thumb.textContent = s.title || String(s.page ?? '');
//       }

//       thumb.addEventListener('click', () => {
//         repo.currentPresentationId = pres.id;
//         repo.currentSlideId = s.id;
//         updateSlideView();
//       });

//       slidesWrap.appendChild(thumb);
//     });

//     item.appendChild(slidesWrap);
//     list.appendChild(item);
//   });
// }

//1.16.4 更新课件加载方法
export function updatePresentationList() {
  mountPresentationPanel();
  const listEl = document.getElementById('ykt-presentation-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (repo.presentations.size === 0) {
    listEl.innerHTML = '<p class="no-presentations">暂无课件记录</p>';
    return;
  }

  // 只显示当前课程的课件（基于 URL 与 repo.currentLessonId 过滤）
  const currentPath = window.location.pathname;
  const m = currentPath.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
  const currentLessonFromURL = m ? m[1] : null;

  const filtered = new Map();
  for (const [id, presentation] of repo.presentations) {
    // 若 URL 和 repo 同时能取到 lessonId，则要求一致
    if (currentLessonFromURL && repo.currentLessonId && currentLessonFromURL === repo.currentLessonId) {
      filtered.set(id, presentation);
    } else if (!currentLessonFromURL) {
      // 向后兼容：无法从 URL 提取课程 ID 时，展示全部
      filtered.set(id, presentation);
    } else if (currentLessonFromURL === repo.currentLessonId) {
      filtered.set(id, presentation);
    }
  }

  const presentationsToShow = filtered.size > 0 ? filtered : repo.presentations;

  for (const [id, presentation] of presentationsToShow) {
    const cont = document.createElement('div');
    cont.className = 'presentation-container';

    // 标题 + 下载按钮
    const titleEl = document.createElement('div');
    titleEl.className = 'presentation-title';
    titleEl.innerHTML = `
      <span>${presentation.title || `课件 ${id}`}</span>
      <i class="fas fa-download download-btn" title="下载课件"></i>
    `;
    cont.appendChild(titleEl);

    // 下载按钮
    titleEl.querySelector('.download-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadPresentation(presentation);
    });

    // 幻灯片缩略图区域
    const slidesWrap = document.createElement('div');
    slidesWrap.className = 'slide-thumb-list';

    // 是否显示全部页
    const showAll = !!ui.config.showAllSlides;
    const slidesToShow = showAll ? (presentation.slides || []) : (presentation.slides || []).filter(s => s.problem);

    for (const s of slidesToShow) {
      const thumb = document.createElement('div');
      thumb.className = 'slide-thumb';

      // 当前高亮
      if (s.id === repo.currentSlideId) thumb.classList.add('active');

      // 状态样式：解锁 / 已作答
      if (s.problem) {
        const pid = s.problem.problemId;
        const status = repo.problemStatus.get(pid);
        if (status) thumb.classList.add('unlocked');
        if (s.problem.result) thumb.classList.add('answered');
      }

      // 点击跳转
      thumb.addEventListener('click', () => {
        actions.navigateTo(presentation.id, s.id);
      });

      // 缩略图内容
      const img = document.createElement('img');
      if (presentation.width && presentation.height) {
        img.style.aspectRatio = `${presentation.width}/${presentation.height}`;
      }
      img.src = s.thumbnail || '';
      img.alt = s.title || `第 ${s.page ?? ''} 页`;
      // 关键：图片加载失败时移除（可能非本章节的页）
      img.onerror = function () {
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

// 课件下载入口：切换当前课件后调用现有 PDF 导出逻辑
function downloadPresentation(presentation) {
  // 先切到该课件，再复用“整册下载(PDF)”按钮逻辑
  repo.currentPresentationId = presentation.id;
  // 这里直接调用现有的 downloadPresentationPDF（定义在本文件尾部）
  // 若你希望仅下载题目页，可根据 ui.config.showAllSlides 控制
  downloadPresentationPDF();
}


export function updateSlideView() {
  mountPresentationPanel();
  const slideView = $('#ykt-slide-view');
  const problemView = $('#ykt-problem-view');
  slideView.querySelector('.slide-cover')?.classList.add('hidden');
  problemView.innerHTML = '';

  if (!repo.currentSlideId) {
    slideView.querySelector('.slide-cover')?.classList.remove('hidden');
    return;
  }
  const slide = repo.slides.get(repo.currentSlideId);
  if (!slide) return;

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
  if (!repo.currentSlideId) return ui.toast('请先选择一页课件/题目');
  const slide = repo.slides.get(repo.currentSlideId);
  if (!slide) return;

  try {
    const html2canvas = await ensureHtml2Canvas();
    const el = document.getElementById('ykt-slide-view');
    const canvas = await html2canvas(el, { useCORS: true, allowTaint: false });
    const a = document.createElement('a');
    a.download = `slide-${slide.id}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (e) {
    ui.toast(`截图失败: ${e.message}`);
  }
}

async function downloadPresentationPDF() {
  if (!repo.currentPresentationId) return ui.toast('请先在左侧选择一份课件');
  const pres = repo.presentations.get(repo.currentPresentationId);
  if (!pres || !Array.isArray(pres.slides) || pres.slides.length === 0) {
    return ui.toast('未找到该课件的页面');
  }

  // 是否导出全部页：沿用你面板的“切换全部/题目页”开关语义
  const showAll = !!ui.config.showAllSlides;
  const slides = pres.slides.filter(s => showAll || s.problem);
  if (slides.length === 0) return ui.toast('当前筛选下没有可导出的页面');

  try {
    // 1) 确保 jsPDF 就绪
    await ensureJsPDF();
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('jsPDF 未加载成功');

    // 2) A4 纸张（pt）：595 x 842（竖版）
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageW = 595, pageH = 842;
    // 页边距（视觉更好看）
    const margin = 24;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    // 简单的图片加载器（拿到原始宽高以保持比例居中）
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
        // 无图页可跳过，也可在此尝试 html2canvas 截图（复杂度更高，此处先跳过）
        if (i > 0) doc.addPage();
        continue;
      }
      // 3) 加载图片并按比例缩放到 A4
      const img = await loadImage(url);
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const r = Math.min(maxW / iw, maxH / ih);
      const w = Math.floor(iw * r);
      const h = Math.floor(ih * r);
      const x = Math.floor((pageW - w) / 2);
      const y = Math.floor((pageH - h) / 2);

      // 4) 首页直接画，后续页先 addPage
      if (i > 0) doc.addPage();
      // 通过 <img> 对象加图（jsPDF 自动推断类型；如需可改成 'PNG'）
      doc.addImage(img, 'PNG', x, y, w, h);
    }

    // 5) 文件名：保留课件标题或 id
    const name = (pres.title || `课件-${pres.id}`).replace(/[\\/:*?"<>|]/g, '_');
    doc.save(`${name}.pdf`);
  } catch (e) {
    ui.toast(`导出 PDF 失败：${e.message || e}`);
  }
}