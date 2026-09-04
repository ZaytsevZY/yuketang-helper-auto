(function loadDebugTarget() {
  'use strict';

  const params = new URLSearchParams(location.search);
  const externalInjection = params.get('inject') === 'external';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load debug script: ${src}`));
      document.body.appendChild(script);
    });
  }

  (async () => {
    if (!externalInjection) await loadScript('/dist/ykt-helper.debug.user.js');
    await loadScript('/debug/mock-data.js');
    window.dispatchEvent(new CustomEvent('ykt-mock:ready', {
      detail: { injectionMode: externalInjection ? 'external' : 'bundled' },
    }));
  })().catch((error) => {
    console.error('[YKT Test Lab] bootstrap failed', error);
    const log = document.querySelector('#mock-log');
    if (log) log.textContent += `bootstrap failed: ${error.message}\n`;
  });
})();
