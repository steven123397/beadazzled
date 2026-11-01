// Pure helpers for the bindings drift check.
//
// The comparison mirrors git's line-ending normalization: a Windows checkout
// with core.autocrlf=true stores CRLF while ts-rs writes LF, and that
// difference alone must not count as drift.

function toLines(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function subtract(lines, otherLines) {
  const counts = new Map();
  for (const line of otherLines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const difference = [];
  for (const line of lines) {
    const count = counts.get(line) ?? 0;
    if (count > 0) {
      counts.set(line, count - 1);
    } else {
      difference.push(line);
    }
  }
  return difference;
}

export function compareBindings(committed, generated) {
  const before = toLines(committed);
  const after = toLines(generated);
  const added = subtract(after, before);
  const removed = subtract(before, after);

  return { drifted: added.length > 0 || removed.length > 0, added, removed };
}
