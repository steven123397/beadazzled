import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// .ts suites that need the jsdom project: they touch the DOM, browser
// storage, renderHook, or import the CSS tokens (css is only enabled there).
// Every other .ts suite is pure logic and runs in node. New .ts suites
// default to node — add jsdom-dependent ones here instead.
const jsdomTsSuites = [
  'src/features/board/position.test.ts',
  'src/lib/clipboard.test.ts',
  'src/lib/dom/focus.test.ts',
  'src/lib/i18n/i18n.test.ts',
  'src/lib/navigation-guard.test.ts',
  'src/lib/shell/layout.test.ts',
  'src/lib/theme/contrast.test.ts',
  'src/lib/theme/theme.test.ts',
  'src/lib/view/useVirtualFocus.test.ts',
  'src/lib/workspace/useWorkspace.test.ts',
  'src/lib/writes/useWrite.test.ts',
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Pinned against future default changes: suites rely on vi.mock,
    // vi.hoisted and module-level mutable state, so isolation must stay on.
    pool: 'forks',
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
    },
    // Creating a jsdom environment per file is the dominant test cost, so
    // pure-logic suites run in the node project with no setup files (which
    // also skips loading the testing-library packages there).
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [],
          include: ['src/**/*.test.ts', 'src/app/shell/SyncStatus.test.tsx'],
          exclude: [...configDefaults.exclude, ...jsdomTsSuites],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          css: true,
          setupFiles: ['src/test/setup.ts'],
          include: ['src/**/*.test.tsx', ...jsdomTsSuites],
          // SyncStatus.test.tsx exercises pure label logic, not the DOM.
          exclude: [...configDefaults.exclude, 'src/app/shell/SyncStatus.test.tsx'],
        },
      },
    ],
  },
});
