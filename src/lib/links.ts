/** Only web links leave the app; everything else stays inert. */
export function isExternalUrl(href: string | undefined): href is string {
  if (href === undefined) {
    return false;
  }
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Opens a link in the user's default browser. The caller has already checked
 * the scheme; this guard keeps a future call site from forwarding arbitrary
 * URLs to the OS handler.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isExternalUrl(url)) {
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
