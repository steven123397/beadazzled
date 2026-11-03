import { useEffect, useState } from 'react';

import { getVersion } from '@tauri-apps/api/app';

/**
 * The application version, read once from the Tauri app plugin.
 *
 * A browser page (the e2e seam) has no plugin, so the value stays null there
 * and callers render "unknown" or omit the row instead of inventing a number.
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getVersion().then(
      (value) => {
        if (alive) {
          setVersion(value);
        }
      },
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, []);

  return version;
}
