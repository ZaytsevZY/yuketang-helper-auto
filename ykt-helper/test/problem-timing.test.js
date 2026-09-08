import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deadlineFromLimit,
  isDeadlineReached,
  remainingSeconds,
} from '../src/state/problem-timing.js';

test('treats limit=0 as a problem without a deadline', () => {
  assert.equal(deadlineFromLimit(1_000, 0), null);
  assert.equal(isDeadlineReached(null, 10_000), false);
  assert.equal(remainingSeconds(null, 10_000), null);
});

test('keeps positive limits as ordinary deadlines', () => {
  assert.equal(deadlineFromLimit(1_000, 60), 61_000);
  assert.equal(isDeadlineReached(61_000, 61_000), true);
  assert.equal(remainingSeconds(61_000, 31_000), 30);
});
