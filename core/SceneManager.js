import { Bus, EV } from "./EventBus.js";
import { Player } from "../player/Player.js";
import { InteractionSystem } from "../player/InteractionSystem.js";
import { PuzzleSystem } from "../systems/PuzzleSystem.js";
import { SaveSystem } from "../systems/SaveSystem.js";
import { InventoryUI } from "../ui/InventoryUI.js";

export class SceneManager {
  constructor(engine) {
    this.engine = engine;
    this.player = null;
    this.interactionSystem = null;
    this.puzzleSystem = null;
    this.saveSystem = new SaveSystem();
    this.inventoryUI = null;
    this.hintEl = null;
  }

  init() {
    this.player = new Player();
    this.interactionSystem = new InteractionSystem(this.player);
    this.puzzleSystem = new PuzzleSystem(this.player, this.interactionSystem);
    this.inventoryUI = new InventoryUI(this.player);
    this._initHintUI();

    this._loadState();
    this._bindAutosave();

    Bus.emit(EV.GAME_INIT, { playerId: this.player.id });
  }

  update() {
    this.interactionSystem?.update();
  }

  _initHintUI() {
    this.hintEl = document.createElement("div");
    this.hintEl.id = "interaction-hint";
    this.hintEl.style.position = "fixed";
    this.hintEl.style.left = "50%";
    this.hintEl.style.bottom = "20%";
    this.hintEl.style.transform = "translateX(-50%)";
    this.hintEl.style.padding = "8px 12px";
    this.hintEl.style.background = "rgba(0,0,0,0.55)";
    this.hintEl.style.color = "#f0f5f7";
    this.hintEl.style.fontFamily = "monospace";
    this.hintEl.style.border = "1px solid rgba(180, 220, 255, 0.3)";
    this.hintEl.style.opacity = "0";
    this.hintEl.style.transition = "opacity 120ms linear";
    document.body.appendChild(this.hintEl);

    Bus.on(EV.UI_HINT, ({ text }) => {
      this.hintEl.textContent = text;
      this.hintEl.style.opacity = "1";
      clearTimeout(this._hintTimeout);
      this._hintTimeout = setTimeout(() => {
        this.hintEl.style.opacity = "0";
      }, 160);
    });
  }

  _bindAutosave() {
    const save = () => this._saveState();
    Bus.on(EV.ITEM_PICKUP, save);
    Bus.on(EV.PUZZLE_SOLVED, save);
    Bus.on(EV.GAME_WIN, save);
  }

  _saveState() {
    this.saveSystem.save({
      player: {
        inventory: this.player.inventory.serialize(),
        position: this.player.position,
      },
      puzzles: this.puzzleSystem.getState(),
    });
  }

  _loadState() {
    const snapshot = this.saveSystem.load();
    if (!snapshot) return;

    this.player.moveTo(snapshot.player?.position ?? {});

    this.player.inventory.restore(snapshot.player?.inventory ?? []);

    this.puzzleSystem.restoreState(snapshot.puzzles);
  }
}
