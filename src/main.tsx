import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { readE2EState } from './app/e2e';
import './styles/globals.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element');
}

// Dev-only hook for Playwright; production builds drop this branch.
const e2e = import.meta.env.DEV ? readE2EState() : undefined;
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
