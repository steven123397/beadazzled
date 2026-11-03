import type { Shortcut } from './types';

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type PendingSequence = { prefix: string; at: number } | null;

export type ResolveOptions = {
  now?: number;
  pending?: PendingSequence;
  editable?: boolean;
  /** Longest gap allowed between the two keys of a chord. */
  timeout?: number;
};

const SEQUENCE_TIMEOUT_MS = 800;

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph', 'capslock', 'dead']);

const KEY_LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': 'Space',
  escape: 'Esc',
};

/** Normalizes a key press to the same form used in shortcut definitions. */
export function keyToken(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) {
    return null;
  }
  if (event.altKey === true) {
    return null;
  }

  let token = event.key.toLowerCase();
  // Shift is meaningful for navigation keys but already reflected in the
  // character for letters and symbols, so only prefix it for arrows.
  if (event.shiftKey === true && token.startsWith('arrow')) {
    token = `shift+${token}`;
  }
  if (event.ctrlKey === true || event.metaKey === true) {
    token = `mod+${token}`;
  }

  return token;
}

/** True when a modal dialog is open; single-key shortcuts must stay inside it. */
export function isOverlayOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: (selector: string) => Element | null;
    getAttribute?: (name: string) => string | null;
  };
  if (typeof element.tagName === 'string') {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return true;
    }
  }
  if (element.isContentEditable === true) {
    return true;
  }
  if (typeof element.closest === 'function') {
    // A `<summary>` is the trigger of a dropdown or disclosure. It replaces
    // the native `<select>` in the detail rail and the filter bar, so it has
    // to keep the same protection: while it owns focus, single-key shortcuts
    // must not act on the page behind it.
    if (element.closest('summary') !== null) {
      return true;
    }
    // A contenteditable host often contains focusable descendants (spans, code
    // blocks); checking only the event target would let single-key shortcuts
    // fire inside an editor.
    const host = element.closest('[contenteditable]');
    if (host !== null) {
      return host.getAttribute('contenteditable') !== 'false';
    }
  }
  // jsdom does not implement isContentEditable; fall back to the attribute.
  if (typeof element.getAttribute === 'function') {
    const value = element.getAttribute('contenteditable');
    return value !== null && value !== 'false';
  }
  return false;
}

function bindingKeys(shortcut: Shortcut): readonly string[] {
  return typeof shortcut.keys === 'string' ? [shortcut.keys] : shortcut.keys;
}

function isChord(shortcut: Shortcut): boolean {
  return bindingKeys(shortcut).length > 1;
}

function isSingleKey(shortcut: Shortcut): boolean {
  const [key] = bindingKeys(shortcut);
  return key !== undefined && !key.includes('+');
}

/**
 * Matches one key press against the registered shortcuts. Returns the fired
 * shortcut, if any, plus the chord prefix that should stay pending.
 */
export function resolveShortcut<T extends Shortcut>(
  shortcuts: readonly T[],
  event: KeyEventLike,
  options: ResolveOptions = {}
): { binding: T | null; pending: PendingSequence } {
  const now = options.now ?? 0;
  const timeout = options.timeout ?? SEQUENCE_TIMEOUT_MS;
  const pending = options.pending ?? null;
  const editable = options.editable === true;
  const token = keyToken(event);

  if (token === null) {
    return { binding: null, pending };
  }

  if (pending !== null && now - pending.at <= timeout) {
    const chord = shortcuts.find(
      (shortcut) =>
        isChord(shortcut) &&
        bindingKeys(shortcut)[0] === pending.prefix &&
        bindingKeys(shortcut)[1] === token
    );
    if (chord !== undefined) {
      return { binding: chord, pending: null };
    }
  }
  // A chord miss or an expired prefix must not swallow the current key: treat
  // it as a fresh press so direct shortcuts and new chords still work.
  const direct = shortcuts.find(
    (shortcut) => bindingKeys(shortcut).length === 1 && bindingKeys(shortcut)[0] === token
  );
  if (direct !== undefined) {
    if (editable && isSingleKey(direct) && direct.allowInInput !== true) {
      return { binding: null, pending: null };
    }
    return { binding: direct, pending: null };
  }

  const chordStart = shortcuts.find(
    (shortcut) => isChord(shortcut) && bindingKeys(shortcut)[0] === token
  );
  if (chordStart !== undefined && (!editable || chordStart.allowInInput === true)) {
    return { binding: null, pending: { prefix: token, at: now } };
  }

  return { binding: null, pending: null };
}

/** Human-readable key label for the help panel. */
export function formatKeys(keys: string | readonly string[]): string {
  const list = typeof keys === 'string' ? [keys] : keys;

  return list.map(formatKey).join(' then ');
}

function formatKey(key: string): string {
  const parts = key.split('+');
  const last = parts.pop() ?? '';

  return [
    ...parts.map((part) =>
      part === 'mod' ? 'Ctrl' : part === 'shift' ? 'Shift' : part === 'alt' ? 'Alt' : part
    ),
    KEY_LABELS[last] ?? last.toUpperCase(),
  ].join('+');
}
