import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { readE2EState } from './app/e2e';
import { blockWindowDrops } from './lib/navigation-guard';
import './styles/globals.css';

// A dropped link would navigate the webview away from the app shell.
blockWindowDrops();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element');
}

// Dev-only hook for Playwright; production builds drop this branch unless a
// benchmark build explicitly opts in with VITE_E2E=1.
const e2e = import.meta.env.DEV || import.meta.env.VITE_E2E === '1' ? readE2EState() : undefined;
// The browser e2e/dev pages have no Tauri IPC; only the real shell may start
// the sync worker. The fake bridge also sets `__BEADAZZLED_E2E__`, so it is
// excluded by the first check.
const syncEnabled = e2e === undefined && '__TAURI_INTERNALS__' in window;

createRoot(container).render(
  <StrictMode>
    <App
      issues={e2e?.issues}
      syncState={e2e?.syncState}
      initialLanguage={e2e?.language}
      initialTheme={e2e?.theme}
      syncEnabled={syncEnabled}
    />
  </StrictMode>
);
