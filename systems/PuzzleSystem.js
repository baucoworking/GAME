import { Bus, EV } from "../core/EventBus.js";
import { GeneratorPuzzle } from "../puzzles/GeneratorPuzzle.js";
import { RadioPuzzle } from "../puzzles/RadioPuzzle.js";
import { SafePuzzle } from "../puzzles/SafePuzzle.js";
import { SewerPuzzle } from "../puzzles/SewerPuzzle.js";

const ITEM_CATALOG = {
  fuse_01: { id: "fuse_01", name: "Fusible A", reusable: false, zone: "zona_l" },
  fuse_02: { id: "fuse_02", name: "Fusible B", reusable: false, zone: "zona_l" },
  fuse_03: { id: "fuse_03", name: "Fusible C", reusable: false, zone: "zona_j" },
  storage_key: {
    id: "storage_key",
    name: "Llave del almacén",
    reusable: true,
    zone: "zona_d",
  },
  director_key: {
    id: "director_key",
    name: "Llave despacho del director",
    reusable: true,
    zone: "zona_g",
  },
  master_key: { id: "master_key", name: "Llave maestra", reusable: true, zone: "zona_g" },
  sewer_lever: {
    id: "sewer_lever",
    name: "Palanca de alcantarilla",
    reusable: true,
    zone: "zona_i",
  },
  cassette_03: {
    id: "cassette_03",
    name: "Casete #3",
    reusable: true,
    zone: "zona_f",
  },
};

function cloneItem(itemId) {
  const src = ITEM_CATALOG[itemId];
  if (!src) throw new Error(`Item no registrado: ${itemId}`);
  return { ...src, metadata: { ...(src.metadata ?? {}) } };
}

export class PuzzleSystem {
  constructor(player, interactionSystem) {
    this.player = player;
    this.interactionSystem = interactionSystem;
    this.worldState = {
      electricityOn: false,
      storageUnlocked: false,
      directorRoomUnlocked: false,
      finalRoomUnlocked: false,
      sewerReady: false,
      pickedItems: new Set(),
    };

    this.puzzles = new Map([
      ["P-01", new GeneratorPuzzle()],
      ["P-02", new SafePuzzle()],
      ["P-03", new RadioPuzzle()],
      ["P-08", new SewerPuzzle()],
    ]);

    Bus.on(EV.ELECTRICITY_ON, () => {
      this.worldState.electricityOn = true;
    });

    Bus.on(EV.PUZZLE_SOLVED, ({ puzzleId }) => {
      if (puzzleId === "P-02") this.worldState.storageUnlocked = true;
      if (puzzleId === "P-08") this.worldState.sewerReady = true;
    });

    this._registerCoreInteractables();
  }

  itemFactory(itemId) {
    return cloneItem(itemId);
  }

  getPuzzle(id) {
    return this.puzzles.get(id);
  }

  getState() {
    return {
      worldState: {
        ...this.worldState,
        pickedItems: [...this.worldState.pickedItems],
      },
      puzzles: [...this.puzzles.entries()].reduce((acc, [id, puzzle]) => {
        acc[id] = {
          completed: !!puzzle.completed,
          unlocked: !!puzzle.unlocked,
          inserted: puzzle.inserted ? [...puzzle.inserted] : undefined,
        };
        return acc;
      }, {}),
    };
  }

  restoreState(snapshot) {
    if (!snapshot) return;

    Object.assign(this.worldState, snapshot.worldState ?? {});
    this.worldState.pickedItems = new Set(snapshot.worldState?.pickedItems ?? []);

    for (const [id, data] of Object.entries(snapshot.puzzles ?? {})) {
      const puzzle = this.puzzles.get(id);
      if (!puzzle) continue;
      puzzle.completed = !!data.completed;
      if ("unlocked" in data) puzzle.unlocked = !!data.unlocked;
      if (Array.isArray(data.inserted) && puzzle.inserted) {
        puzzle.inserted = new Set(data.inserted);
      }
    }
  }

