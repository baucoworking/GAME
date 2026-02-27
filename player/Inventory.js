export class Inventory {
  constructor() {
    this.items = new Map();
  }

  addItem(item) {
    this.items.set(item.id, { ...item });
  }

  hasItem(id) {
    return this.items.has(id);
  }

  getItem(id) {
    return this.items.get(id) ?? null;
  }

  removeItem(id) {
    this.items.delete(id);
  }

  getAll() {
    return Array.from(this.items.values());
  }

  serialize() {
    return this.getAll();
  }

  restore(items) {
    this.items.clear();
    (items ?? []).forEach((item) => this.addItem(item));
  }
}
