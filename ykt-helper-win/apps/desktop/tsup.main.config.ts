import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'main/index.ts',
    'web-probe-worker': 'main/web-probe-worker.ts',
    'development-network-recorder': 'main/development-network-recorder.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  external: ['electron', 'node:sqlite'],
  noExternal: [/^@ykt\//, 'electron-squirrel-startup', 'acorn'],
  removeNodeProtocol: false,
  outDir: 'dist/main',
  clean: true,
});
