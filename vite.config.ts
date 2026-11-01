import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Set by tauri when developing against a network device; empty for local dev.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
