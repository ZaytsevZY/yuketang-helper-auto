#!/usr/bin/env node
import process from 'node:process';

import { createBackendRuntime } from '@ykt/backend';
import { YuketangError } from '@ykt/contracts';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status';
  if (command !== 'status') {
    process.stderr.write(`Unknown command: ${command}\nUsage: ykt status\n`);
    process.exitCode = 2;
    return;
  }

  const runtime = createBackendRuntime();
  try {
    await runtime.start();
    process.stdout.write(
      `${JSON.stringify(await runtime.facade.getStatus())}\n`,
    );
  } finally {
    await runtime.stop();
  }
}

main().catch((error: unknown) => {
  const payload =
    error instanceof YuketangError
      ? { code: error.code, message: error.message }
      : { code: 'INTERNAL_ERROR', message: 'Unexpected CLI failure.' };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
