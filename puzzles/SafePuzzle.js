import { Bus, EV } from "../core/EventBus.js";

export class SafePuzzle {
  constructor({ id = "P-02", code = "2604", rewardItemId = "storage_key" } = {}) {
    this.id = id;
    this.code = code;
    this.rewardItemId = rewardItemId;
    this.completed = false;
  }

  tryUnlock(inputCode, player, itemFactory) {
    if (this.completed) return true;
    if (String(inputCode) !== this.code) return false;

    player.pickup(itemFactory(this.rewardItemId));
    this.completed = true;
    Bus.emit(EV.PUZZLE_SOLVED, { puzzleId: this.id });
    return true;
  }
}
