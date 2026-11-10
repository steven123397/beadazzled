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

/** True only for the view itself or a ticket row, not surrounding controls. */
export function isViewTarget(target: EventTarget | null): boolean {
  if (target === null) {
    return false;
  }
  // jsdom can hand back a Window whose identity differs from the global, so
  // match by type as well as identity.
  if (
    target === window ||
    target === document ||
    target === document.body ||
    (typeof Window !== 'undefined' && target instanceof Window)
  ) {
    return true;
  }
  if (!(target instanceof Element)) {
    return false;
  }
  // A control inside the view (a filter summary, Clear, Retry) must keep its
  // native Enter behavior instead of opening the focused ticket.
  return target.closest('[data-issue-id]') !== null || target.getAttribute('role') === 'list';
}
