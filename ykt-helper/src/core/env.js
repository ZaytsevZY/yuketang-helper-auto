// src/core/env.js
export const gm = {
  notify(opt) {
    if (typeof window.GM_notification === 'function') window.GM_notification(opt);
  },
  addStyle(css) {
    if (typeof window.GM_addStyle === 'function') window.GM_addStyle(css);
    else {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    }
  },
  xhr(opt) {
    if (typeof window.GM_xmlhttpRequest === 'function') return window.GM_xmlhttpRequest(opt);
    throw new Error('GM_xmlhttpRequest is not available');
  },
  uw: window.unsafeWindow || window,
};

export function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

export async function ensureHtml2Canvas() {
  const w = gm.uw || window;                         
  if (typeof w.html2canvas === 'function') return w.html2canvas;
  await loadScriptOnce('https://html2canvas.hertzen.com/dist/html2canvas.min.js');
  const h2c = w.html2canvas?.default || w.html2canvas;
  if (typeof h2c === 'function') return h2c;
  throw new Error('html2canvas 未正确加载');
}

export async function ensureJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  if (!window.jspdf?.jsPDF) throw new Error('jsPDF 未加载成功');
  return window.jspdf;
}

export function randInt(l, r) {
  return l + Math.floor(Math.random() * (r - l + 1));
}

export async function ensureFontAwesome() {
  const href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  if ([...document.styleSheets].some(s => s.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}