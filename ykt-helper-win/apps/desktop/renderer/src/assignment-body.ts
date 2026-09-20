import type { AssignmentDetail, AssignmentProblemDetail } from '@ykt/contracts';
import bodyFontCss from './fonts.css?raw';
import { assignmentFrameScript } from './assignment-frame-script';

export const ENCRYPTED_CLASS = 'xuetangx-com-encrypted-font';
export type MathBundle = {
  css: string;
  render(tex: string, display: boolean): string;
};
let math: Promise<MathBundle | null> | null = null;

export function loadAssignmentMath(): Promise<MathBundle | null> {
  if (!math)
    math = Promise.all([
      import('./vendor/katex/katex.mjs'),
      import('./vendor/katex/katexInlineCss'),
    ])
      .then(([katex, css]) => ({
        css: css.KATEX_INLINE_CSS,
        render: (tex: string, display: boolean) =>
          katex.default.renderToString(tex, {
            displayMode: display,
            throwOnError: true,
            trust: false,
            output: 'html',
            maxExpand: 1000,
            maxSize: 20,
          }),
      }))
      .catch(() => {
        math = null;
        return null;
      });
  return math;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

export function contentUrl(value: string): string | null {
  try {
    const u = new URL(value, 'https://pro.yuketang.cn/');
    return value.trim() && u.protocol === 'https:' && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}

const allowedTags = new Set(
  'section p span div br strong b em i u s sub sup ul ol li table thead tbody tfoot tr th td blockquote pre code h1 h2 h3 h4 h5 h6 hr a img'.split(
    ' ',
  ),
);
const droppedTags = new Set(
  'script style iframe object embed svg math form input button textarea select option link meta base noscript template audio video source'.split(
    ' ',
  ),
);

/** Parse in an inert template, then serialize ONLY allowed nodes/attributes. No
 * remote styles, event handlers, active documents or raw HTML enter the host DOM. */
export function sanitizeAssignmentHtml(
  html: string,
  bundle: MathBundle | null = null,
): { html: string; images: Set<string>; links: Set<string> } {
  const template = document.createElement('template');
  template.innerHTML = html.slice(0, 2_000_000);
  const images = new Set<string>(),
    links = new Set<string>();
  let visited = 0;
  const visit = (node: Node, skipMath = false, depth = 0): string => {
    if (++visited > 30_000 || depth > 100) return '';
    if (node.nodeType === 3)
      return renderText(node.textContent ?? '', skipMath ? null : bundle);
    if (node.nodeType !== 1) return '';
    const el = node as Element,
      tag = el.tagName.toLowerCase();
    if (droppedTags.has(tag)) return '';
    const encrypted = el.classList.contains(ENCRYPTED_CLASS);
    const inner = () =>
      Array.from(el.childNodes)
        .map((n) =>
          visit(
            n,
            skipMath || encrypted || tag === 'pre' || tag === 'code',
            depth + 1,
          ),
        )
        .join('');
    if (!allowedTags.has(tag)) return inner();
    let attrs = encrypted ? ` class="${ENCRYPTED_CLASS}"` : '';
    const align = (el as HTMLElement).style?.textAlign;
    if (['left', 'right', 'center', 'justify'].includes(align))
      attrs += ` style="text-align:${align}"`;
    if (tag === 'img') {
      const src = contentUrl(el.getAttribute('src') ?? '');
      if (!src) return '<span class="missing">图片不可用</span>';
      images.add(src);
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(el.getAttribute('alt') || '题目图片')}" referrerpolicy="no-referrer">`;
    }
    if (tag === 'a') {
      const href = contentUrl(el.getAttribute('href') ?? '');
      if (href) {
        links.add(href);
        attrs += ` href="${escapeHtml(href)}"`;
      }
    }
    if (tag === 'td' || tag === 'th')
      for (const key of ['colspan', 'rowspan']) {
        const n = Number(el.getAttribute(key));
        if (Number.isInteger(n) && n > 0 && n <= 100) attrs += ` ${key}="${n}"`;
      }
    return ['br', 'hr'].includes(tag)
      ? `<${tag}${attrs}>`
      : `<${tag}${attrs}>${inner()}</${tag}>`;
  };
  return {
    html: Array.from(template.content.childNodes)
      .map((n) => visit(n))
      .join(''),
    images,
    links,
  };
}

function renderText(text: string, bundle: MathBundle | null): string {
  if (!bundle) return escapeHtml(text);
  // Text nodes only. Malformed formulas stay visible; code/encrypted spans skip math.
  const expression =
    /(?<!\\)(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(\S(?:[^$]*?\S)?)\$)/g;
  let out = '',
    start = 0;
  for (const m of text.matchAll(expression)) {
    out += escapeHtml(text.slice(start, m.index));
    try {
      out += bundle.render(m[2] ?? m[3] ?? m[4] ?? m[5]!, !!(m[2] ?? m[3]));
    } catch {
      out += escapeHtml(m[0]);
    }
    start = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(start));
}

export function visibleComments(
  problem: AssignmentProblemDetail,
): { name: string; html: string }[] {
  const key = (html: string) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    const text = (template.content.textContent ?? '')
      .replace(/\s+/g, '')
      .replace(/：/g, ':');
    // Image-only feedback must not collapse to the same empty-text key.
    const images = Array.from(template.content.querySelectorAll('img'))
      .map((image) => image.getAttribute('src') ?? '')
      .join('|');
    return images ? `${text}\0${images}` : text;
  };
  const comments = [...problem.comments].sort(
    (a, b) => Number(!!b.name) - Number(!!a.name),
  );
  const remark = key(problem.remarkHtml);
  const namedDuplicate = comments.some(
    (c) =>
      c.name &&
      (key(c.html) === remark || key(`${c.name}:${c.html}`) === remark),
  );
  const result =
    !namedDuplicate && problem.remarkHtml.trim()
      ? [{ name: '', html: problem.remarkHtml }]
      : [];
  const seen = new Set(result.map((c) => key(c.html)));
  for (const c of comments) {
    const k = key(c.html);
    if (!seen.has(k)) {
      result.push({ name: c.name, html: c.html });
      seen.add(k);
    }
  }
  return result;
}

