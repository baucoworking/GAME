export class Inventory {
  constructor() {
    this.items = new Map();
  }

  addItem(item) {
    this.items.set(item.id, item);
  }

  hasItem(id) {
    return this.items.has(id);
  }

  removeItem(id) {
    this.items.delete(id);
  }

  getAll() {
    return Array.from(this.items.values());
  }
}

// OBJETO EJEMPLO:

// const fuse = {
//   id: "fuse_03",
//   name: "Fusible quemado",
//   type: "key_item",
//   metadata: { puzzle: "P-01" },
// };
