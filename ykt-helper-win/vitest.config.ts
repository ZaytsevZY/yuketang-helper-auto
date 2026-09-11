import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@ykt/contracts': `${root}packages/contracts/src/index.ts`,
      '@ykt/routing': `${root}packages/routing/src/index.ts`,
      '@ykt/storage': `${root}packages/storage/src/index.ts`,
      '@ykt/backend': `${root}packages/backend/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
