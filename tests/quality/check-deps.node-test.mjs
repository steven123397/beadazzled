import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeDependencyAudit } from '../../scripts/lib/dependency-audit.mjs';

function report(packages) {
  return {
    results: [
      {
        packages: packages.map(([name, vulnerabilities]) => ({
          package: { name, version: '1.0.0', ecosystem: 'npm' },
          vulnerabilities,
        })),
      },
    ],
  };
}

function vulnerability(id, severity) {
  return severity === undefined ? { id } : { id, database_specific: { severity } };
}

test('high severity vulnerabilities block', () => {
  const result = summarizeDependencyAudit(report([['left-pad', [vulnerability('OSV-1', 'HIGH')]]]));

  assert.equal(result.status, 'fail');
  assert.equal(result.blocking, 1);
  assert.equal(result.counts.high, 1);
});

test('critical severity vulnerabilities block', () => {
  const result = summarizeDependencyAudit(
    report([['left-pad', [vulnerability('OSV-2', 'CRITICAL')]]])
  );

  assert.equal(result.status, 'fail');
  assert.equal(result.blocking, 1);
});

test('moderate and low vulnerabilities do not block', () => {
  const result = summarizeDependencyAudit(
    report([['left-pad', [vulnerability('OSV-3', 'MODERATE'), vulnerability('OSV-4', 'LOW')]]])
  );

  assert.equal(result.status, 'pass');
  assert.equal(result.counts.medium, 1);
  assert.equal(result.counts.low, 1);
});

test('advisories without severity data are reported but do not block', () => {
  const result = summarizeDependencyAudit(
    report([['proc-macro-error', [vulnerability('RUSTSEC-1')]]])
  );

  assert.equal(result.status, 'pass');
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.findings[0].severity, 'unknown');
});

test('findings carry the package and advisory id', () => {
  const result = summarizeDependencyAudit(
    report([['glib', [vulnerability('RUSTSEC-2024-0429', 'HIGH')]]])
  );

  assert.deepEqual(result.findings[0], {
    package: 'glib',
    version: '1.0.0',
    id: 'RUSTSEC-2024-0429',
    severity: 'high',
  });
});

test('an empty report passes', () => {
  const result = summarizeDependencyAudit({ results: [] });

  assert.equal(result.status, 'pass');
  assert.equal(result.findings.length, 0);
});
