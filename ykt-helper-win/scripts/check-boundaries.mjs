import { builtinModules } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = new URL('..', import.meta.url);
const sourceRoots = [
  'apps/cli/src',
  'apps/desktop/main',
  'apps/desktop/preload',
  'apps/desktop/renderer',
  'packages/contracts/src',
  'packages/routing/src',
  'packages/storage/src',
  'packages/backend/src',
];
const internalPackages = [
  '@ykt/contracts',
  '@ykt/routing',
  '@ykt/storage',
  '@ykt/backend',
];
const packageRules = new Map([
  ['packages/contracts/src', []],
  ['packages/routing/src', ['@ykt/contracts']],
  ['packages/storage/src', ['@ykt/contracts']],
  ['packages/backend/src', ['@ykt/contracts', '@ykt/routing', '@ykt/storage']],
  ['apps/cli/src', ['@ykt/contracts', '@ykt/backend']],
  ['apps/desktop/main', ['@ykt/contracts', '@ykt/backend']],
  ['apps/desktop/preload', ['@ykt/contracts']],
  ['apps/desktop/renderer', ['@ykt/contracts']],
]);
const nodeModules = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'electron',
]);
const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

async function collectFiles(directory) {
  const entries = await readdir(new URL(`${directory}/`, workspaceRoot), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (['.ts', '.vue'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  const allowed = packageRules.get(sourceRoot) ?? [];
  const absoluteSourceRoot = fileURLToPath(
    new URL(`${sourceRoot}/`, workspaceRoot),
  );
  const sourceRootPrefix = absoluteSourceRoot.endsWith(sep)
    ? absoluteSourceRoot
    : `${absoluteSourceRoot}${sep}`;
  for (const file of await collectFiles(sourceRoot)) {
    const absoluteFile = fileURLToPath(new URL(file, workspaceRoot));
    const content = await readFile(absoluteFile, 'utf8');
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const internal = internalPackages.find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (internal && !allowed.includes(internal)) {
        violations.push(`${file}: cannot import ${specifier}`);
      }
      if (
        sourceRoot === 'apps/desktop/renderer' &&
        nodeModules.has(specifier)
      ) {
        violations.push(`${file}: renderer cannot import ${specifier}`);
      }
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(absoluteFile), specifier);
        if (!target.startsWith(sourceRootPrefix)) {
          violations.push(
            `${file}: relative import crosses its package boundary`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Package dependency boundaries are valid.');
}
