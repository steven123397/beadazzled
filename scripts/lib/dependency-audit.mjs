// Pure helpers for the dependency audit. Severity comes from the OSV record's
// database_specific.severity (GHSA/RUSTSEC); advisories without it are
// 'unknown' and block unless osv-allowlist.json waives them with a reason and
// an expiry date (ADR-0007).

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

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Validates osv-allowlist.json. A malformed entry fails the audit instead of
// being skipped: silently dropping a waiver would turn an unknown advisory
// back into a pass.
export function parseAllowlist(allowlist) {
  const entries = allowlist?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('osv-allowlist.json must contain an "entries" array');
  }

  const seen = new Set();
  return entries.map((entry, index) => {
    const where = `osv-allowlist.json entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${where} is not an object`);
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error(`${where} is missing "id"`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`${where} (${entry.id}) is missing "reason"`);
    }
    if (!isIsoDate(entry.expires)) {
      throw new Error(`${where} (${entry.id}) has an invalid "expires" date: ${entry.expires}`);
    }
    if (seen.has(entry.id)) {
      throw new Error(`${where} duplicates id ${entry.id}`);
    }
    seen.add(entry.id);

    return { id: entry.id, reason: entry.reason, expires: entry.expires };
  });
}

// Unknown severities block unless a non-expired entry matches their id.
// Expired entries fail even when their advisory is gone, so the list cannot
// rot past its review date.
export function evaluateAllowlist(findings, entries, today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  const expired = entries.filter((entry) => entry.expires < todayIso);
  const valid = entries.filter((entry) => entry.expires >= todayIso);
  const validById = new Map(valid.map((entry) => [entry.id, entry]));

  const unknown = findings.filter((finding) => finding.severity === 'unknown');
  const waived = [];
  const blocking = [];
  for (const finding of unknown) {
    const entry = validById.get(finding.id);
    if (entry) {
      waived.push({ ...finding, expires: entry.expires });
    } else {
      blocking.push(finding);
    }
  }

  const unknownIds = new Set(unknown.map((finding) => finding.id));
  const unmatched = valid.filter((entry) => !unknownIds.has(entry.id));

  return {
    waived,
    blocking,
    expired,
    unmatched,
    status: blocking.length > 0 || expired.length > 0 ? 'fail' : 'pass',
  };
}
