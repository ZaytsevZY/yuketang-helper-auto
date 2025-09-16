export class StorageManager {
  constructor(prefix) {
    this.prefix = prefix;
  }

  get(key, defaultValue = null) {
    let value = localStorage.getItem(this.prefix + key);
    if (value) {
      try {
        return JSON.parse(value);
      } catch (err) {
        console.error(err);
      }
    }
    return defaultValue;
  }

  set(key, value) {
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }

  remove(key) {
    localStorage.removeItem(this.prefix + key);
  }

  getMap(key) {
    try {
      return new Map(this.get(key, []));
    } catch (err) {
      console.error(err);
      return new Map();
    }
  }

  setMap(key, map) {
    this.set(key, [...map]);
  }

  alterMap(key, callback) {
    const map = this.getMap(key);
    callback(map);
    this.setMap(key, map);
  }
}

const storage = new StorageManager("ykt-helper:");
export default storage;
