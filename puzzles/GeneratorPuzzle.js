import { Bus, EV } from "../core/EventBus.js";

export class GeneratorPuzzle {
  constructor({ id = "P-01", requiredFuses = ["fuse_01", "fuse_02", "fuse_03"] } = {}) {
    this.id = id;
    this.requiredFuses = [...requiredFuses];
    this.inserted = new Set();
    this.completed = false;
  }

  insertFuse(player, fuseId) {
    if (this.completed) return true;
    if (!this.requiredFuses.includes(fuseId)) return false;
    if (!player.hasItem(fuseId)) return false;

    this.inserted.add(fuseId);

    if (this.inserted.size === this.requiredFuses.length) {
      this.completed = true;
      Bus.emit(EV.ELECTRICITY_ON, { byPuzzle: this.id });
      Bus.emit(EV.PUZZLE_SOLVED, { puzzleId: this.id });
    }

    return true;
  }
}
