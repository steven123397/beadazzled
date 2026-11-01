import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Set by tauri when developing against a network device; empty for local dev.
const host = process.env.TAURI_DEV_HOST;

const tauriConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)), 'utf8')
) as {
  app: { security: { devCsp: Record<string, string | string[]> } };
};

function toCspHeader(policy: Record<string, string | string[]>): string {
  return Object.entries(policy)
    .map(
      ([directive, sources]) =>
        `${directive} ${Array.isArray(sources) ? sources.join(' ') : sources}`
    )
    .join('; ');
}

/**
 * Adds the network device Tauri is developing against to the origin lists.
 *
 * `TAURI_DEV_HOST` moves both the page and the HMR socket onto that host, so a
 * localhost-only policy would block them; the production policy is untouched.
 */
function withDevHost(
  policy: Record<string, string | string[]>,
  host: string
): Record<string, string | string[]> {
  const page = `http://${host}:1420`;
  const socket = `ws://${host}:1421`;
  const add = (directive: string, extra: string[]): string[] => {
    const current = policy[directive];
    const sources = current === undefined ? [] : Array.isArray(current) ? current : [current];
    return [...new Set([...sources, ...extra])];
  };

  return {
    ...policy,
    'default-src': add('default-src', [page]),
    'script-src': add('script-src', [page]),
    'style-src': add('style-src', [page]),
    'img-src': add('img-src', [page]),
    'font-src': add('font-src', [page]),
    'connect-src': add('connect-src', [page, socket]),
  };
}

// Tauri only injects CSP for its own asset protocol, so a devUrl document
// would run without any policy. Serve devCsp ourselves to keep dev honest.
function devCspPlugin(): Plugin {
  const policy = toCspHeader(
    host === undefined
      ? tauriConfig.app.security.devCsp
      : withDevHost(tauriConfig.app.security.devCsp, host)
  );

  return {
    name: 'beadazzled:dev-csp',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader('Content-Security-Policy', policy);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devCspPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri owns the dev process output; clearing the screen hides its logs.
  clearScreen: false,
  server: {
    // Tauri reads this exact URL from tauri.conf.json, so the port must be fixed.
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // WebView2 on Windows is the only target we ship in v0.1.0. Keep this the
    // default so a standalone `npm run build` produces the same bundle as the
    // Tauri-driven build.
    target: 'chrome105',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
