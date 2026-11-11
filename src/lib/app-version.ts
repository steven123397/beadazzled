import { useEffect, useState } from 'react';

import { getVersion } from '@tauri-apps/api/app';

let versionPromise: Promise<string> | null = null;

/** Test hook: clear the process-wide request so a case can choose its result. */
export function resetAppVersion(): void {
  versionPromise = null;
}

/**
 * The application version, shared by every hook consumer in this process.
 *
 * A browser page (the e2e seam) has no plugin, so the value stays null there
 * and callers render "unknown" or omit the row instead of inventing a number.
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const request = (versionPromise ??= getVersion());
    void request
      .then((value) => {
        if (alive) {
          setVersion(value);
        }
      })
      .catch(() => {
        // A transient IPC failure must not poison every later mount. Do not
        // clear a newer request installed by the test reset hook.
        if (versionPromise === request) {
          versionPromise = null;
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return version;
}
