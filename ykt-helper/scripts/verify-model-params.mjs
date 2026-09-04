import assert from 'node:assert/strict';
import { resolveTemperature } from '../src/ai/model-params.js';

assert.equal(resolveTemperature('kimi-k2.6', 0.3), 1);
assert.equal(resolveTemperature('KIMI-K2.5', 0.1), 1);
assert.equal(resolveTemperature('gpt-4o-mini', 0.3), 1);
assert.equal(resolveTemperature('deepseek-chat', 0.7), 1);
assert.equal(resolveTemperature('moonshot-v1-8k-vision-preview', 0.1), 1);
assert.equal(resolveTemperature('kimi-k2.6-preview', 0.6), 1);

console.log('Model parameter verification passed: every provider uses temperature=1.');
