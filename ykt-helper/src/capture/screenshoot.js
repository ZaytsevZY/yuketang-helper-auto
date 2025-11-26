// src/capture/screenshot.js
import { ensureHtml2Canvas } from '../core/env.js';
import { repo } from '../state/repo.js';

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
      backgroundColor: '#ffffff',
      scale: 1,
      width: Math.min(el.scrollWidth, 1200),
      height: Math.min(el.scrollHeight, 800)
    });
  } catch (e) {
    console.error('[captureProblemScreenshot] failed', e);
    return null;
  }
}

/**
 * 获取指定幻灯片的截图
 * @param {string} slideId - 幻灯片ID
 * @returns {Promise<string|null>} base64图片数据
 */
export async function captureSlideImage(slideId) {
  try {
    console.log('[captureSlideImage] 获取幻灯片图片:', slideId);
    
    const slide = repo.slides.get(slideId);
    if (!slide) {
      console.error('[captureSlideImage] 找不到幻灯片:', slideId);
      return null;
    }
    
    // 使用 cover 或 coverAlt 图片URL
    const imageUrl = slide.coverAlt || slide.cover;
    if (!imageUrl) {
      console.error('[captureSlideImage] 幻灯片没有图片URL');
      return null;
    }
    
    console.log('[captureSlideImage] 图片URL:', imageUrl);
    
    // 下载图片并转换为base64
    const base64 = await downloadImageAsBase64(imageUrl);
    
    if (!base64) {
      console.error('[captureSlideImage] 下载图片失败');
      return null;
    }
    
    console.log('[captureSlideImage] ✅ 成功获取图片, 大小:', Math.round(base64.length / 1024), 'KB');
    return base64;
    
  } catch (e) {
    console.error('[captureSlideImage] 失败:', e);
    return null;
  }
}

/**
 * 下载图片并转换为base64
 * @param {string} url - 图片URL
 * @returns {Promise<string|null>}
 */
async function downloadImageAsBase64(url) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous'; 
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          
          if (base64.length > 1000000) {
            console.log('[雨课堂助手][INFO][downloadImageAsBase64] 图片过大，进行压缩...');
            const compressed = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
            console.log('[雨课堂助手][INFO][downloadImageAsBase64] 压缩后大小:', Math.round(compressed.length / 1024), 'KB');
            resolve(compressed);
          } else {
            resolve(base64);
          }
        } catch (e) {
          console.error('[雨课堂助手][ERR][downloadImageAsBase64] Canvas处理失败:', e);
          resolve(null);
        }
      };
      
      img.onerror = (e) => {
        console.error('[雨课堂助手][ERR][downloadImageAsBase64] 图片加载失败:', e);
        resolve(null);
      };
      
      img.src = url;
      
    } catch (e) {
      console.error('[雨课堂助手][ERR][downloadImageAsBase64] 失败:', e);
      resolve(null);
    }
  });
}

// 原有的 captureProblemForVision
export async function captureProblemForVision() {
  try {
    console.log('[captureProblemForVision] 开始截图...');
    const canvas = await captureProblemScreenshot();
    if (!canvas) {
      console.error('[captureProblemForVision] 截图失败');
      return null;
    }
    
    console.log('[captureProblemForVision] 截图成功，转换为base64...');
    
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    console.log('[captureProblemForVision] base64 长度:', base64.length);
    
    if (base64.length > 1000000) {
      console.log('[captureProblemForVision] 图片过大，进行压缩...');
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