  _pickup(itemId) {
    if (this.worldState.pickedItems.has(itemId)) return;
    this.player.pickup(this.itemFactory(itemId));
    this.worldState.pickedItems.add(itemId);
  }

  _registerCoreInteractables() {
    const at = (x, y, z) => ({ x, y, z });

    this.interactionSystem.register({
      id: "pickup_fuse_01",
      label: "Fusible 1",
      position: at(-2, 0, 8),
      onInteract: () => this._pickup("fuse_01"),
    });

    this.interactionSystem.register({
      id: "pickup_fuse_02",
      label: "Fusible 2",
      position: at(1, 0, 7),
      onInteract: () => this._pickup("fuse_02"),
    });

    this.interactionSystem.register({
      id: "pickup_fuse_03",
      label: "Fusible 3",
      position: at(3, 0, -9),
      onInteract: () => this._pickup("fuse_03"),
    });

    this.interactionSystem.register({
      id: "pickup_cassette_03",
      label: "Casete #3",
      position: at(8, 0, 4),
      onInteract: () => this._pickup("cassette_03"),
    });

    this.interactionSystem.register({
      id: "safe_pharmacy",
      label: "Caja fuerte (Farmacia)",
      position: at(12, 0, 0),
      getPrompt: () => "Pulsa E para abrir caja fuerte (código 2604)",
      onInteract: () => {
        this.getPuzzle("P-02").tryUnlock("2604", this.player, this.itemFactory.bind(this));
      },
    });

    this.interactionSystem.register({
      id: "generator_panel",
      label: "Panel eléctrico",
      position: at(-12, 0, -3),
      getPrompt: () => "Pulsa E para insertar fusibles en el panel",
      onInteract: () => {
        const generator = this.getPuzzle("P-01");
        ["fuse_01", "fuse_02", "fuse_03"].forEach((f) => generator.insertFuse(this.player, f));
      },
    });

    this.interactionSystem.register({
      id: "radio_cafeteria",
      label: "Radio",
      position: at(-7, 0, 2),
      getPrompt: () => "Pulsa E para sintonizar radio (101.7)",
      onInteract: () => this.getPuzzle("P-03").tune(this.player, 101.7),
    });

    this.interactionSystem.register({
      id: "storage_door",
      label: "Puerta del almacén",
      position: at(4, 0, -12),
      canInteract: () => this.player.hasItem("storage_key"),
      getPrompt: () => "Pulsa E para usar llave del almacén",
      onInteract: () => {
        this.worldState.storageUnlocked = true;
        this._pickup("sewer_lever");
        this._pickup("director_key");
      },
    });

    this.interactionSystem.register({
      id: "director_room_door",
      label: "Despacho del director",
      position: at(16, 0, -2),
      canInteract: () => this.player.hasItem("director_key") && this.worldState.electricityOn,
      getPrompt: () => "Pulsa E para abrir despacho del director",
      onInteract: () => {
        this.worldState.directorRoomUnlocked = true;
        this._pickup("master_key");
      },
    });

    this.interactionSystem.register({
      id: "final_locked_room",
      label: "Habitación sellada",
      position: at(19, 0, -8),
      canInteract: () => this.player.hasItem("master_key"),
      getPrompt: () => "Pulsa E para abrir la habitación sellada",
      onInteract: () => {
        this.worldState.finalRoomUnlocked = true;
      },
    });

    this.interactionSystem.register({
      id: "sewer_lock",
      label: "Cerradura de alcantarilla",
      position: at(21, 0, -11),
      canInteract: () => this.worldState.finalRoomUnlocked,
      getPrompt: () => "Pulsa E para usar la llave maestra",
      onInteract: () => this.getPuzzle("P-08").useKey(this.player),
    });

    this.interactionSystem.register({
      id: "sewer_lever_final",
      label: "Palanca de alcantarilla",
      position: at(21.5, 0, -11),
      canInteract: () => this.getPuzzle("P-08").unlocked,
      getPrompt: () => "Pulsa E para activar la palanca final",
      onInteract: () => this.getPuzzle("P-08").useLever(this.player),
    });
  }
}
