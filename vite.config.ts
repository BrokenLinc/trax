import { defineConfig, type ServerOptions } from 'vite';

// Tauri expects a fixed dev port and forwards env vars at build time.
// See https://v2.tauri.app/start/frontend/vite/.
const host = process.env['TAURI_DEV_HOST'];

const server: ServerOptions = {
  port: 5173,
  strictPort: true,
  host: host ?? false,
  watch: {
    ignored: ['**/src-tauri/**', '**/artifacts/**'],
  },
};
if (host) server.hmr = { protocol: 'ws', host, port: 5174 };

export default defineConfig({
  base: './',
  clearScreen: false,
  server,
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    // Three.js is ~560KB on its own; raise the threshold so the warning is
    // signal, not noise.
    chunkSizeWarningLimit: 800,
  },
});
