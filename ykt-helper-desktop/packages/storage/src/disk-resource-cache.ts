import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  CachedResource,
  ResourceCache,
  ResourceCacheInput,
  ResourceCacheStats,
} from './types.js';
import { redactUrl } from './redaction.js';

interface CacheRow {
  filename: string;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  expires_at: number;
  size: number;
}

interface CacheSizeRow {
  entries: number;
  bytes: number;
}

export interface DiskResourceCacheOptions {
  directory: string;
  maxBytes?: number;
  maxEntryBytes?: number;
  now?: () => number;
}

export class DiskResourceCache implements ResourceCache {
  readonly #database: DatabaseSync;
  readonly #bodyDirectory: string;
  readonly #maxBytes: number;
  readonly #maxEntryBytes: number;
  readonly #now: () => number;

  private constructor(options: DiskResourceCacheOptions) {
    this.#bodyDirectory = join(options.directory, 'bodies');
    this.#maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
    this.#maxEntryBytes = options.maxEntryBytes ?? 32 * 1024 * 1024;
    this.#now = options.now ?? Date.now;
    this.#database = new DatabaseSync(join(options.directory, 'cache.sqlite'));
    this.#database.exec('PRAGMA journal_mode = WAL;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        cache_key TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT,
        etag TEXT,
        last_modified TEXT,
        expires_at INTEGER NOT NULL,
        size INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resources_accessed
        ON resources(last_accessed_at);
    `);
  }

  static async open(
    options: DiskResourceCacheOptions,
  ): Promise<DiskResourceCache> {
    await mkdir(join(options.directory, 'bodies'), { recursive: true });
    return new DiskResourceCache(options);
  }

  async match(url: string): Promise<CachedResource | null> {
    const key = cacheKey(url);
    const row = this.#database
      .prepare(
        `
        SELECT filename, content_type, etag, last_modified, expires_at, size
        FROM resources WHERE cache_key = ?
      `,
      )
      .get(key) as unknown as CacheRow | undefined;
    if (!row) return null;
    try {
      const body = await readFile(join(this.#bodyDirectory, row.filename));
      this.#database
        .prepare(
          'UPDATE resources SET last_accessed_at = ? WHERE cache_key = ?',
        )
        .run(this.#now(), key);
      return {
        url,
        body,
        contentType: row.content_type,
        etag: row.etag,
        lastModified: row.last_modified,
        expiresAt: row.expires_at,
        stale: row.expires_at <= this.#now(),
      };
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
      this.#database
        .prepare('DELETE FROM resources WHERE cache_key = ?')
        .run(key);
      return null;
    }
  }

  async put(
    url: string,
    input: ResourceCacheInput,
  ): Promise<CachedResource | null> {
    const headers = normalizeHeaders(input.headers ?? {});
    if (
      input.body.byteLength > this.#maxEntryBytes ||
      /(?:^|,)\s*no-store\b/i.test(headers['cache-control'] ?? '')
    ) {
      return null;
    }
    const key = cacheKey(url);
    const filename = `${key}${extensionFor(headers['content-type'])}`;
    await writeFile(join(this.#bodyDirectory, filename), input.body);
    const now = this.#now();
    const expiresAt = expiryTime(headers, now);
    const previous = this.#database
      .prepare('SELECT filename FROM resources WHERE cache_key = ?')
      .get(key) as { filename?: string } | undefined;
    this.#database
      .prepare(
        `
        INSERT INTO resources(
          cache_key, url, filename, content_type, etag, last_modified,
          expires_at, size, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          url = excluded.url,
          filename = excluded.filename,
          content_type = excluded.content_type,
          etag = excluded.etag,
          last_modified = excluded.last_modified,
          expires_at = excluded.expires_at,
          size = excluded.size,
          last_accessed_at = excluded.last_accessed_at
      `,
      )
      .run(
        key,
        redactUrl(url),
        filename,
        headers['content-type'] ?? null,
        headers.etag ?? null,
        headers['last-modified'] ?? null,
        expiresAt,
        input.body.byteLength,
        now,
      );
    if (previous?.filename && previous.filename !== filename) {
      await removeFile(join(this.#bodyDirectory, previous.filename));
    }
    await this.prune();
    return this.match(url);
  }

  async delete(url: string): Promise<void> {
    const key = cacheKey(url);
    const row = this.#database
      .prepare('SELECT filename FROM resources WHERE cache_key = ?')
      .get(key) as { filename?: string } | undefined;
    this.#database
      .prepare('DELETE FROM resources WHERE cache_key = ?')
      .run(key);
    if (row?.filename)
      await removeFile(join(this.#bodyDirectory, row.filename));
  }

  async clear(): Promise<void> {
    const rows = this.#database
      .prepare('SELECT filename FROM resources')
      .all() as unknown as { filename: string }[];
    this.#database.exec('DELETE FROM resources');
    await Promise.all(
      rows.map((row) => removeFile(join(this.#bodyDirectory, row.filename))),
    );
  }

  async prune(): Promise<void> {
    let current = this.stats().bytes;
    if (current <= this.#maxBytes) return;
    const rows = this.#database
      .prepare(
        'SELECT cache_key, filename, size FROM resources ORDER BY last_accessed_at ASC',
      )
      .all() as unknown as {
      cache_key: string;
      filename: string;
      size: number;
    }[];
    for (const row of rows) {
      this.#database
        .prepare('DELETE FROM resources WHERE cache_key = ?')
        .run(row.cache_key);
      await removeFile(join(this.#bodyDirectory, row.filename));
      current -= row.size;
      if (current <= this.#maxBytes) break;
    }
  }

  stats(): ResourceCacheStats {
    const row = this.#database
      .prepare(
        'SELECT COUNT(*) AS entries, COALESCE(SUM(size), 0) AS bytes FROM resources',
      )
      .get() as unknown as CacheSizeRow;
    return { entries: row.entries, bytes: row.bytes, maxBytes: this.#maxBytes };
  }

  close(): void {
    this.#database.close();
  }
}

function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function expiryTime(headers: Record<string, string>, now: number): number {
  if (/\bno-cache\b/i.test(headers['cache-control'] ?? '')) return now;
  const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(
    headers['cache-control'] ?? '',
  )?.[1];
  if (maxAge) return now + Number(maxAge) * 1000;
  const expires = Date.parse(headers.expires ?? '');
  return Number.isFinite(expires) ? expires : now + 24 * 60 * 60 * 1000;
}

function extensionFor(contentType: string | undefined): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  if (type === 'application/pdf') return '.pdf';
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'application/json') return '.json';
  return '.bin';
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
