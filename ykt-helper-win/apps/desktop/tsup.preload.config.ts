import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['preload/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  external: ['electron'],
  noExternal: ['@ykt/contracts'],
  removeNodeProtocol: false,
  outDir: 'dist/preload',
  clean: true,
});
