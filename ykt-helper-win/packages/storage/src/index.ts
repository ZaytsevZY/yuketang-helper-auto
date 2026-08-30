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
