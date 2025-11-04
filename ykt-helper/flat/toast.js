// src/ui/toast.js
export function toast(message, duration = 2000) {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,.7); color: #fff; padding: 10px 20px;
    border-radius: 4px; z-index: 10000000; max-width: 80%;
  `;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .5s';
    setTimeout(() => el.remove(), 500);
  }, duration);
}
