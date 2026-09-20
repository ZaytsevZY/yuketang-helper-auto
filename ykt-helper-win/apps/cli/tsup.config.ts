import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'ykt-cli': 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  noExternal: [
    '@ykt/contracts',
    '@ykt/backend',
    '@ykt/routing',
    '@ykt/storage',
    'tough-cookie',
    'tldts',
    'tldts-core',
  ],
  removeNodeProtocol: false,
  outDir: 'dist',
  clean: true,
});
