// src/core/storage.js
export class StorageManager {
  constructor(prefix) { this.prefix = prefix; }
  get(key, dv = null) {
    try { const v = localStorage.getItem(this.prefix + key); return v ? JSON.parse(v) : dv; }
    catch { return dv; }
  }
  set(key, value) { localStorage.setItem(this.prefix + key, JSON.stringify(value)); }
  remove(key) { localStorage.removeItem(this.prefix + key); }

  getMap(key) {
    const arr = this.get(key, []); 
    try { return new Map(arr); } catch { return new Map(); }
  }
  setMap(key, map) { this.set(key, [...map]); }
  alterMap(key, fn) { const m = this.getMap(key); fn(m); this.setMap(key, m); }
}

export const storage = new StorageManager('ykt-helper:');
