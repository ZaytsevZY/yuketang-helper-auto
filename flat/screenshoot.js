// src/capture/screenshot.js
import { ensureHtml2Canvas } from '../core/env.js';

export async function captureProblemScreenshot() {
  try {
    const html2canvas = await ensureHtml2Canvas();
    const el =
      document.querySelector('.ques-title') ||
      document.querySelector('.problem-body') ||
      document.querySelector('.ppt-inner') ||
      document.querySelector('.ppt-courseware-inner') ||
      document.body;
    return await html2canvas(el);
  } catch (e) {
    console.error('[captureProblemScreenshot] failed', e);
    return null;
  }
}
