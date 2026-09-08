import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SecretCodec, SecretStore } from './types.js';

export class FileSecretStore implements SecretStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async get(key: string): Promise<string | null> {
    const values = await this.readValues();
    const encoded = values[key];
    return encoded ? this.codec.decrypt(Buffer.from(encoded, 'base64')) : null;
  }

  async set(key: string, value: string): Promise<void> {
    const values = await this.readValues();
    values[key] = Buffer.from(this.codec.encrypt(value)).toString('base64');
    await this.writeValues(values);
  }

  async delete(key: string): Promise<void> {
    const values = await this.readValues();
    delete values[key];
    await this.writeValues(values);
  }

  private async readValues(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Record<
        string,
        string
      >;
    } catch (error: unknown) {
      if (isMissingFile(error)) return {};
      throw error;
    }
  }

  private async writeValues(values: Record<string, string>): Promise<void> {
    await writeFile(this.path, JSON.stringify(values), 'utf8');
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
