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

createRoot(container).render(
  <StrictMode>
    <App
      issues={e2e?.issues}
      syncState={e2e?.syncState}
      initialLanguage={e2e?.language}
      initialTheme={e2e?.theme}
    />
  </StrictMode>
);
