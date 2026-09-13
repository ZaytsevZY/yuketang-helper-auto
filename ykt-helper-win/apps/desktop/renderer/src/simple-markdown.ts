const tokenOpen = '\uE000';
const tokenClose = '\uE001';

export function renderSimpleMarkdown(source: string): string {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = /^\s*```([a-zA-Z0-9_-]+)?\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      const language = fence[1] ? ` data-lang="${fence[1]}"` : '';
      output.push(
        `<pre class="ai-markdown-code"><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      output.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      output.push('<hr>');
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length) {
        const match = /^\s*>\s?(.*)$/.exec(lines[index] ?? '');
        if (!match) break;
        quote.push(match[1] ?? '');
        index += 1;
      }
      index -= 1;
      output.push(
        `<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`,
      );
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const listTag = unordered ? 'ul' : 'ol';
      const itemPattern = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+\.\s+(.+)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const match = itemPattern.exec(lines[index] ?? '');
        if (!match) break;
        items.push(`<li>${renderInline(match[1]!)}</li>`);
        index += 1;
      }
      index -= 1;
      output.push(`<${listTag}>${items.join('')}</${listTag}>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return output.join('\n');
}

function renderInline(source: string): string {
  const tokens: string[] = [];
  const reserve = (html: string): string => {
    const token = `${tokenOpen}${tokens.length}${tokenClose}`;
    tokens.push(html);
    return token;
  };

  let text = source.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    reserve(`<code class="ai-markdown-inline-code">${escapeHtml(code)}</code>`),
  );
  text = text.replace(
    /\[([^\]\n]+)]\(([^)\s]+)\)/g,
    (_match, label: string, url: string) => {
      const href = safeHttpUrl(url);
      if (!href) return label;
      return reserve(
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${renderEmphasis(escapeHtml(label))}</a>`,
      );
    },
  );
  text = renderEmphasis(escapeHtml(text));
  return text.replace(
    new RegExp(`${tokenOpen}(\\d+)${tokenClose}`, 'g'),
    (_match, index: string) => tokens[Number(index)] ?? '',
  );
}

function renderEmphasis(source: string): string {
  return source
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
