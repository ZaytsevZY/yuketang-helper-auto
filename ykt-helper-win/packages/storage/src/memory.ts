import {
  DefaultAppSettings,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type JsonValue,
  type NewAppLogEntry,
  type UserProfile,
} from '@ykt/contracts';

import type {
  AppDataExport,
  AppDataStore,
  CachedDocument,
  SecretStore,
} from './types.js';
import { assertSafeSettingKeys, redactJson, redactText } from './redaction.js';

export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly #values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.#values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.#values.set(key, value);
  }
}

export class MemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#values.delete(key);
  }
}

export class MemoryAppDataStore implements AppDataStore {
  #settings: AppSettings = { ...DefaultAppSettings };
  readonly #users = new Map<BrowserEnvironment, UserProfile>();
  readonly #logs: AppLogEntry[] = [];
  readonly #documents = new Map<string, CachedDocument>();

  async getSettings(): Promise<AppSettings> {
    return { ...this.#settings };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    assertSafeSettingKeys(patch);
    const values = Object.fromEntries(
      Object.entries(patch).filter((entry) => entry[1] !== undefined),
    ) as Record<string, JsonValue>;
    this.#settings = { ...this.#settings, ...values };
    return this.getSettings();
  }

  async getUser(environment: BrowserEnvironment): Promise<UserProfile | null> {
    return this.#users.get(environment) ?? null;
  }

  async saveUser(user: UserProfile): Promise<void> {
    this.#users.set(user.environment, user);
  }

  async appendLog(entry: NewAppLogEntry): Promise<void> {
    this.#logs.push({
      id: this.#logs.length + 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      level: entry.level,
      scope: redactText(entry.scope),
      message: redactText(entry.message),
      details: entry.details === undefined ? null : redactJson(entry.details),
    });
  }

  async listLogs(limit = 200): Promise<readonly AppLogEntry[]> {
    return this.#logs.slice(-limit).reverse();
  }

  async getDocument(key: string): Promise<CachedDocument | null> {
    return this.#documents.get(key) ?? null;
  }

  async putDocument(document: CachedDocument): Promise<void> {
    this.#documents.set(document.key, {
      ...document,
      value: redactJson(document.value),
    });
  }

  async cleanup(now = Date.now()): Promise<void> {
    for (const [key, document] of this.#documents) {
      if (document.expiresAt && Date.parse(document.expiresAt) <= now) {
        this.#documents.delete(key);
      }
    }
  }

  async exportData(): Promise<AppDataExport> {
    return {
      settings: await this.getSettings(),
      users: [...this.#users.values()],
      logs: await this.listLogs(Number.MAX_SAFE_INTEGER),
      documents: [...this.#documents.values()],
    };
  }

  close(): void {}
}
