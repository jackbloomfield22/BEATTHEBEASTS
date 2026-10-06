import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { realpathSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { characterizationDevApi } from './tools/dev/characterization-api.ts';

export default defineConfig({
  plugins: [react(), characterizationDevApi()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  // Agent worktrees and debug output live under .claude; edits there must not reload the dev page.
  server: {
    host: true,
    watch: { ignored: ['**/.claude/**', '**/tools/shots/out/**'] },
    // A worktree's node_modules is a symlink to the main checkout's: allow its real path, or the fonts 403.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')] },
  },
});
