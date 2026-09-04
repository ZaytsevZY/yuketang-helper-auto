import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  DefaultAppSettings,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type JsonValue,
  type NewAppLogEntry,
  type UserProfile,
} from '@ykt/contracts';

import { assertSafeSettingKeys, redactJson, redactText } from './redaction.js';
import type { AppDataExport, AppDataStore, CachedDocument } from './types.js';

interface SettingRow {
  key: string;
  value: string;
}

interface UserRow {
  environment: BrowserEnvironment;
  user_id: string;
  name: string;
  updated_at: string;
}

interface LogRow {
  id: number;
  timestamp: string;
  level: AppLogEntry['level'];
  scope: string;
  message: string;
  details: string | null;
}

interface DocumentRow {
  key: string;
  kind: CachedDocument['kind'];
  value: string;
  updated_at: string;
  expires_at: string | null;
}

export class SqliteAppDataStore implements AppDataStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        environment TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS logs_timestamp ON logs(timestamp);
      CREATE TABLE IF NOT EXISTS documents (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS documents_expiry ON documents(expires_at);
    `);
  }

  async getSettings(): Promise<AppSettings> {
    const rows = this.#database
      .prepare('SELECT key, value FROM settings')
      .all() as unknown as SettingRow[];
    const stored = Object.fromEntries(
      rows.map((row) => [row.key, JSON.parse(row.value) as JsonValue]),
    );
    return { ...DefaultAppSettings, ...stored };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    assertSafeSettingKeys(patch);
    const statement = this.#database.prepare(`
      INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) statement.run(key, JSON.stringify(value), now);
      }
    });
    return this.getSettings();
  }

  async getUser(environment: BrowserEnvironment): Promise<UserProfile | null> {
    const row = this.#database
      .prepare(
        'SELECT environment, user_id, name, updated_at FROM users WHERE environment = ?',
      )
      .get(environment) as unknown as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  async saveUser(user: UserProfile): Promise<void> {
    this.#database
      .prepare(
        `
        INSERT INTO users(environment, user_id, name, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(environment) DO UPDATE SET
          user_id = excluded.user_id,
          name = excluded.name,
          updated_at = excluded.updated_at
      `,
      )
      .run(user.environment, user.id, user.name, user.updatedAt);
  }

  async appendLog(entry: NewAppLogEntry): Promise<void> {
    const details =
      entry.details === undefined ? null : redactJson(entry.details);
    this.#database
      .prepare(
        'INSERT INTO logs(timestamp, level, scope, message, details) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        entry.timestamp ?? new Date().toISOString(),
        entry.level,
        redactText(entry.scope),
        redactText(entry.message),
        details === null ? null : JSON.stringify(details),
      );
    this.#database.exec(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs ORDER BY id DESC LIMIT 5000
      )
    `);
  }

  async listLogs(limit = 200): Promise<readonly AppLogEntry[]> {
    const safeLimit = Math.max(1, Math.min(5000, Math.trunc(limit)));
    const rows = this.#database
      .prepare(
        'SELECT id, timestamp, level, scope, message, details FROM logs ORDER BY id DESC LIMIT ?',
      )
      .all(safeLimit) as unknown as LogRow[];
    return rows.map(mapLog);
  }

  async getDocument(key: string): Promise<CachedDocument | null> {
    const row = this.#database
      .prepare(
        'SELECT key, kind, value, updated_at, expires_at FROM documents WHERE key = ?',
      )
      .get(key) as unknown as DocumentRow | undefined;
    return row ? mapDocument(row) : null;
  }

  async putDocument(document: CachedDocument): Promise<void> {
    this.#database
      .prepare(
        `
        INSERT INTO documents(key, kind, value, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          kind = excluded.kind,
          value = excluded.value,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
      `,
      )
      .run(
        document.key,
        document.kind,
        JSON.stringify(redactJson(document.value)),
        document.updatedAt,
        document.expiresAt,
      );
  }

  async cleanup(now = Date.now()): Promise<void> {
    const settings = await this.getSettings();
    const cutoff = new Date(
      now - settings.logRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.#database.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoff);
    this.#database
      .prepare(
        'DELETE FROM documents WHERE expires_at IS NOT NULL AND expires_at <= ?',
      )
      .run(new Date(now).toISOString());
  }

  async exportData(): Promise<AppDataExport> {
    const users = this.#database
      .prepare('SELECT environment, user_id, name, updated_at FROM users')
      .all() as unknown as UserRow[];
    const documents = this.#database
      .prepare('SELECT key, kind, value, updated_at, expires_at FROM documents')
      .all() as unknown as DocumentRow[];
    return {
      settings: await this.getSettings(),
      users: users.map(mapUser),
      logs: await this.listLogs(5000),
      documents: documents.map(mapDocument),
    };
  }

  close(): void {
    this.#database.close();
  }

  private transaction(work: () => void): void {
    this.#database.exec('BEGIN');
    try {
      work();
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }
}

function mapUser(row: UserRow): UserProfile {
  return {
    environment: row.environment,
    id: row.user_id,
    name: row.name,
    updatedAt: row.updated_at,
  };
}

function mapLog(row: LogRow): AppLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    scope: row.scope,
    message: row.message,
    details: row.details ? (JSON.parse(row.details) as JsonValue) : null,
  };
}

function mapDocument(row: DocumentRow): CachedDocument {
  return {
    key: row.key,
    kind: row.kind,
    value: JSON.parse(row.value) as JsonValue,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}
