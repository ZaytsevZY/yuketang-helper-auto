import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['preload/index.ts'],
  format: ['cjs'],
  platform: 'node',
  external: ['electron'],
  noExternal: ['@ykt/contracts'],
  outDir: 'dist/preload',
  clean: true,
});
