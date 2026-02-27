import { Bus, EV } from "../core/EventBus.js";

export class RadioPuzzle {
  constructor({ id = "P-03", cassetteId = "cassette_03", frequency = 101.7 } = {}) {
    this.id = id;
    this.cassetteId = cassetteId;
    this.frequency = frequency;
    this.completed = false;
  }

  tune(player, frequency) {
    if (this.completed) return true;
    if (!player.hasItem(this.cassetteId)) return false;
    if (Number(frequency) !== this.frequency) return false;

    this.completed = true;
    Bus.emit(EV.UI_NOTE, {
      title: "Frecuencia de Semenov",
      body: "Llave maestra: despacho del director, tercer cajón detrás del panel falso.",
    });
    Bus.emit(EV.PUZZLE_SOLVED, { puzzleId: this.id });
    return true;
  }
}
