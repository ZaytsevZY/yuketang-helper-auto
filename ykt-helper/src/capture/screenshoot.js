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
    return await html2canvas(el, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff', // ✅ 设置背景色
      scale: 1, // ✅ 设置缩放比例
      width: Math.min(el.scrollWidth, 1200), // ✅ 限制宽度
      height: Math.min(el.scrollHeight, 800)  // ✅ 限制高度
    });
  } catch (e) {
    console.error('[captureProblemScreenshot] failed', e);
    return null;
  }
}

// 新增：获取问题页面截图的base64数据，供Vision API使用
export async function captureProblemForVision() {
  try {
    console.log('[captureProblemForVision] 开始截图...');
    const canvas = await captureProblemScreenshot();
    if (!canvas) {
      console.error('[captureProblemForVision] 截图失败');
      return null;
    }
    
    console.log('[captureProblemForVision] 截图成功，转换为base64...');
    
    // ✅ 转换为 JPEG 格式以减小文件大小
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    console.log('[captureProblemForVision] base64 长度:', base64.length);
    
    // ✅ 检查图片大小，如果太大则压缩
    if (base64.length > 1000000) { // 1MB
      console.log('[captureProblemForVision] 图片过大，进行压缩...');
      // 重新生成更小的图片
      const smallerBase64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
      console.log('[captureProblemForVision] 压缩后长度:', smallerBase64.length);
      return smallerBase64;
    }
    
    return base64;
  } catch (e) {
    console.error('[captureProblemForVision] failed', e);
    return null;
  }
}