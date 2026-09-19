import { parse, tokenizer } from 'acorn';
import type { WebProbeEvidence, WebProbeFinding } from '@ykt/contracts';

// Acorn's nodes have different fields for every ESTree variant. They never
// leave this module; only the serializable evidence below crosses IPC.
type Ast = any;
type Scope = { bindings: Map<string, Ast | null>; parent: Scope | null };
interface IndexedNode {
  node: Ast;
  parent: IndexedNode | null;
  scope: Scope;
}
export interface WebSourceAnalysis {
  findings: WebProbeFinding[];
  assets: { url: string; discoveredBy: 'import' | 'webpack' }[];
  warnings: string[];
}

const MAX_FINDINGS = 3000;
const MAX_CHUNKS = 500;

export function analyzeWebSource(
  source: string,
  sourceUrl: string,
): WebSourceAnalysis {
  const result: WebSourceAnalysis = { findings: [], assets: [], warnings: [] };
  let tree: Ast;
  try {
    tree = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
    });
  } catch (error) {
    result.warnings.push(
      `脚本解析失败：${error instanceof Error ? error.message : '未知语法'}`,
    );
    return result;
  }
  const index: IndexedNode[] = [];
  const root: Scope = { bindings: new Map(), parent: null };
  function walk(node: Ast, parent: IndexedNode | null, scope: Scope): void {
    if (!node || typeof node.type !== 'string') return;
    if (/Function/.test(node.type) || node.type === 'BlockStatement') {
      scope = { bindings: new Map(), parent: scope };
      for (const param of node.params ?? []) bindPattern(param, scope);
    }
    if (node.type === 'VariableDeclarator') {
      if (node.id.type === 'Identifier')
        scope.bindings.set(node.id.name, node.init);
      else bindPattern(node.id, scope);
    }
    const item = { node, parent, scope };
    index.push(item);
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue;
      if (Array.isArray(child))
        for (const element of child) walk(element, item, scope);
      else if (child && typeof child === 'object') walk(child, item, scope);
    }
  }
  walk(tree, null, root);
  // A reassigned binding isn't a reliable static prefix.
  for (const { node, scope } of index) {
    const target =
      node.type === 'AssignmentExpression'
        ? node.left
        : node.type === 'UpdateExpression'
          ? node.argument
          : null;
    if (target?.type === 'Identifier') {
      for (
        let current: Scope | null = scope;
        current;
        current = current.parent
      ) {
        if (current.bindings.has(target.name)) {
          current.bindings.set(target.name, null);
          break;
        }
      }
    }
  }
  const lineStarts = [
    0,
    ...Array.from(source.matchAll(/\n/g), (match) => match.index! + 1),
  ];
  const seen = new Set<string>();
  const routePaths = new Map<Ast, string>();
  const add = (node: Ast, finding: Omit<WebProbeFinding, 'evidence'>) => {
    const key = `${finding.kind}:${finding.path}:${node.start}`;
    if (seen.has(key) || result.findings.length >= MAX_FINDINGS) return;
    seen.add(key);
    result.findings.push({
      ...finding,
      evidence: sourceEvidence(source, sourceUrl, node, lineStarts),
    });
  };
  const assets = new Set<string>();
  const addAsset = (
    path: string,
    discoveredBy: 'import' | 'webpack',
    base = sourceUrl,
  ) => {
    if (path.includes('{') || !/\.m?js(?:[?#]|$)/i.test(path)) return;
    try {
      const url = new URL(path, base).href;
      if (assets.has(url) || assets.size >= MAX_CHUNKS) return;
      assets.add(url);
      result.assets.push({ url, discoveredBy });
    } catch {
      /* Unresolved public paths remain source evidence. */
    }
  };
  let publicPath: string | null = null;
  for (const { node, scope } of index) {
    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression' &&
      propertyName(node.left.property) === 'p'
    ) {
      const value = expression(node.right, scope, source);
      if (value && !value.includes('{') && /^(https:\/\/|\/)/.test(value))
        publicPath = value;
    }
  }
  for (const item of index) {
    const { node, scope } = item;
    // Parent links avoid retaining a full ancestor array for every AST node.
    const ancestors: Ast[] = [];
    if (
      [
        'ObjectExpression',
        'Literal',
        'TemplateLiteral',
        'BinaryExpression',
        'CallExpression',
      ].includes(node.type)
    ) {
      for (let parent = item.parent; parent; parent = parent.parent)
        ancestors.unshift(parent.node);
    }
    if (node.type === 'ObjectExpression') {
      const props = properties(node);
      const path = expression(props.get('path'), scope, source);
      const inRouteArray =
        ancestors.at(-1)?.type === 'ArrayExpression' &&
        ['routes', 'children'].includes(propertyName(ancestors.at(-2)?.key));
      if (
        path !== null &&
        (inRouteArray ||
          props.has('component') ||
          props.has('children') ||
          props.has('redirect'))
      ) {
        const parent = [...ancestors]
          .reverse()
          .find((ancestor) => routePaths.has(ancestor));
        const parentPath = parent ? routePaths.get(parent)! : null;
        const fullPath =
          path.startsWith('/') || !parentPath
            ? path
            : `${parentPath.replace(/\/$/, '')}/${path}`;
        routePaths.set(node, fullPath);
        add(props.get('path'), {
          kind: 'route',
          path: fullPath,
          parent: parentPath,
          name: expression(props.get('name'), scope, source),
          method: null,
          parameters: pathParameters(fullPath),
        });
      }
      const urlNode =
        props.get('url') ??
        (props.has('method') ? props.get('path') : undefined);
      const url = expression(urlNode, scope, source);
      if (url && isPath(url)) {
        const method =
          expression(props.get('method'), scope, source)?.toUpperCase() ?? null;
        const name = [...ancestors]
          .reverse()
          .find((ancestor) => ancestor.type === 'Property');
        add(node, {
          kind: 'api',
          path: url,
          name: name ? propertyName(name.key) : null,
          parent: null,
          method,
          parameters: [
            ...new Set([
              ...pathParameters(url),
              ...properties(props.get('params')).keys(),
              ...properties(props.get('data')).keys(),
            ]),
          ],
        });
      }
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression'
    ) {
      const method = propertyName(node.callee.property).toUpperCase();
      const url = expression(node.arguments[0], scope, source);
      if (
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) &&
        url &&
        isPath(url)
      ) {
        add(node, {
          kind: 'api',
          path: url,
          name: null,
          method,
          parent: null,
          parameters: pathParameters(url),
        });
      }
    }
    if (node.type === 'ImportExpression') {
      const path = expression(node.source, scope, source);
      if (path) addAsset(path, 'import');
    }
    if (
      [
        'Literal',
        'TemplateLiteral',
        'BinaryExpression',
        'CallExpression',
      ].includes(node.type)
    ) {
      const parent = ancestors.at(-1);
      if (parent?.type === 'BinaryExpression' && parent.operator === '+')
        continue;
      const value = expression(node, scope, source);
      if (
        value &&
        isPath(value) &&
        !/\.(?:js|css|png|jpg|svg|woff2?)(?:[?#]|$)/.test(value)
      ) {
        add(node, {
          kind: 'path',
          path: value,
          name: null,
          method: null,
          parent: null,
          parameters: pathParameters(value),
        });
      }
      // Webpack 3/4/5 compose filenames from a chunk-id -> hash/name map.
      // Interpret only literal concatenation and map lookup, never execute JS.
      if (
        node.type === 'BinaryExpression' &&
        source.slice(node.start, node.end).includes('.js') &&
        node.end - node.start < 150_000
      ) {
        const fn = [...ancestors]
          .reverse()
          .find((item) => /Function/.test(item.type));
        const param = fn?.params?.[0];
        if (param?.type === 'Identifier') {
          const ids = chunkIds(node);
          for (const id of ids.slice(0, MAX_CHUNKS)) {
            const path = expression(
              node,
              scope,
              source,
              new Map([[param.name, id]]),
              publicPath,
            );
            if (path)
              addAsset(
                path,
                'webpack',
                publicPath ? new URL(publicPath, sourceUrl).href : sourceUrl,
              );
          }
        }
      }
    }
  }
  if (result.findings.length >= MAX_FINDINGS)
    result.warnings.push(`候选条目达到 ${MAX_FINDINGS} 条上限`);
  if (assets.size >= MAX_CHUNKS)
    result.warnings.push(`懒加载脚本达到 ${MAX_CHUNKS} 条上限`);
  return result;
}

function bindPattern(node: Ast, scope: Scope): void {
  if (!node) return;
  if (node.type === 'Identifier') scope.bindings.set(node.name, null);
  else
    for (const child of Object.values(node)) {
      if (Array.isArray(child))
        child.forEach((value) => bindPattern(value, scope));
      else if (child && typeof child === 'object') bindPattern(child, scope);
    }
}
function propertyName(node: Ast): string {
  return String(node?.name ?? node?.value ?? '');
}
function properties(node: Ast): Map<string, Ast> {
  return new Map(
    node?.type === 'ObjectExpression'
      ? node.properties
          .filter((p: Ast) => p.type === 'Property' && !p.computed)
          .map((p: Ast) => [propertyName(p.key), p.value])
      : [],
  );
}
function expression(
  node: Ast,
  scope: Scope,
  source: string,
  overrides = new Map<string, string>(),
  publicPath: string | null = null,
  depth = 0,
): string | null {
  if (!node || depth > 20) return null;
  const read = (child: Ast) =>
    expression(child, scope, source, overrides, publicPath, depth + 1);
  if (
    node.type === 'Literal' &&
    ['string', 'number'].includes(typeof node.value)
  )
    return String(node.value);
  if (node.type === 'Identifier') {
    if (overrides.has(node.name)) return overrides.get(node.name)!;
    for (let current: Scope | null = scope; current; current = current.parent) {
      if (current.bindings.has(node.name)) {
        return (
          expression(
            current.bindings.get(node.name),
            current,
            source,
            overrides,
            publicPath,
            depth + 1,
          ) ?? `{${node.name}}`
        );
      }
    }
    return `{${node.name}}`;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = read(node.left);
    const right = read(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (node.type === 'TemplateLiteral')
    return node.quasis
      .map(
        (part: Ast, i: number) =>
          (part.value.cooked ?? part.value.raw) +
          (node.expressions[i] ? (read(node.expressions[i]) ?? '{…}') : ''),
      )
      .join('');
  if (node.type === 'LogicalExpression' && node.operator === '||') {
    const left = read(node.left);
    return left && !left.includes('{') ? left : read(node.right);
  }
  if (node.type === 'MemberExpression') {
    if (node.object.type === 'ObjectExpression' && node.computed) {
      const key = read(node.property);
      return key ? read(properties(node.object).get(key)) : null;
    }
    if (propertyName(node.property) === 'p' && publicPath) return publicPath;
    return `{${source.slice(node.start, node.end).slice(0, 80)}}`;
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    propertyName(node.callee.property) === 'concat'
  ) {
    const values = [read(node.callee.object), ...node.arguments.map(read)];
    return values.every((value) => value !== null) ? values.join('') : null;
  }
  return null;
}
function isPath(value: string): boolean {
  return (
    value.length < 2000 &&
    /^(?:https:\/\/[^/]+|\{[^{}]+\})?\/[\w:{]/.test(value) &&
    !/[\n\r]/.test(value)
  );
}
function pathParameters(path: string): string[] {
  return [
    ...new Set(
      [...path.matchAll(/(?:[?&]([^=?&]+)=|:([\w]+)|\{([^{}]+)\})/g)]
        .map((match) => match[1] ?? match[2] ?? match[3]!)
        .filter(Boolean),
    ),
  ];
}
function chunkIds(node: Ast): string[] {
  const ids = new Set<string>();
  const visit = (value: Ast) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'ObjectExpression')
      for (const key of properties(value).keys()) ids.add(key);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'loc') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(node);
  return [...ids];
}

function sourceEvidence(
  source: string,
  sourceUrl: string,
  node: Ast,
  lineStarts: number[],
): WebProbeEvidence {
  const excerpt = source
    .slice(
      Math.max(0, node.start - 100),
      Math.min(source.length, Math.max(node.end, node.start + 600)),
    )
    .slice(0, 1600);
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid]! <= node.start) low = mid;
    else high = mid;
  }
  return {
    sourceUrl,
    line: low + 1,
    column: node.start - lineStarts[low]! + 1,
    offset: node.start,
    snippet: readable(excerpt),
  };
}

function readable(source: string): string {
  // Token-based line breaks preserve string contents and original source offsets.
  try {
    const tokens = tokenizer(source, { ecmaVersion: 'latest' });
    let output = '';
    let previous = 0;
    for (const token of tokens) {
      output += source.slice(previous, token.end);
      if ([';', '{', '}', ','].includes(token.type.label)) output += '\n';
      previous = token.end;
    }
    return output + source.slice(previous);
  } catch {
    return source;
  }
}
