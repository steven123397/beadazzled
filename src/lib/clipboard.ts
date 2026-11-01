export type CopyResult = 'copied' | 'failed';

/**
 * Copies `text`, reporting the outcome instead of rejecting.
 *
 * A locked-down WebView can refuse `navigator.clipboard` (no secure context,
 * permission denied). The old selection-based path still works there, so it
 * stays as a fallback; when both fail the caller can tell the user instead of
 * leaving the click silently doing nothing.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // Fall through: the selection-based path needs no permission.
  }

  return fallbackCopy(text) ? 'copied' : 'failed';
}

function fallbackCopy(text: string): boolean {
  // `area.select()` moves focus; whoever pressed the button must get it back.
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  try {
    if (typeof document.execCommand !== 'function') {
      return false;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    try {
      area.select();
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(area);
    }
  } catch {
    return false;
  } finally {
    if (previous !== null && previous.isConnected) {
      previous.focus();
    }
  }
}
