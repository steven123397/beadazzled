// Deterministic guard for .beads/config.yaml.
//
// bd 1.3.2 refuses to write secret keys into a git-tracked config file, but
// `--force-git-tracked` and manual edits bypass that guard, and gitleaks only
// recognizes known token shapes. This parser flags active YAML keys whose
// final segment looks secret, including the nested form bd uses:
//
//   github:
//       token: ...
//
// Comment lines are ignored so bd's own documentation of the secret keys does
// not trip the check.

const SECRET_KEY_PATTERN =
  /(?:^|\.)(?:token|api[_-]?key|api[_-]?token|access[_-]?token|password|secret|credential|credentials)$/i;

export function findSecretConfigKeys(text) {
  const findings = [];
  const stack = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const match = /^([^:#]+?)\s*:(?:\s*(.*))?$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = (match[2] ?? '').trim();
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1].key : undefined;
    const fullKey = parent ? `${parent}.${key}` : key;
    if (SECRET_KEY_PATTERN.test(fullKey)) {
      findings.push(fullKey);
    }

    if (value === '' || value.startsWith('#')) {
      stack.push({ indent, key: fullKey });
    }
  }

  return findings;
}
