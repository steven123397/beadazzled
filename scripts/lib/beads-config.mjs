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
// It also covers YAML list items (`- token: ...`), composite suffixes
// (`client_secret`, `oauth_token`) and a leading UTF-8 BOM. Comment lines are
// ignored so bd's own documentation of the secret keys does not trip the
// check. Inline flow maps (`github: {token: x}`) and quoted keys remain out of
// scope, as recorded in ADR-0006.

// Matches the last dot-separated segment of a key. The `(?:^|[_-])` prefix
// accepts composites while rejecting words that merely end in a secret-ish
// substring.
const SECRET_SEGMENT = /(?:^|[_-])(?:token|api[_-]?key|password|secret|credentials?)$/i;
const LIST_ITEM = /^-\s+(.*)$/;

// A leading BOM is not part of the first key. `trim` happens to drop U+FEFF,
// but relying on that is invisible; strip it explicitly.
function withoutBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isSecretKey(fullKey) {
  return fullKey.split('.').some((segment) => SECRET_SEGMENT.test(segment));
}

export function findSecretConfigKeys(text) {
  const findings = [];
  const stack = [];

  for (const rawLine of withoutBom(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const content = LIST_ITEM.exec(trimmed)?.[1] ?? trimmed;
    const match = /^([^:#]+?)\s*:(?:\s*(.*))?$/.exec(content);
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
    if (isSecretKey(fullKey)) {
      findings.push(fullKey);
    }

    if (value === '' || value.startsWith('#')) {
      stack.push({ indent, key: fullKey });
    }
  }

  return findings;
}
