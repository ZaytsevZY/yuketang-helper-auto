import assert from 'node:assert/strict';
import { resolveTemperature } from '../src/ai/model-params.js';

assert.equal(resolveTemperature('kimi-k2.6', 0.3), 1);
assert.equal(resolveTemperature('KIMI-K2.5', 0.1), 1);
assert.equal(resolveTemperature('moonshot-v1-8k-vision-preview', 0.1), 1);
assert.equal(resolveTemperature('kimi-k2.6-preview', 0.6), 1);

console.log('Legacy Kimi parameter verification passed: temperature=1.');
