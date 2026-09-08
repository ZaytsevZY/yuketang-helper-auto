import { copyFile, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'desktop');
const generatedDirectories = ['main', 'preload', 'renderer', 'cli'];
const mainBundlePath = join(
  root,
  'apps',
  'desktop',
  'dist',
  'main',
  'index.cjs',
);

const mainBundle = await readFile(mainBundlePath, 'utf8');
if (/require\(["']@ykt\//.test(mainBundle)) {
  throw new Error('Desktop bundle still contains an external @ykt dependency.');
}
if (/require\(["']sqlite["']\)/.test(mainBundle)) {
  throw new Error('Desktop bundle stripped the node: prefix from node:sqlite.');
}

for (const directory of generatedDirectories) {
  await rm(join(packageRoot, directory), { recursive: true, force: true });
}

await Promise.all([
  cp(join(root, 'apps', 'desktop', 'dist', 'main'), join(packageRoot, 'main'), {
    recursive: true,
  }),
  cp(
    join(root, 'apps', 'desktop', 'dist', 'preload'),
    join(packageRoot, 'preload'),
    { recursive: true },
  ),
  cp(
    join(root, 'apps', 'desktop', 'dist', 'renderer'),
    join(packageRoot, 'renderer'),
    { recursive: true },
  ),
]);

await mkdir(join(packageRoot, 'cli'), { recursive: true });
await copyFile(
  join(root, 'apps', 'cli', 'dist', 'ykt-cli.cjs'),
  join(packageRoot, 'cli', 'ykt-cli.cjs'),
);

console.log(`Prepared Electron package body at ${packageRoot}`);
