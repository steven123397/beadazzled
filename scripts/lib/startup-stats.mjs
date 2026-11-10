/**
 * Percentile helpers for the startup measurement. Kept dependency-free so the
 * measurement script can run in CI before any build tooling is installed.
 */

function percentileFromSorted(sorted, probability) {
  const rank = Math.ceil(probability * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/** Nearest-rank percentile (the run at or above rank ceil(p * n)). */
export function percentile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('percentile needs a non-empty sample list');
  }
  if (!(probability >= 0 && probability <= 1)) {
    throw new Error(`probability must be between 0 and 1, received ${probability}`);
  }

  const sorted = [...values].sort((left, right) => left - right);
  return percentileFromSorted(sorted, probability);
}

export function summarize(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('summarize needs at least one sample');
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: total / sorted.length,
    p50: percentileFromSorted(sorted, 0.5),
    p95: percentileFromSorted(sorted, 0.95),
  };
}

export function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function round(value) {
  return Math.round(value * 10) / 10;
}

