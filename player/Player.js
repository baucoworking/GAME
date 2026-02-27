import { Inventory } from "./Inventory.js";
import { Bus, EV } from "../core/EventBus.js";

export class Player {
  constructor({ id = "aleksei", position = { x: 0, y: 0, z: 0 } } = {}) {
    this.id = id;
    this.position = { ...position };
    this.forward = { x: 0, y: 0, z: -1 };
    this.inventory = new Inventory();
  }

  moveTo(position) {
    this.position = { ...this.position, ...position };
  }

  lookAt(direction) {
    this.forward = { ...this.forward, ...direction };
  }

  pickup(item) {
    this.inventory.addItem(item);
    Bus.emit(EV.ITEM_PICKUP, { itemId: item.id, item, playerId: this.id });
  }

  hasItem(itemId) {
    return this.inventory.hasItem(itemId);
  }

  useItem(itemId, targetId) {
    if (!this.hasItem(itemId)) return false;
    Bus.emit(EV.ITEM_USED, { itemId, targetId, playerId: this.id });
    return true;
  }
}
