// Pure helpers for the dependency audit. Severity comes from the OSV record's
// database_specific.severity (GHSA/RUSTSEC); advisories without it are reported
// as unknown instead of silently ignored.

export function classifySeverity(vulnerability) {
  const raw = vulnerability?.database_specific?.severity;
  if (typeof raw !== 'string') {
    return 'unknown';
  }
  switch (raw.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MODERATE':
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'unknown';
  }
}

export function summarizeDependencyAudit(report) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  const findings = [];

  for (const result of report?.results ?? []) {
    for (const pkg of result.packages ?? []) {
      for (const vulnerability of pkg.vulnerabilities ?? []) {
        const severity = classifySeverity(vulnerability);
        counts[severity] += 1;
        findings.push({
          package: pkg.package?.name ?? 'unknown',
          version: pkg.package?.version,
          id: vulnerability.id,
          severity,
        });
      }
    }
  }

  const blocking = counts.critical + counts.high;
  return { counts, findings, blocking, status: blocking > 0 ? 'fail' : 'pass' };
}
