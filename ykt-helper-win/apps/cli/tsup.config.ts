import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'ykt-cli': 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  noExternal: ['@ykt/contracts'],
  removeNodeProtocol: false,
  outDir: 'dist',
  clean: true,
});
