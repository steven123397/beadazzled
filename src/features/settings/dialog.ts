/**
 * Opens the OS file picker for the bd executable.
 *
 * The plugin is imported lazily so the settings route chunk only pays for it
 * when the page is opened. A cancelled dialog resolves to null; a missing
 * plugin (the browser e2e page has no Tauri runtime) rejects, and the caller
 * shows the error rather than pretending the user cancelled.
 */
export async function pickBdExecutable(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'bd', extensions: ['exe'] }],
  });
  return typeof selected === 'string' ? selected : null;
}
