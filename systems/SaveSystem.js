const MEMORY_FALLBACK = new Map();

export class SaveSystem {
  constructor({ key = "chernobyl_mall_save_v1" } = {}) {
    this.key = key;
  }

  save(data) {
    const payload = JSON.stringify(data);

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(this.key, payload);
      return;
    }

    MEMORY_FALLBACK.set(this.key, payload);
  }

  load() {
    let raw = null;

    if (typeof localStorage !== "undefined") {
      raw = localStorage.getItem(this.key);
    } else {
      raw = MEMORY_FALLBACK.get(this.key) ?? null;
    }

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  clear() {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(this.key);
      return;
    }

    MEMORY_FALLBACK.delete(this.key);
  }
}
