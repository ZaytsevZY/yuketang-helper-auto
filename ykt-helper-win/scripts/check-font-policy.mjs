import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const globals = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

/** Static guard for CSS-wide keywords mixed into font-family lists. Quoted
 * family names and standalone CSS-wide values are legal. Dynamic var() values
 * still require the computed-style checks described in docs/font-policy.md. */
export function invalidFontFamily(value) {
  // Hide quoted family names before looking for keywords; comments only count
  // outside strings. Keep top-level commas and words, not function arguments.
  let plain = '';
  let quote = '';
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && value[i + 1] === '*') {
      const end = value.indexOf('*/', i + 2);
      i = end < 0 ? value.length : end + 1;
      plain += ' ';
    } else if (char === '"' || char === "'") {
      quote = char;
      if (depth === 0) plain += '__quoted__';
    } else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0) {
      if (char === '\\') {
        const escape = /^\\(?:([0-9a-f]{1,6})\s?|([^\n\r]))/i.exec(
          value.slice(i),
        );
        if (escape) {
          const code = escape[1] ? parseInt(escape[1], 16) : 0;
          plain += escape[1]
            ? String.fromCodePoint(code > 0 && code <= 0x10ffff ? code : 0xfffd)
            : escape[2];
          i += escape[0].length - 1;
          continue;
        }
      }
      plain += char;
    }
  }
  plain = plain
    .replace(/!\s*important\s*$/i, '')
    .trim()
    .toLowerCase();
  if (globals.has(plain)) return false;
  return plain.split(/[\s,]+/).some((word) => globals.has(word));
}

function declarationEnd(source, start) {
  let quote = '',
    depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return source.length;
      i = end + 1;
    } else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && [';', '}', '<'].includes(char)) return i;
  }
  return source.length;
}

export function inspectFontSource(source, filename) {
  const issues = [];
  const report = (value, offset) => {
    if (!invalidFontFamily(value)) return;
    const line = source.slice(0, offset).split('\n').length;
    const issue = `${filename}:${line}: font-family 混用了 CSS 全局关键字，请使用真实字体回退栈`;
    if (!issues.includes(issue)) issues.push(issue);
  };
  const css = (text, offset = 0) => {
    // Mask comments without changing offsets or quoted family names.
    const masked = text.replace(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g,
      (match) =>
        match.startsWith('/*') ? match.replace(/[^\n]/g, ' ') : match,
    );
    for (const match of masked.matchAll(/(?:^|[;{\s])font-family\s*:\s*/gi)) {
      const start = match.index + match[0].length;
      report(
        masked.slice(start, declarationEnd(masked, start)),
        offset + start,
      );
    }
  };
  const markup = (text, offset = 0) => {
    for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
      css(match[1], offset + match.index + match[0].indexOf('>') + 1);
    for (const match of text.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi))
      css(
        match[2].replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'"),
        offset + match.index,
      );
  };
  const script = (text, offset = 0) => {
    const tree = ts.createSourceFile(
      filename,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const name = (node) =>
      node && (ts.isIdentifier(node) || ts.isStringLiteral(node))
        ? node.text
        : '';
    const literal = (node) => {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isTemplateExpression(node))
        return (
          node.head.text +
          node.templateSpans
            .map((span) => '__dynamic__' + span.literal.text)
            .join('')
        );
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken
      )
        return (
          (literal(node.left) ?? '__dynamic__') +
          (literal(node.right) ?? '__dynamic__')
        );
      return null;
    };
    const visit = (node) => {
      let value;
      if (
        ts.isPropertyAssignment(node) &&
        ['fontFamily', 'font-family'].includes(name(node.name))
      )
        value = node.initializer;
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const left = node.left;
        if (
          (ts.isPropertyAccessExpression(left) &&
            name(left.name) === 'fontFamily') ||
          (ts.isElementAccessExpression(left) &&
            ['fontFamily', 'font-family'].includes(
              name(left.argumentExpression),
            ))
        )
          value = node.right;
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        name(node.expression.name) === 'setProperty' &&
        name(node.arguments[0]) === 'font-family'
      )
        value = node.arguments[1];
      if (value && literal(value) !== null)
        report(literal(value), offset + value.getStart(tree));
      if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
        const content = literal(node);
        css(content, offset + node.getStart(tree));
        markup(content, offset + node.getStart(tree));
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  };
  if (filename.endsWith('.vue') || filename.endsWith('.html')) {
    markup(source);
    for (const match of source.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    ))
      script(match[1], match.index + match[0].indexOf('>') + 1);
  } else if (filename.endsWith('.css')) css(source);
  else script(source);
  return issues;
}

async function checkRepository() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const roots = [
    'apps/desktop/renderer',
    'apps/desktop/main',
    'apps/desktop/preload',
    'packages',
    '../ykt-helper/src',
  ];
  const issues = [];
  let count = 0;
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (
        ['.css', '.vue', '.html', '.js', '.ts', '.mjs'].includes(
          extname(path),
        ) &&
        !/\.(test|spec)\.[^.]+$/.test(path)
      ) {
        count++;
        issues.push(...inspectFontSource(await readFile(path, 'utf8'), path));
      }
    }
  }
  for (const directory of roots) {
    try {
      await scan(resolve(root, directory));
    } catch (error) {
      if (directory.startsWith('../') && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  if (issues.length) {
    console.error(issues.join('\n'));
    process.exitCode = 1;
  } else console.log(`Font policy passed (${count} source files).`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await checkRepository();
