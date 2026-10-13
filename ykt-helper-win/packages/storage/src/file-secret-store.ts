import {
  copyFile,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import type { SecretCodec, SecretStore } from './types.js';

export interface FileSecretStoreOptions {
  readonly onRecovery?: (source: 'backup' | 'empty') => void | Promise<void>;
}

// Electron's single-instance lock excludes other processes. Windows recreation
// can still leave multiple store objects alive, so serialize by resolved path.
const operations = new Map<string, Promise<void>>();

export class FileSecretStore implements SecretStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
    private readonly options: FileSecretStoreOptions = {},
  ) {
    this.path = resolve(path);
    mkdirSync(dirname(path), { recursive: true });
  }

  async get(key: string): Promise<string | null> {
    return this.serialize(async () => {
      const values = await this.readValues();
      const encoded = values[key];
      return encoded
        ? this.codec.decrypt(Buffer.from(encoded, 'base64'))
        : null;
    });
  }

  async set(key: string, value: string): Promise<void> {
    return this.serialize(async () => {
      const values = await this.readValues();
      values[key] = Buffer.from(this.codec.encrypt(value)).toString('base64');
      await this.writeValues(values);
    });
  }

  async delete(key: string): Promise<void> {
    return this.serialize(async () => {
      const values = await this.readValues();
      delete values[key];
      await this.writeValues(values);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = operations.get(this.path) ?? Promise.resolve();
    const request = pending.then(operation);
    // A failed update must neither poison the queue nor discard later writes.
    const complete = request.then(
      () => undefined,
      () => undefined,
    );
    operations.set(this.path, complete);
    void complete.then(() => {
      if (operations.get(this.path) === complete) operations.delete(this.path);
    });
    return request;
  }

  private async readValues(): Promise<Record<string, string>> {
    let text: string | undefined;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }
    const values = text === undefined ? null : parseValues(text);
    if (values) return values;
    let backup: Record<string, string> | null = null;
    try {
      backup = parseValues(await readFile(`${this.path}.bak`, 'utf8'));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    if (!backup && text?.trim()) {
      // Never silently overwrite a nonempty damaged credential store.
      throw new Error('凭据文件损坏且无可用备份，请恢复凭据文件后重试。');
    }
    if (!backup && text === undefined) return {};
    if (text !== undefined)
      await copyFile(this.path, `${this.path}.corrupt-${randomUUID()}`);
    const recovered = backup ?? {};
    await this.writeValues(recovered);
    try {
      await this.options.onRecovery?.(backup ? 'backup' : 'empty');
    } catch {
      /* Diagnostics must not prevent credential recovery. */
    }
    return recovered;
  }

  private async writeValues(values: Record<string, string>): Promise<void> {
    const text = JSON.stringify(values);
    // Never truncate the committed file. A killed process can only leave a
    // partial temporary file; the primary and backup remain valid JSON.
    await atomicWrite(this.path, text);
    await atomicWrite(`${this.path}.bak`, text);
  }
}

function parseValues(text: string): Record<string, string> | null {
  try {
    const values: unknown = JSON.parse(text);
    return values !== null &&
      typeof values === 'object' &&
      !Array.isArray(values) &&
      Object.values(values).every((value) => typeof value === 'string')
      ? (Object.assign(Object.create(null), values) as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const file = await open(temporary, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
