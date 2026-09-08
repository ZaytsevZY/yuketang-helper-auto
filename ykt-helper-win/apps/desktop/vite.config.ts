import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const desktopRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: `${desktopRoot}renderer`,
  base: './',
  plugins: [vue()],
  build: {
    outDir: `${desktopRoot}dist/renderer`,
    emptyOutDir: true,
  },
});
