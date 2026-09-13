import { describe, expect, it } from 'vitest';

import { renderSimpleMarkdown } from '../../apps/desktop/renderer/src/simple-markdown.js';

describe('simple AI response markdown', () => {
  it('renders the browser helper markdown subset and preserves line breaks', () => {
    const html = renderSimpleMarkdown(
      '# 结论\n第一行\n第二行\n\n- **要点**\n- `代码`\n\n```ts\nconst n = 1;\n```',
    );

    expect(html).toContain('<h1>结论</h1>');
    expect(html).toContain('<p>第一行<br>第二行</p>');
    expect(html).toContain('<ul><li><strong>要点</strong></li>');
    expect(html).toContain('<code class="ai-markdown-inline-code">代码</code>');
    expect(html).toContain(
      '<pre class="ai-markdown-code"><code data-lang="ts">const n = 1;</code></pre>',
    );
  });

  it('escapes HTML and only creates HTTP links', () => {
    const html = renderSimpleMarkdown(
      '<img src=x onerror=alert(1)> [安全](https://example.com/a?x=1&y=2) [危险](javascript:alert(1))',
    );

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });
});
