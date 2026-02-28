import * as THREE from "three";
import { Inventory } from "./Inventory.js";
import { Bus, EV } from "../core/EventBus.js";

export class Player {
  constructor({ id = "aleksei", position = new THREE.Vector3(0, 0, 0) } = {}) {
    this.id = id;
    this.position = position.clone?.() ?? new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.rotation = { y: 0 };
    this.userData = { sewerDepth: 0, inCollapseRoom: false };
    this.isHiding = false;
    this.currentHideout = null;
    this.inventory = new Inventory();
  }

  moveTo(position) {
    if (position?.isVector3) this.position.copy(position);
    else this.position.set(position?.x ?? this.position.x, position?.y ?? this.position.y, position?.z ?? this.position.z);
  }

  lookAt(direction) {
    this.forward.copy(direction).normalize();
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
