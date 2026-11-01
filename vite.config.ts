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

// Tauri only injects CSP for its own asset protocol, so a devUrl document
// would run without any policy. Serve devCsp ourselves to keep dev honest.
function devCspPlugin(): Plugin {
  const policy = toCspHeader(tauriConfig.app.security.devCsp);

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
