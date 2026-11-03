import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { BrowserWindow } from 'electron';
import { type Presentation } from '@ykt/contracts';

import { isAllowedYuketangUrl } from './browser-policy.js';

/**
 * Build the PDF bytes for a presentation using a hidden Electron window.
 * Shared by the save-dialog IPC path and the CLI path (which writes to an
 * explicit path).
 */
export async function renderPresentationPdfBuffer(
  presentation: Presentation,
): Promise<Buffer> {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'persist:yuketang-browser',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(presentationHtml(presentation))}`,
    );
    await printWindow.webContents.executeJavaScript(`
      Promise.race([
        Promise.all(Array.from(document.images).map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              })
        )),
        new Promise((resolve) => setTimeout(resolve, 15000))
      ])
    `);
    return printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    });
  } finally {
    printWindow.destroy();
  }
}

export async function writePresentationPdf(
  presentation: Presentation,
  filePath: string,
): Promise<{ filePath: string }> {
  const pdf = await renderPresentationPdfBuffer(presentation);
  await writeFile(filePath, pdf);
  return { filePath };
}

export interface FetchedSlideImage {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly extension: string;
}

export async function fetchSlideImage(
  session: Electron.Session,
  imageUrl: string,
): Promise<FetchedSlideImage> {
  if (!isHttpsUrl(imageUrl)) throw new Error('Slide images must use HTTPS.');
  const response = await session.fetch(imageUrl);
  if (!response.ok)
    throw new Error(`课件图片下载失败：HTTP ${response.status}`);
  const contentType = imageContentType(response.headers.get('content-type'));
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType,
    extension: imageExtension(contentType, imageUrl),
  };
}

export async function writeSlideFile(
  image: FetchedSlideImage,
  filePath: string,
): Promise<{ filePath: string; contentType: string }> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, image.buffer);
  return { filePath, contentType: image.contentType };
}

function imageContentType(header: string | null): string {
  return (header ?? 'image/jpeg').split(';')[0]!.trim();
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function imageExtension(contentType: string, imageUrl: string): string {
  if (/image\/png/i.test(contentType)) return '.png';
  if (/image\/webp/i.test(contentType)) return '.webp';
  if (/image\/gif/i.test(contentType)) return '.gif';
  const path = new URL(imageUrl).pathname;
  const match = /\.(png|webp|gif|jpe?g)$/i.exec(path);
  return match ? `.${match[1]!.toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

function presentationHtml(presentation: Presentation): string {
  const slides = presentation.slides
    .map((slide, index) => {
      const image =
        slide.imageUrl && isAllowedYuketangUrl(slide.imageUrl)
          ? `<img src="${escapeHtml(slide.imageUrl)}" alt="第 ${index + 1} 页" />`
          : '<div class="missing">该页没有可导出的图片</div>';
      return `<section class="slide"><header>${index + 1} / ${presentation.slides.length}</header>${image}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://yuketang.cn https://*.yuketang.cn; style-src 'unsafe-inline'"><title>${escapeHtml(presentation.title)}</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#1f2924;font-family:"Microsoft YaHei","Segoe UI",sans-serif}.slide{display:grid;width:100%;height:190mm;grid-template-rows:8mm 1fr;break-after:page;page-break-after:always}.slide:last-child{break-after:auto;page-break-after:auto}header{color:#65736b;font-size:9pt;text-align:right}img{width:100%;height:100%;object-fit:contain}.missing{display:grid;place-items:center;border:1px solid #d9e1dc;color:#77847d}</style></head><body>${slides}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}
