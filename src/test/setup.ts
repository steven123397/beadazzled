import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// cmdk measures its list; jsdom implements neither API.
if (globalThis.ResizeObserver === undefined) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
if (globalThis.Element !== undefined && globalThis.Element.prototype.scrollIntoView === undefined) {
  globalThis.Element.prototype.scrollIntoView = () => undefined;
}
