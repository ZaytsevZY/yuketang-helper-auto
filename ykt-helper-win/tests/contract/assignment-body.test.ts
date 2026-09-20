// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { AssignmentProblemDetail } from '@ykt/contracts';
import {
  buildAssignmentDocument,
  sanitizeAssignmentHtml,
  visibleComments,
  loadAssignmentMath,
} from '../../apps/desktop/renderer/src/assignment-body.js';

describe('assignment sandbox document', () => {
  it('removes active markup, styles, handlers and encoded javascript links while retaining text/images', () => {
    const result = sanitizeAssignmentHtml(
      `<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test"></iframe><svg onload="evil()"><script>evil()</script></svg><form action="https://evil.test"><input></form><p onclick="evil()" style="background:url(https://evil.test);text-align:center">题干 <span class="xuetangx-com-encrypted-font arbitrary">𛈒</span></p><a href="jav&#97;script:evil()">危险</a><img src="/image.png" onerror="evil()"><img src="file:///secret"><a href="//pro.yuketang.cn/read">查看</a>`,
    );
    expect(result.html).not.toMatch(
      /<script|<style|<iframe|<svg|<form|onload|onclick|onerror|javascript|file:|background:|arbitrary/,
    );
    expect(result.html).toContain('class="xuetangx-com-encrypted-font"');
    expect(result.images.has('https://pro.yuketang.cn/image.png')).toBe(true);
    expect(result.links).toEqual(new Set(['https://pro.yuketang.cn/read']));
    expect(result.html).toContain('text-align:center');
  });

  it('preserves HTML tables and text, never promotes attributes into markup', () => {
    const result = sanitizeAssignmentHtml(
      '<p title="x>"><script>evil()</script>">文本 &amp; &lt;</p><table><tr><td colspan="2" rowspan="999">内容</td></tr></table><img alt="&quot; onerror=&quot;evil()" src="https://cdn.xuetangx.com/a.png">',
    );
    const template = document.createElement('template');
    template.innerHTML = result.html;
    expect(template.content.querySelector('script')).toBeNull();
    expect(
      template.content.querySelector('img')?.getAttribute('onerror'),
    ).toBeNull();
    expect(template.content.querySelector('td')?.getAttribute('colspan')).toBe(
      '2',
    );
    expect(
      template.content.querySelector('td')?.getAttribute('rowspan'),
    ).toBeNull();
  });

  it('renders real offline math while keeping broken formulas, code and encrypted text intact', async () => {
    const bundle = await loadAssignmentMath();
    expect(bundle).not.toBeNull();
    const result = sanitizeAssignmentHtml(
      '<p>$x^2$ $$\\frac{1}{2}$$ $\\badcommand$</p><code>$raw$</code><span class="xuetangx-com-encrypted-font">$𛈒$</span>',
      bundle,
    );
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain('$\\badcommand$');
    expect(result.html).toContain('<code>$raw$</code>');
    expect(result.html).toContain('>$𛈒$</span>');
    expect(bundle?.css).toContain('data:font/woff2;base64,');
    expect(bundle?.css).not.toMatch(/url\(["']?(?:\.\.?\/|https?:)/);
  });

  it('isolates font families by document and binds scripts/messages to a nonce', () => {
    const font = 'data:font/ttf;base64,AAEAAAAA';
    const a = buildAssignmentDocument(
      '<span class="xuetangx-com-encrypted-font">𛈒</span>',
      'document-one',
      font,
      null,
    );
    const b = buildAssignmentDocument(
      '<p>another</p>',
      'document-two',
      font,
      null,
    );
    expect(a.doc).toContain('YktEncrypted_documentone');
    expect(b.doc).not.toContain('YktEncrypted_documentone');
    expect(a.doc).toContain("default-src 'none'");
    expect(a.doc).toContain("script-src 'nonce-document-one'");
    expect(a.doc).toContain('var(--ykt-font-body)');
    expect(a.doc).not.toContain(',inherit');
    // The generated script must parse after escaping through TS/template/HTML layers.
    const script = a.doc.match(/<script[^>]*>([\s\S]*)<\/script>/)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('faces.length');
    expect(script).toContain('getComputedStyle');
  });

  it('keeps named teacher feedback once without discarding distinct comments', () => {
    const result = visibleComments({
      remarkHtml: '<p>很好</p>',
      comments: [
        { name: '', html: '很好', index: null },
        { name: '王老师', html: ' 很好 ', index: null },
        { name: '李老师', html: '第二题需改进', index: 2 },
      ],
    } as AssignmentProblemDetail);
    expect(result).toEqual([
      { name: '王老师', html: ' 很好 ' },
      { name: '李老师', html: '第二题需改进' },
    ]);
  });

  it('preserves different image-only teacher annotations', () => {
    const result = visibleComments({
      remarkHtml: '',
      comments: [
        {
          name: '老师',
          html: '<img src="https://pro.yuketang.cn/a.png">',
          index: 1,
        },
        {
          name: '老师',
          html: '<img src="https://pro.yuketang.cn/b.png">',
          index: 2,
        },
      ],
    } as AssignmentProblemDetail);
    expect(result).toHaveLength(2);
  });
});
