import type {
  AppLogEntry,
  AppSettings,
  BrowserEnvironment,
  JsonValue,
  NewAppLogEntry,
  UserProfile,
} from '@ykt/contracts';

export interface CachedDocument {
  key: string;
  kind: 'presentation' | 'courseware';
  value: JsonValue;
  updatedAt: string;
  expiresAt: string | null;
}

export interface AppDataExport {
  settings: AppSettings;
  users: readonly UserProfile[];
  logs: readonly AppLogEntry[];
  documents: readonly CachedDocument[];
}

export interface AppDataStore {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getUser(environment: BrowserEnvironment): Promise<UserProfile | null>;
  saveUser(user: UserProfile): Promise<void>;
  appendLog(entry: NewAppLogEntry): Promise<void>;
  listLogs(limit?: number): Promise<readonly AppLogEntry[]>;
  getDocument(key: string): Promise<CachedDocument | null>;
  putDocument(document: CachedDocument): Promise<void>;
  cleanup(now?: number): Promise<void>;
  exportData(): Promise<AppDataExport>;
  close(): void;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SecretCodec {
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}

export interface CachedResource {
  url: string;
  body: Uint8Array;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  expiresAt: number;
  stale: boolean;
}

export interface ResourceCacheInput {
  body: Uint8Array;
  headers?: Readonly<Record<string, string>>;
}

export interface ResourceCacheStats {
  entries: number;
  bytes: number;
  maxBytes: number;
}

export interface ResourceCache {
  match(url: string): Promise<CachedResource | null>;
  put(url: string, input: ResourceCacheInput): Promise<CachedResource | null>;
  delete(url: string): Promise<void>;
  clear(): Promise<void>;
  prune(): Promise<void>;
  stats(): ResourceCacheStats;
  close(): void;
}
