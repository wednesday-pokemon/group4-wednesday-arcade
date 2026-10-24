// Preview-only vite config: no HMR overlay / no full reloads while other files change (screenshots must not be hit by another agent's half-saved edit).
// node node_modules/vite/bin/vite.js --config tools/mystery-preview-vite.config.mjs --port 5261
import { defineConfig } from 'vite';
export default defineConfig({ root: process.cwd(), server: { hmr: false }, optimizeDeps: { noDiscovery: true } });
