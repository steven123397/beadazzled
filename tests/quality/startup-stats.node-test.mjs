import assert from 'node:assert/strict';
import { test } from 'node:test';

import { percentile, summarize } from '../../scripts/lib/startup-stats.mjs';

test('percentile uses the nearest-rank definition', () => {
  const values = [10, 20, 30, 40];

  assert.equal(percentile(values, 0.5), 20);
  assert.equal(percentile(values, 0.95), 40);
  assert.equal(percentile(values, 0), 10);
  assert.equal(percentile(values, 1), 40);
});

test('p95 of twenty samples is the second slowest run', () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 1);

  assert.equal(percentile(values, 0.95), 19);
});

test('percentile sorts without mutating the input', () => {
  const values = [30, 10, 20];

  assert.equal(percentile(values, 0.5), 20);
  assert.deepEqual(values, [30, 10, 20]);
});

test('percentile rejects empty or non-positive inputs', () => {
  assert.throws(() => percentile([], 0.5), /empty/i);
  assert.throws(() => percentile([1, 2], -0.1), /probability/i);
  assert.throws(() => percentile([1, 2], 1.1), /probability/i);
});

test('summarize reports count, extremes, mean and percentiles', () => {
  const summary = summarize([100, 200, 300, 400]);

  assert.deepEqual(summary, {
    count: 4,
    min: 100,
    max: 400,
    mean: 250,
    p50: 200,
    p95: 400,
  });
});

test('summarize rejects runs without samples', () => {
  assert.throws(() => summarize([]), /at least one/i);
});
