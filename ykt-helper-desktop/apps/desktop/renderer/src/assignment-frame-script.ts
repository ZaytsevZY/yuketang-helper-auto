/** Only this local script can execute in the opaque-origin frame (nonce CSP).
 * All messages are bound to a document generation and checked by the parent. */
export function assignmentFrameScript(
  token: string,
  family: string | null,
): string {
  return `(() => {
    const token = ${JSON.stringify(token)}, family = ${JSON.stringify(family)};
    const send = (type, extra = {}) => parent.postMessage({ token, type, ...extra }, '*');
    let height = 0;
    const size = () => { const next = Math.ceil(document.body.getBoundingClientRect().height); if (next !== height) { height = next; send('height', { height }); } };
    new ResizeObserver(size).observe(document.body);
    size();
    const failed = new Map();
    for (const img of document.images) {
      const fail = () => { const url = img.getAttribute('src'); if (!url || failed.has(url)) return; failed.set(url, true); send('image', { url }); };
      img.addEventListener('error', fail, { once: true });
      img.addEventListener('load', size);
      if (img.complete && !img.naturalWidth) fail();
    }
    const placeholder = img => { const span = document.createElement('span'); span.className = 'missing'; span.textContent = img.alt || '图片加载失败'; img.replaceWith(span); size(); };
    addEventListener('message', event => {
      const d = event.data;
      if (event.source !== parent || !d || d.token !== token || d.type !== 'image-result' || !failed.has(d.url)) return;
      failed.delete(d.url);
      for (const img of Array.from(document.images)) if (img.getAttribute('src') === d.url) {
        if (typeof d.dataUrl === 'string' && /^data:image\\/(png|jpeg|gif|webp);base64,/.test(d.dataUrl)) { img.addEventListener('error', () => placeholder(img), { once: true }); img.src = d.dataUrl; }
        else placeholder(img);
      }
    });
    document.addEventListener('click', event => {
      const a = event.target instanceof Element ? event.target.closest('a') : null;
      if (!a) return;
      event.preventDefault();
      if (a.href) send('link', { url: a.href });
    });
    const encrypted = Array.from(document.querySelectorAll('.xuetangx-com-encrypted-font'));
    if (!encrypted.length) return;
    if (!family) { send('font-failed'); return; }
    const sample = encrypted.map(el => el.textContent || '').join('').slice(0, 2048);
    let timer;
    Promise.race([
      document.fonts.load('16px "' + family + '"', sample || ' '),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10000); })
    ]).then(faces => {
      if (!faces.length || !faces.every(f => f.status === 'loaded') || !encrypted.every(el => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '') === family)) throw new Error('font-not-applied');
      send('font-ready'); size();
    }).catch(() => send('font-failed')).finally(() => clearTimeout(timer));
  })();`;
}
