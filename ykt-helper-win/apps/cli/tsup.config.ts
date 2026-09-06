import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'ykt-cli': 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  noExternal: ['@ykt/contracts'],
  outDir: 'dist',
  clean: true,
});
