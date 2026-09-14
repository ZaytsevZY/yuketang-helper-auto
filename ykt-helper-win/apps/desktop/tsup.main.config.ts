import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'main/index.ts',
    'development-network-recorder': 'main/development-network-recorder.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  external: ['electron', 'node:sqlite'],
  noExternal: [/^@ykt\//, 'electron-squirrel-startup'],
  removeNodeProtocol: false,
  outDir: 'dist/main',
  clean: true,
});