export function detailBodyHtml(detail: AssignmentDetail): string {
  const labels = {
    unknown: '状态未知',
    unanswered: '未作答',
    answered: '有作答记录',
    submitted: '已交未批',
    graded: '已批改',
  };
  return (
    (detail.descriptionHtml
      ? `<section><h2>${detail.assignment.kind === 'exam' ? '考试说明' : '作业说明'}</h2>${detail.descriptionHtml}</section>`
      : '') +
    detail.problems
      .map(
        (p) => `<section>
    <h2>第 ${p.index} 题 · ${escapeHtml(p.typeText)}${p.score === null ? '' : ` · ${p.score} 分`}</h2>
    <p>${labels[p.status]}${p.correct === true ? ' · 正确' : p.correct === false ? ' · 错误' : ''}${p.myScore === null ? '' : ` · 得分 ${p.myScore}${p.score === null ? '' : ` / ${p.score}`}`}</p>
    ${p.bodyHtml || '<p>暂无题干</p>'}
    ${p.options.length ? `<div>${p.options.map((o) => `<p><b>${escapeHtml(o.label)}.</b> ${o.html}</p>`).join('')}</div>` : ''}
    ${p.type === 9 ? (p.externalUrl ? `<p><a href="${escapeHtml(p.externalUrl)}">打开题目链接 ↗</a></p>` : '') : `<h3>我的作答</h3>${p.answerHtml || '<p>暂无作答内容</p>'}`}
    ${p.attachments.length ? `<h3>附件</h3><ul>${p.attachments.map((a) => `<li>${escapeHtml(a.name)}</li>`).join('')}</ul>` : ''}
    ${detail.mode === 'exam-review' && p.correctAnswerHtml ? `<h3>参考答案</h3>${p.correctAnswerHtml}` : ''}
    ${detail.mode === 'exam-review' && p.explanationHtml ? `<h3>解析</h3>${p.explanationHtml}` : ''}
    ${visibleComments(p)
      .map(
        (c) => `<h3>${c.name ? escapeHtml(c.name) : '老师评语'}</h3>${c.html}`,
      )
      .join('')}
  </section>`,
      )
      .join('')
  );
}

export function buildAssignmentDocument(
  html: string,
  token: string,
  fontData: string | null,
  bundle: MathBundle | null,
) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(token))
    throw new Error('Invalid document token.');
  const content = sanitizeAssignmentHtml(html, bundle);
  const family = `YktEncrypted_${token.replace(/[^a-zA-Z0-9]/g, '')}`;
  const font =
    fontData &&
    /^data:font\/(?:ttf|otf|woff2?);base64,[a-zA-Z0-9+/=]+$/.test(fontData)
      ? fontData
      : null;
  const fontCss = font
    ? `@font-face{font-family:"${family}";src:url("${font}");font-display:swap}.${ENCRYPTED_CLASS}{font-family:"${family}",var(--ykt-font-body)}`
    : '';
  const script = assignmentFrameScript(token, font ? family : null);
  return {
    ...content,
    doc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${bodyFontCss}
    *{box-sizing:border-box}body{margin:0;padding:8px;color:#202824;background:#fff;font-family:var(--ykt-font-body);font-size:14px;line-height:1.7;overflow-wrap:anywhere}section{padding:12px 4px;border-bottom:1px solid #dce5df}h2{font-size:16px}h3{font-size:14px;color:#53615a}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid #cbd5cf;padding:5px}pre{white-space:pre-wrap}a{color:#236a46}.missing{display:block;padding:12px;background:#f2f2f2;color:#666}.katex-display{overflow-x:auto;overflow-y:hidden}${fontCss}${bundle?.css ?? ''}</style></head><body>${content.html}<script nonce="${token}">${script}</script></body></html>`,
  };
}
