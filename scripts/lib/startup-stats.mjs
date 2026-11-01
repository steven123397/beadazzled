/**
 * Percentile helpers for the startup measurement. Kept dependency-free so the
 * measurement script can run in CI before any build tooling is installed.
 */

/** Nearest-rank percentile (the run at or above rank ceil(p * n)). */
export function percentile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('percentile needs a non-empty sample list');
  }
  if (!(probability >= 0 && probability <= 1)) {
    throw new Error(`probability must be between 0 and 1, received ${probability}`);
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(probability * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));

  return sorted[index];
}

export function summarize(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('summarize needs at least one sample');
  }

  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: total / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}
