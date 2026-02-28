import * as THREE from "three";
import { Bus, EV } from "./EventBus.js";
import { Player } from "../player/Player.js";
import { InteractionSystem } from "../player/InteractionSystem.js";
import { MovementController } from "../player/MovementController.js";
import { DosimeterSystem } from "../player/DosimeterSystem.js";
import { PuzzleSystem } from "../systems/PuzzleSystem.js";
import { SaveSystem } from "../systems/SaveSystem.js";
import { InventoryUI } from "../ui/InventoryUI.js";
import { HUD } from "../ui/HUD.js";
import { DosimeterUI } from "../ui/DosimeterUI.js";
import { NightOverlay } from "../ui/NightOverlay.js";
import { EnemyManager } from "../enemies/EnemyManager.js";
import { HideoutSystem } from "../systems/HideoutSystem.js";
import { TensionSystem } from "../systems/TensionSystem.js";
import { NightProgression } from "../systems/NightProgression.js";
import { LightingSystem } from "../world/LightingSystem.js";
import { World } from "../world/World.js";

export class SceneManager {
  constructor(engine) {
    this.engine = engine;
    this.player = null;
    this.interactionSystem = null;
    this.movement = null;
    this.puzzleSystem = null;
    this.saveSystem = new SaveSystem();
    this.inventoryUI = null;
    this.hud = null;
    this.nightOverlay = null;
    this.world = null;
    this.enemyManager = null;
    this.hideoutSystem = null;
    this.tensionSystem = null;
    this.nightProgression = null;
    this.dosimeter = null;
    this.hintEl = null;
  }

  init() {
    this.world = new World(this.engine.scene).build();

    this.player = new Player({ position: new THREE.Vector3(0, 0, 18) });
    this.interactionSystem = new InteractionSystem(this.player);
    this.movement = new MovementController(
      this.player,
      this.engine.camera,
      this.world.collidables,
    );
    this.puzzleSystem = new PuzzleSystem(this.player, this.interactionSystem);
    this.inventoryUI = new InventoryUI(this.player);
    this.hud = new HUD();
    this.nightOverlay = new NightOverlay();
    this.dosimeterUI = new DosimeterUI();
    this.dosimeter = new DosimeterSystem(this.player);
    this._initHintUI();

    this.enemyManager = new EnemyManager({
      scene: this.engine.scene,
      navMesh: this.world.navMesh,
      playerRef: this.player,
      collidables: this.world.collidables,
      patrolRoutes: this.world.patrolRoutes,
      vigilantePositions: this.world.vigilantePositions,
      manifestPoints: this.world.manifestPoints,
      colectivoZones: this.world.colectivoZones,
      cameoPosition: this.world.cameoPosition,
      collapseRoomCenter: this.world.collapseRoomCenter,
    });
    this.enemyManager.init();

    this.hideoutSystem = new HideoutSystem(this.engine);
    this.hideoutSystem.registerAll(this.world.hideouts);

    this.tensionSystem = new TensionSystem(
      this.engine,
      this.player,
      this.enemyManager.activeEnemyList,
      this.world.zones,
    );

    this.nightProgression = new NightProgression({
      enemyRegistry: this.enemyManager.registry,
      hideoutSystem: this.hideoutSystem,
      tensionSystem: this.tensionSystem,
    });

    this.lightingSystem = new LightingSystem(this.engine);

    this.engine.registerSystem("enemies", this.enemyManager);
    this.engine.registerSystem("hideouts", this.hideoutSystem);
    this.engine.registerSystem("tension", this.tensionSystem);
    this.engine.registerSystem("night", this.nightProgression);
    this.engine.registerSystem("movement", this.movement);
    this.engine.registerSystem("dosimeter", this.dosimeter);
    this.engine.registerSystem("lighting", this.lightingSystem);

    this._loadState();
    this._bindAutosave();

    Bus.emit(EV.GAME_INIT, { playerId: this.player.id });
    Bus.emit(EV.NIGHT_START, { nightNumber: 1 });
  }

  update(delta) {
    this.interactionSystem?.update();
    this.movement?.update(delta);
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
      }, 900);
    });

    Bus.on(EV.UI_NOTE, ({ title, body }) => {
      this.hintEl.textContent = `${title}: ${body}`;
      this.hintEl.style.opacity = "1";
      clearTimeout(this._hintTimeout);
      this._hintTimeout = setTimeout(() => {
        this.hintEl.style.opacity = "0";
      }, 4200);
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
