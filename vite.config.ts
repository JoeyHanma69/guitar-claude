import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// WEB_ONLY=1 runs just the renderer in a browser (no Electron window) —
// used for UI iteration and automated preview checks.
const webOnly = Boolean(process.env.WEB_ONLY);

export default defineConfig({
  // Relative asset paths: works from file:// in the packaged Electron app AND
  // from a GitHub Pages subpath (/guitar-claude/).
  base: './',
  plugins: [
    react(),
    ...(webOnly
      ? []
      : [
          electron({
            main: {
              entry: 'src/main/main.ts',
            },
            preload: {
              input: 'src/preload/preload.ts',
            },
          }),
        ]),
  ],
  build: {
    outDir: 'dist',
  },
});
