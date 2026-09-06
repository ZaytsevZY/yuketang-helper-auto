import assert from 'node:assert/strict';
import test from 'node:test';
import { meta } from '../userscript.meta.js';

function matchPatternsFrom(metadata) {
  return metadata
    .split('\n')
    .map(line => line.match(/^\/\/\s*@match\s+(\S+)$/)?.[1])
    .filter(Boolean);
}

function matchesPattern(pattern, rawUrl) {
  const url = new URL(rawUrl);
  const [scheme, hostAndPath] = pattern.split('://');
  const slashIndex = hostAndPath.indexOf('/');
  const hostPattern = hostAndPath.slice(0, slashIndex);
  const pathPattern = hostAndPath.slice(slashIndex);
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wildcard = value => value.split('*').map(escapeRegExp).join('.*');

  return url.protocol === `${scheme}:`
    && new RegExp(`^${wildcard(hostPattern)}$`).test(url.hostname)
    && new RegExp(`^${wildcard(pathPattern)}$`).test(url.pathname);
}

test('injects on supported root URLs before the site navigates to /v2/web', () => {
  const patterns = matchPatternsFrom(meta);

  for (const url of [
    'https://www.yuketang.cn/',
    'https://pro.yuketang.cn/',
    'https://changjiang.yuketang.cn/',
  ]) {
    assert.equal(patterns.some(pattern => matchesPattern(pattern, url)), true, url);
  }

  assert.equal(
    patterns.some(pattern => matchesPattern(pattern, 'https://api.yuketang.cn/')),
    false,
  );
});

test('injects on the supported mobile /m/v2 entry points without matching unrelated hosts', () => {
  const patterns = matchPatternsFrom(meta);

  for (const url of [
    'https://www.yuketang.cn/m/v2',
    'https://pro.yuketang.cn/m/v2/',
    'https://changjiang.yuketang.cn/m/v2/lesson/42',
  ]) {
    assert.equal(patterns.some(pattern => matchesPattern(pattern, url)), true, url);
  }

  assert.equal(
    patterns.some(pattern => matchesPattern(pattern, 'https://api.yuketang.cn/m/v2')),
    false,
  );
});
