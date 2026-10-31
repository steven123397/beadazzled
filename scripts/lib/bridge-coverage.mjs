// Pure helpers for measuring the bridge module's line coverage from
// `cargo llvm-cov --json` output. Kept free of process spawning so the
// threshold logic can be unit-tested without building Rust.

export const BRIDGE_COVERAGE_THRESHOLD = 80;

export function normalizePath(filename) {
  return filename.replaceAll('\\', '/');
}

function isBridgeSource(filename) {
  const normalized = normalizePath(filename);
  return (
    /(?:^|\/)src-tauri\/src\/bridge\//.test(normalized) ||
    /(?:^|\/)src-tauri\/src\/bridge\.rs$/.test(normalized)
  );
}

export function summarizeBridgeCoverage(report) {
  const files = (report?.data ?? []).flatMap((entry) => entry.files ?? []);
  let fileCount = 0;
  let lines = 0;
  let covered = 0;

  for (const file of files) {
    if (!isBridgeSource(file.filename)) {
      continue;
    }
    fileCount += 1;
    lines += file.summary?.lines?.count ?? 0;
    covered += file.summary?.lines?.covered ?? 0;
  }

  const percent = lines === 0 ? null : (covered / lines) * 100;
  return { fileCount, lines, covered, percent };
}

export function evaluateBridgeCoverage(report, threshold = BRIDGE_COVERAGE_THRESHOLD) {
  const summary = summarizeBridgeCoverage(report);
  if (summary.percent === null) {
    return { ...summary, threshold, status: 'not-applicable' };
  }
  return {
    ...summary,
    threshold,
    status: summary.percent >= threshold ? 'pass' : 'fail',
  };
}
