import { Bus, EV } from "../core/EventBus.js";

export class SewerPuzzle {
  constructor({ id = "P-08", keyId = "master_key", leverId = "sewer_lever" } = {}) {
    this.id = id;
    this.keyId = keyId;
    this.leverId = leverId;
    this.unlocked = false;
    this.completed = false;
  }

  useKey(player) {
    if (this.unlocked || this.completed) return true;
    if (!player.hasItem(this.keyId)) return false;
    this.unlocked = true;
    return true;
  }

  useLever(player) {
    if (this.completed) return true;
    if (!this.unlocked) return false;
    if (!player.hasItem(this.leverId)) return false;

    this.completed = true;
    Bus.emit(EV.PUZZLE_SOLVED, { puzzleId: this.id });
    Bus.emit(EV.GAME_WIN, { route: "sewer_escape" });
    return true;
  }
}
