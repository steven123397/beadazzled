import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateAllowlist,
  parseAllowlist,
  summarizeDependencyAudit,
} from '../../scripts/lib/dependency-audit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

function unknownFinding(id, packageName = 'proc-macro-error') {
  return {
    package: packageName,
    version: '1.0.0',
    id,
    severity: 'unknown',
  };
}

const TODAY = new Date('2026-11-01T00:00:00Z');

test('parseAllowlist accepts well-formed entries', () => {
  const entries = parseAllowlist({
    version: 1,
    entries: [{ id: 'RUSTSEC-1', reason: 'linux-only', expires: '2027-01-31' }],
  });

  assert.deepEqual(entries, [{ id: 'RUSTSEC-1', reason: 'linux-only', expires: '2027-01-31' }]);
});

test('parseAllowlist rejects entries without an id, reason or valid expiry', () => {
  assert.throws(() => parseAllowlist({ entries: [{ reason: 'x', expires: '2027-01-31' }] }), /id/);
  assert.throws(
    () => parseAllowlist({ entries: [{ id: 'RUSTSEC-1', expires: '2027-01-31' }] }),
    /reason/
  );
  assert.throws(
    () => parseAllowlist({ entries: [{ id: 'RUSTSEC-1', reason: 'x', expires: '2027-02-31' }] }),
    /expires/
  );
});

test('parseAllowlist rejects duplicate ids and a missing entries array', () => {
  assert.throws(
    () =>
      parseAllowlist({
        entries: [
          { id: 'RUSTSEC-1', reason: 'x', expires: '2027-01-31' },
          { id: 'RUSTSEC-1', reason: 'y', expires: '2027-01-31' },
        ],
      }),
    /duplicate/
  );
  assert.throws(() => parseAllowlist({}), /entries/);
});

test('an unknown advisory without an allowlist entry blocks', () => {
  const result = evaluateAllowlist([unknownFinding('RUSTSEC-1')], [], TODAY);

  assert.equal(result.status, 'fail');
  assert.equal(result.blocking.length, 1);
  assert.equal(result.waived.length, 0);
});

test('a valid allowlist entry waives the unknown advisory', () => {
  const entries = parseAllowlist({
    entries: [{ id: 'RUSTSEC-1', reason: 'linux-only dependency', expires: '2027-01-31' }],
  });

  const result = evaluateAllowlist([unknownFinding('RUSTSEC-1')], entries, TODAY);

  assert.equal(result.status, 'pass');
  assert.equal(result.blocking.length, 0);
  assert.equal(result.waived.length, 1);
  assert.equal(result.waived[0].expires, '2027-01-31');
});

test('an entry is valid through its expiry date', () => {
  const entries = parseAllowlist({
    entries: [{ id: 'RUSTSEC-1', reason: 'x', expires: '2026-11-01' }],
  });

  const result = evaluateAllowlist([unknownFinding('RUSTSEC-1')], entries, TODAY);

  assert.equal(result.status, 'pass');
  assert.equal(result.expired.length, 0);
});

test('an expired entry blocks its advisory and is reported', () => {
  const entries = parseAllowlist({
    entries: [{ id: 'RUSTSEC-1', reason: 'x', expires: '2026-10-31' }],
  });

  const result = evaluateAllowlist([unknownFinding('RUSTSEC-1')], entries, TODAY);

  assert.equal(result.status, 'fail');
  assert.equal(result.blocking.length, 1);
  assert.deepEqual(
    result.expired.map((entry) => entry.id),
    ['RUSTSEC-1']
  );
});

test('an expired entry fails even when its advisory is gone', () => {
  const entries = parseAllowlist({
    entries: [{ id: 'RUSTSEC-GONE', reason: 'x', expires: '2026-10-31' }],
  });

  const result = evaluateAllowlist([], entries, TODAY);

  assert.equal(result.status, 'fail');
  assert.equal(result.expired.length, 1);
});

test('an unmatched valid entry is reported but does not block', () => {
  const entries = parseAllowlist({
    entries: [{ id: 'RUSTSEC-GONE', reason: 'x', expires: '2027-01-31' }],
  });

  const result = evaluateAllowlist([], entries, TODAY);

  assert.equal(result.status, 'pass');
  assert.equal(result.unmatched.length, 1);
});

test('the committed osv-allowlist.json parses and has no expired entries', () => {
  const entries = parseAllowlist(
    JSON.parse(readFileSync(path.join(repoRoot, 'osv-allowlist.json'), 'utf8'))
  );

  const result = evaluateAllowlist([], entries, new Date());

  assert.equal(result.expired.length, 0, 'osv-allowlist.json has expired entries');
});
